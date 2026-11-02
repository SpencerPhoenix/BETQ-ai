/**
 * BETQ.ai's transparent, market-only price scanner.
 * NOT an independent outcome prediction model or a validated betting edge.
 */
export const SPORTS = Object.freeze({
  americanfootball_nfl: 'NFL',
  basketball_nba: 'NBA',
  baseball_mlb: 'MLB',
  icehockey_nhl: 'NHL',
  americanfootball_ncaaf: 'NCAAF'
});
export const MARKETS = Object.freeze({ h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' });

export function toDecimal(price) {
  if (!Number.isFinite(price) || price === 0 || Math.abs(price) < 100) return null;
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}
export function impliedProbability(price) {
  const d = toDecimal(price);
  return d ? 1 / d : null;
}
export function noVigPair(a, b) {
  const pa = impliedProbability(a);
  const pb = impliedProbability(b);
  if (pa === null || pb === null || pa + pb <= 0) return null;
  return [pa / (pa + pb), pb / (pa + pb)];
}
export function expectedValue(probability, price) {
  const decimal = toDecimal(price);
  if (decimal === null || !Number.isFinite(probability) || probability < 0 || probability > 1) return null;
  return probability * decimal - 1;
}
export function kellyFraction(probability, price) {
  const decimal = toDecimal(price);
  if (decimal === null || !Number.isFinite(probability) || probability < 0 || probability > 1) return 0;
  return Math.max(0, Math.min(1, (probability * decimal - 1) / (decimal - 1)));
}
export function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}
const round = (n, digits = 2) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
const norm = n => Object.is(n,-0) ? 0 : n; // Never merge different point lines through rounding.
const iso = (time) => new Date(time).toISOString();

function toPair(event, bookmaker, marketKey, now, maxAgeMs) {
  if (!bookmaker || typeof bookmaker !== 'object') return null;
  const market = Array.isArray(bookmaker.markets)
    ? bookmaker.markets.find(m => m && m.key === marketKey) : null;
  if (!market || !Array.isArray(market.outcomes) || market.outcomes.length !== 2) return null;
  const updatedAt = Date.parse(market.last_update || bookmaker.last_update || '');
  if (!Number.isFinite(updatedAt) || updatedAt > now + 60000) return null;
  const ageMs = Math.max(0, now - updatedAt);
  if (ageMs > maxAgeMs) return null;
  const [one, two] = market.outcomes;
  if (!one || !two || typeof one !== 'object' || typeof two !== 'object' || one.name === two.name) return null;
  if (toDecimal(one.price) === null || toDecimal(two.price) === null) return null;
  let sides, contractId, contractLabel;
  if (marketKey === 'h2h') {
    const home = market.outcomes.find(o => o.name === event.home_team);
    const away = market.outcomes.find(o => o.name === event.away_team);
    if (!home || !away) return null;
    sides = { home: home, away: away };
    contractId = 'h2h';
    contractLabel = 'Full game moneyline';
  } else if (marketKey === 'spreads') {
    const home = market.outcomes.find(o => o.name === event.home_team);
    const away = market.outcomes.find(o => o.name === event.away_team);
    if (!home || !away || !Number.isFinite(home.point) || !Number.isFinite(away.point)
        || Math.abs(home.point + away.point) > 0.001) return null;
    sides = { home: home, away: away };
    contractId = 'spread:' + norm(home.point);
    contractLabel = event.home_team + ' ' + (home.point > 0 ? '+' : '') + home.point;
  } else if (marketKey === 'totals') {
    const over = market.outcomes.find(o => o.name === 'Over');
    const under = market.outcomes.find(o => o.name === 'Under');
    if (!over || !under || !Number.isFinite(over.point) || !Number.isFinite(under.point)
        || Math.abs(over.point - under.point) > 0.001) return null;
    sides = { over: over, under: under };
    contractId = 'total:' + norm(over.point);
    contractLabel = 'Total ' + over.point;
  } else return null;
  const [first, second] = Object.values(sides);
  const fairPair = noVigPair(first.price, second.price);
  if (!fairPair) return null;
  const fair = {};
  Object.keys(sides).forEach((side, idx) => { fair[side] = fairPair[idx]; });
  return {
    id: String(bookmaker.key || bookmaker.title || ''),
    name: String(bookmaker.title || bookmaker.key || 'Book'),
    ageMs, updatedAt: iso(updatedAt), sides, fair,
    contractId, contractLabel
  };
}

function analyzeContract(event, market, contractId, quotes, now) {
  const gameStart = Date.parse(event.commence_time);
  const started = !Number.isFinite(gameStart) || gameStart <= now;
  const close = Number.isFinite(gameStart) && gameStart - now < 5 * 60000;
  const picks = [];
  const sideNames = Object.keys(quotes[0].sides);
  for (const side of sideNames) {
    const candidate = [...quotes].sort((a, b) =>
      toDecimal(b.sides[side].price) - toDecimal(a.sides[side].price))[0];
    const comparators = quotes.filter(q => q.id !== candidate.id);
    const estimates = comparators.map(q => q.fair[side]);
    const fairProbability = median(estimates);
    const range = estimates.length ? Math.max(...estimates) - Math.min(...estimates) : null;
    const price = candidate.sides[side].price;
    const imp = impliedProbability(price);
    const ev = fairProbability === null ? null : expectedValue(fairProbability, price);
    const edge = fairProbability === null ? null : fairProbability - imp;
    const ageMinutes = candidate.ageMs / 60000;
    const quality = Math.max(0, Math.min(99, Math.round(
      45 + Math.min(comparators.length, 5) * 8
      + Math.max(0, 12 - ageMinutes * 2)
      - (range === null ? 30 : range * 500)
    )));
    const reasons = [];
    if (started) reasons.push('KICKOFF_STARTED');
    else if (close) reasons.push('KICKOFF_IMMINENT');
    if (comparators.length < 2) reasons.push('INSUFFICIENT_COMPARATORS');
    if (market !== 'h2h' && Number.isInteger(candidate.sides[side].point)) reasons.push('PUSH_PROBABILITY_NOT_MODELED');
    if (range !== null && range > 0.045) reasons.push('MODEL_DISAGREEMENT');
    if (quality < 65) reasons.push('LOW_QUALITY');
    if (ev === null || ev < 0.015) reasons.push('EDGE_BELOW_THRESHOLD');
    if (edge === null || edge < 0.007) reasons.push('PRICE_EDGE_TOO_THIN');
    const watch = reasons.length === 0;
    // Quarter Kelly, capped at 1% bankroll. Theoretical only; not a wagering instruction.
    const bankrollFraction = watch ? Math.min(0.01, kellyFraction(fairProbability, price) * 0.25) : 0;
    const selection = candidate.sides[side];
    const label = market === 'totals' ? selection.name + ' ' + selection.point
      : market === 'spreads' ? selection.name + ' ' + (selection.point > 0 ? '+' : '') + selection.point
      : selection.name;
    picks.push({
      id: [event.id, market, contractId, side].join('|'),
      eventId: String(event.id), market, contractId, contractLabel: candidate.contractLabel,
      selection: label, side, point: Number.isFinite(selection.point) ? selection.point : null,
      bookmaker: candidate.name, bookmakerKey: candidate.id, americanOdds: price,
      decimalOdds: round(toDecimal(price), 4), impliedProbability: round(imp, 6),
      fairProbability: round(fairProbability, 6),
      edgePoints: round(edge === null ? NaN : edge * 100, 2),
      evPercent: round(ev === null ? NaN : ev * 100, 2),
      qualityScore: quality, marketRangePoints: round(range === null ? NaN : range * 100, 2),
      comparatorBooks: comparators.length, booksAtLine: quotes.length,
      quoteAgeSeconds: Math.floor(candidate.ageMs / 1000), lastUpdated: candidate.updatedAt,
      rawKellyPercent: round(fairProbability === null ? 0 : kellyFraction(fairProbability, price) * 100, 2),
      theoreticalUnits: round(bankrollFraction * 100, 2),
      status: watch ? 'WATCH' : 'PASS',
      reasons,
      basis: 'MARKET_CONSENSUS_ONLY',
      settlementAssumption: market !== 'h2h' && Number.isInteger(selection.point) ? 'PUSH_NOT_MODELED' : 'TWO_WAY_CONDITIONAL_ON_NON_VOID',
      independentModelValidated: false,
      injuryVerified: false,
      weatherVerified: false,
      halftimeModeled: false
    });
  }
  return picks;
}

export function analyzeEvents(events, { sport, market = 'h2h', asOf = Date.now(), maxAgeMs = 600000, demo = false } = {}) {
  if (!Object.hasOwn(MARKETS, market)) throw new Error('Unsupported market');
  const now = Number(asOf);
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs<=0) throw new Error('Invalid analysis time policy');
  const analyzed = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !event.id || !event.home_team || !event.away_team
        || !Array.isArray(event.bookmakers) || event.home_team === event.away_team
        || !Number.isFinite(Date.parse(event.commence_time || ''))) continue;
    const groups = new Map();
    for (const book of event.bookmakers) {
      const quote = toPair(event, book, market, now, maxAgeMs);
      if (!quote || !quote.id) continue;
      if (!groups.has(quote.contractId)) groups.set(quote.contractId, new Map());
      groups.get(quote.contractId).set(quote.id, quote);
    }
    const opportunities = [];
    for (const [contractId, books] of groups) {
      const quotes = [...books.values()];
      if (quotes.length) opportunities.push(...analyzeContract(event, market, contractId, quotes, now));
    }
    opportunities.sort((a, b) =>
      (b.status === 'WATCH') - (a.status === 'WATCH')
      || (b.evPercent ?? -999) - (a.evPercent ?? -999));
    analyzed.push({
      id: String(event.id), sport: event.sport_key || sport,
      homeTeam: event.home_team, awayTeam: event.away_team,
      commenceTime: event.commence_time,
      started: Date.parse(event.commence_time) <= now,
      bookmakerCount: new Set(event.bookmakers.filter(b=>b && typeof b==='object').map(b => b.key).filter(Boolean)).size,
      totalMarkets: groups.size, opportunities: opportunities.slice(0, 20),
      topSignal: opportunities.find(o => o.status === 'WATCH') || opportunities[0] || null,
      demo
    });
  }
  analyzed.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  const all = analyzed.flatMap(e => e.opportunities);
  return {
    source: demo ? 'SYNTHETIC_DEMO' : 'THE_ODDS_API_V4',
    model: 'LEAVE_ONE_BOOK_OUT_NO_VIG_MEDIAN',
    independentlyValidated: false,
    sport, market, analyzedAt: iso(now), demo,
    events: analyzed,
    summary: {
      games: analyzed.length, signals: all.length,
      watch: all.filter(s => s.status === 'WATCH').length,
      pass: all.filter(s => s.status === 'PASS').length,
      distinctBooks: new Set(analyzed.flatMap(e => e.opportunities.map(o => o.bookmakerKey))).size
    }
  };
}
