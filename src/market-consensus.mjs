/**
 * BETQ.ai market-consensus audit: a two-way median of independently de-vigged
 * *different bookmakers*, never an asserted outcome model.
 */
import { toDecimal, noVigPair, median } from './engine.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const round = (n, digits = 6) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;

export function nflMoneylineConsensus(event, { asOf = Date.now(), maxAgeMs = 600000, minBooks = 3 } = {}) {
  const now = Number(asOf), start = Date.parse(event?.commence_time ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(now) || start <= now ||
      !event?.home_team || !event?.away_team || !Array.isArray(event?.bookmakers)) {
    return { available: false, reason: 'NO_VALID_PREGAME_EVENT' };
  }
  const prices = new Map();
  for (const book of event.bookmakers) {
    const id = typeof book?.key === 'string' ? book.key : null;
    if (!id) continue;
    const market = book.markets?.find(m => m?.key === 'h2h');
    if (!market || !Array.isArray(market.outcomes) || market.outcomes.length !== 2) continue;
    const at = Date.parse(market.last_update || book.last_update || '');
    if (!Number.isFinite(at) || at > now + 60000 || now - at > maxAgeMs) continue;
    const home = market.outcomes.find(o => o.name === event.home_team);
    const away = market.outcomes.find(o => o.name === event.away_team);
    if (!home || !away || toDecimal(home.price) === null || toDecimal(away.price) === null) continue;
    const norm = noVigPair(home.price, away.price);
    if (!norm || !norm.every(finite)) continue;
    prices.set(id, { fairHome: norm[0], updatedAt: at });
  }
  const quotes = [...prices.values()];
  if (quotes.length < minBooks) return { available: false, reason: 'INSUFFICIENT_INDEPENDENT_BOOKS', books: quotes.length };
  const probabilities = quotes.map(p => p.fairHome);
  const estimate = median(probabilities);
  const range = Math.max(...probabilities) - Math.min(...probabilities);
  // Extreme disagreement indicates stale/erroneous quotes; fail closed.
  if (range > 0.10) return {
    available: false, reason: 'EXCESSIVE_BOOK_DISAGREEMENT',
    books: quotes.length, disagreementPoints: round(range * 100, 2)
  };
  const deviations = probabilities.map(p => Math.abs(p - estimate));
  const ageSeconds = Math.floor((now - Math.min(...quotes.map(p => p.updatedAt))) / 1000);
  return {
    available: true, method: 'ALL_BOOKS_MEDIAN_DE_VIG', basis: 'MARKET_DERIVED_NOT_INDEPENDENT',
    homeProbability: round(estimate),
    awayProbability: round(1 - estimate),
    books: quotes.length,
    disagreementPoints: round(range * 100, 2),
    medianAbsoluteDeviationPoints: round(median(deviations) * 100, 2),
    oldestQuoteAgeSeconds: ageSeconds,
    latestQuoteAt: new Date(Math.max(...quotes.map(p => p.updatedAt))).toISOString(),
    source: 'THE_ODDS_API_V4',
    market: 'h2h',
    snapshotAt: new Date(now).toISOString()
  };
}
