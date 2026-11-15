/**
 * BETQ.ai market-consensus audit: a two-way median of independently de-vigged
 * *different bookmakers*, never an asserted outcome model.
 */
import { toDecimal, noVigPair, median } from './engine.mjs';
import {canonicalTimestamp, QUOTE_MAX_AGE_MS, validProviderEventId} from './evidence-integrity.mjs';
import {scheduledInstant as providerQuoteInstant} from './schedule-review.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const round = (n, digits = 6) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;

// Count identities before any analysis filter: choosing first/last could bind a
// different game's model and quote to an otherwise valid retained event.
export function selectUnambiguousProviderEvents(events) {
  const input = Array.isArray(events) ? events : [], counts = new Map();
  let invalidProviderEventIds = 0;
  for (const event of input) {
    if (!validProviderEventId(event?.id)) { invalidProviderEventIds++; continue; }
    counts.set(event.id, (counts.get(event.id) || 0) + 1);
  }
  const selected = input.filter(event => validProviderEventId(event?.id) && counts.get(event.id) === 1);
  return {events: selected, integrity: {
    policy: 'UNAMBIGUOUS_RAW_PROVIDER_EVENT_ID_V1', excludedEvents: input.length - selected.length,
    invalidProviderEventIds, duplicateProviderEventIds: [...counts.values()].filter(n => n > 1).length
  }};
}

export function nflMoneylineConsensus(event, { asOf = Date.now(), receivedAt, maxAgeMs = QUOTE_MAX_AGE_MS, minBooks = 3 } = {}) {
  const now = Number(asOf), start = Date.parse(event?.commence_time ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(now) || start <= now ||
      !event?.home_team || !event?.away_team || !Array.isArray(event?.bookmakers)) {
    return { available: false, reason: 'NO_VALID_PREGAME_EVENT' };
  }
  // Pure callers may supply only an analysis clock. HTTP producers must pass
  // the original source receipt explicitly, including null when absent.
  const received = receivedAt === undefined ? now : canonicalTimestamp(receivedAt);
  if (!Number.isFinite(received) || received > now || now - received > QUOTE_MAX_AGE_MS) {
    return {available: false, reason: 'INVALID_PROVIDER_RECEIPT_TIME'};
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || !Number.isInteger(minBooks) || minBooks < 3) {
    return {available: false, reason: 'INVALID_CONSENSUS_CONFIGURATION'};
  }
  const quoteMaxAge = Math.min(maxAgeMs, QUOTE_MAX_AGE_MS);
  const prices = new Map();
  for (const book of event.bookmakers) {
    const id = typeof book?.key === 'string' ? book.key : null;
    if (!id) continue;
    const market = Array.isArray(book.markets) ? book.markets.find(m => m?.key === 'h2h') : null;
    if (!market || !Array.isArray(market.outcomes) || market.outcomes.length !== 2) continue;
    // A bookmaker update does not prove this particular market was refreshed.
    // Preserve the source instant; reject timezone/calendar ambiguity rather
    // than normalizing a malformed timestamp into apparently valid evidence.
    const at = providerQuoteInstant(market.last_update);
    if (!Number.isFinite(at) || at > received || at > now || now - at > quoteMaxAge) continue;
    const home = market.outcomes.find(o => o && o.name === event.home_team);
    const away = market.outcomes.find(o => o && o.name === event.away_team);
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
    oldestQuoteAt: new Date(Math.min(...quotes.map(p => p.updatedAt))).toISOString(),
    latestQuoteAt: new Date(Math.max(...quotes.map(p => p.updatedAt))).toISOString(),
    source: 'THE_ODDS_API_V4',
    market: 'h2h',
    snapshotAt: new Date(now).toISOString()
  };
}
