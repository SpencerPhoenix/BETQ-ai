/**
 * BETQ.ai market-consensus audit: a two-way median of independently de-vigged
 * *different bookmakers*, never an asserted outcome model.
 */
import { toDecimal, noVigPair, median } from './engine.mjs';
import {canonicalTimestamp, QUOTE_MAX_AGE_MS, validProviderEventId} from './evidence-integrity.mjs';
import {scheduledInstant as providerQuoteInstant} from './schedule-review.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const round = (n, digits = 6) => Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
export const MARKET_BOOK_IDENTITY_POLICY='UNAMBIGUOUS_BOOKMAKER_MARKET_IDENTITY_V1';
const MAX_BOOKMAKERS=1000,MAX_MARKETS_PER_BOOK=100,MAX_BOOKMAKER_KEY_LENGTH=200;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(value));
// Provider JSON has own data fields. Do not invoke accessors or infer missing entries.
const field=(value,key)=>record(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const validSourceKey=value=>typeof value==='string'&&value.length>0&&
  value.length<=MAX_BOOKMAKER_KEY_LENGTH&&value.trim()===value&&!/[\u0000-\u001f\u007f-\u009f]/.test(value);
function boundedItems(value,limit){
  if(!Array.isArray(value)||value.length>limit)return null;
  const items=[];
  for(let i=0;i<value.length;i++){
    const entry=Object.getOwnPropertyDescriptor(value,String(i));
    if(!entry||!Object.hasOwn(entry,'value'))return null;
    items.push(entry.value);
  }
  return items;
}

/** Structural identities only: distinct provider keys do not prove upstream independence. */
function selectUnambiguousBookMarkets(input){
  const integrity={policy:MARKET_BOOK_IDENTITY_POLICY,
    bookmakerRecords:Array.isArray(input)?input.length:0,invalidBookmakerCollection:0,
    invalidBookmakerKeys:0,duplicateBookmakerKeys:0,duplicateBookmakerRecords:0,
    invalidMarketCollections:0,duplicateTargetMarketBooks:0,missingTargetMarketBooks:0,
    eligibleBookmakerRecords:0,excludedBookmakerRecords:0};
  const books=boundedItems(input,MAX_BOOKMAKERS),selected=[];
  if(!books){
    integrity.invalidBookmakerCollection=1;
    integrity.excludedBookmakerRecords=integrity.bookmakerRecords;
    return {selected,integrity,valid:false};
  }
  // Count every valid key before inspecting markets, quote times or prices. Even
  // a stale/malformed duplicate poisons that identity; never choose first or last.
  const counts=new Map();
  for(const book of books){
    const key=field(book,'key');
    if(!validSourceKey(key)){integrity.invalidBookmakerKeys++;continue;}
    counts.set(key,(counts.get(key)??0)+1);
  }
  for(const count of counts.values())if(count>1){
    integrity.duplicateBookmakerKeys++;integrity.duplicateBookmakerRecords+=count;
  }
  for(const book of books){
    const key=field(book,'key');
    if(!validSourceKey(key)||counts.get(key)!==1)continue;
    const markets=boundedItems(field(book,'markets'),MAX_MARKETS_PER_BOOK);
    // An unidentifiable market entry could hide another h2h entry. Reject the
    // whole bookmaker instead of silently filtering an unenumerable collection.
    if(!markets||markets.some(m=>!validSourceKey(field(m,'key')))){
      integrity.invalidMarketCollections++;continue;
    }
    const target=markets.filter(m=>field(m,'key')==='h2h');
    if(target.length>1){integrity.duplicateTargetMarketBooks++;continue;}
    if(target.length===0){integrity.missingTargetMarketBooks++;continue;}
    selected.push(target[0]);
  }
  integrity.eligibleBookmakerRecords=selected.length;
  integrity.excludedBookmakerRecords=books.length-selected.length;
  return {selected,integrity,valid:true};
}

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
      !event?.home_team || !event?.away_team) {
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
  const selection=selectUnambiguousBookMarkets(field(event,'bookmakers'));
  const bookmakerIntegrity=selection.integrity;
  if(!selection.valid)return {available:false,reason:'INVALID_BOOKMAKER_COLLECTION',bookmakerIntegrity};
  const quotes=[];
  for (const market of selection.selected) {
    if (!Array.isArray(market.outcomes) || market.outcomes.length !== 2) continue;
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
    quotes.push({ fairHome: norm[0], updatedAt: at });
  }
  if (quotes.length < minBooks) return { available: false, reason: 'INSUFFICIENT_INDEPENDENT_BOOKS', books: quotes.length,bookmakerIntegrity };
  const probabilities = quotes.map(p => p.fairHome);
  const estimate = median(probabilities);
  const range = Math.max(...probabilities) - Math.min(...probabilities);
  // Extreme disagreement indicates stale/erroneous quotes; fail closed.
  if (range > 0.10) return {
    available: false, reason: 'EXCESSIVE_BOOK_DISAGREEMENT',
    books: quotes.length, disagreementPoints: round(range * 100, 2),bookmakerIntegrity
  };
  const deviations = probabilities.map(p => Math.abs(p - estimate));
  const ageSeconds = Math.floor((now - Math.min(...quotes.map(p => p.updatedAt))) / 1000);
  return {
    available: true, method: 'ALL_BOOKS_MEDIAN_DE_VIG', basis: 'MARKET_DERIVED_NOT_INDEPENDENT',
    homeProbability: round(estimate),
    awayProbability: round(1 - estimate),
    books: quotes.length,
    bookmakerIntegrity,
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
