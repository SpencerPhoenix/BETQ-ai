import { SPORTS, MARKETS } from './engine.mjs';
import {readBoundedText} from './integrity.mjs';

export class OddsError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const intHeader = (headers, key) => {
  const n = Number(headers.get(key));
  return headers.has(key) && Number.isFinite(n) ? n : null;
};
export function createOddsSource({
  apiKey = process.env.ODDS_API_KEY || '',
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  ttlMs = Number(process.env.CACHE_TTL_MS) || 300000,
  dailyCreditCap = process.env.ODDS_DAILY_CREDIT_LIMIT === undefined
    ? 12 : Number(process.env.ODDS_DAILY_CREDIT_LIMIT),
  reserveCredits = Number(process.env.ODDS_MIN_CREDITS_RESERVE) || 50
} = {}) {
  apiKey = typeof apiKey==='string' ? apiKey.trim() : '';
  ttlMs = Number.isFinite(ttlMs) && ttlMs>0 ? ttlMs : 300000;
  const cache = new Map();
  const inflight = new Map();
  let lastSuccess = null;
  let lastError = null;
  const configured = Boolean(apiKey.trim());
  const headersSnapshot = { remaining: null, used: null, last: null };
  // Only an absent setting receives the default. Zero, blank and invalid
  // explicit limits must never silently authorize paid provider requests.
  const safeDailyCap = Number.isFinite(dailyCreditCap) ? Math.max(0,Math.min(100,Math.floor(dailyCreditCap))) : 0;
  const safeReserve = Number.isFinite(reserveCredits) ? Math.max(0,Math.min(5000,Math.floor(reserveCredits))) : 50;
  let pendingProviderCredits = 0;
  const budget = { day: '', used: 0 };
  function budgetStatus() {
    const day = new Date(clock()).toISOString().slice(0,10);
    if (budget.day !== day) { budget.day = day; budget.used = 0; }
    return {
      utcDay: day, used: budget.used, limit: safeDailyCap,
      available: Math.max(0,safeDailyCap-budget.used),
      minimumProviderCredits: safeReserve,
      persistent: false
    };
  }

  async function request(path, query, cacheId,estimatedCredits=1,{allowPaid=true}={}) {
    if (!configured) throw new OddsError('SETUP_REQUIRED', 503, 'Set ODDS_API_KEY in the running server environment to enable live odds.');
    const fresh = cache.get(cacheId);
    if (fresh && clock() - fresh.storedAt < Math.max(5000, ttlMs)) {
      return { ...fresh.payload, cacheHit: true };
    }
    // Ordinary page loads may reuse fresh data, never open an upstream request.
    // Do not treat a still-pending paid request as a cached observation.
    if (allowPaid !== true) throw new OddsError('PAID_REFRESH_REQUIRED', 409,
      'No fresh cached data. Use the explicit refresh action to allow a provider request.');
    if (inflight.has(cacheId)) return inflight.get(cacheId);
    budgetStatus();
    if (headersSnapshot.remaining !== null && headersSnapshot.remaining - pendingProviderCredits - estimatedCredits < safeReserve) {
      throw new OddsError('PROVIDER_CREDIT_RESERVE',429,
        'Remaining provider credits are at the reserved minimum. Raise budget settings only after reviewing available credits.');
    }
    if (budget.used + estimatedCredits > safeDailyCap) {
      throw new OddsError('API_DAILY_BUDGET',429,
        safeDailyCap === 0 ? 'Paid provider requests are disabled by the configured daily credit limit.'
          : 'Daily provider request budget reached. No new paid data requests until the next UTC day.');
    }
    budget.used += estimatedCredits;
    pendingProviderCredits += estimatedCredits;
    const pending = (async () => {
      const url = new URL('https://api.the-odds-api.com/v4/sports/' + path);
      url.searchParams.set('apiKey', apiKey);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
      } catch {
        lastError = { at: new Date(clock()).toISOString(), code: 'UPSTREAM_UNREACHABLE' };
        throw new OddsError('UPSTREAM_UNREACHABLE', 502, 'Odds provider temporarily unavailable.');
      }
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'API_KEY_REJECTED'
          : response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR';
        lastError = { at: new Date(clock()).toISOString(), code };
        throw new OddsError(code, 502, 'Odds provider returned an error (' + response.status + ').');
      }
      // JSON size is bounded to avoid memory pressure from unexpectedly large upstream payloads.
      let raw;
      try { raw = await readBoundedText(response,5000000); }
      catch (e) { throw new OddsError(e.message==='BODY_TOO_LARGE'?'OVERSIZE_PAYLOAD':'INVALID_PROVIDER_BODY',502,'Provider response was too large or unreadable.'); }
      let data;
      try { data = JSON.parse(raw); } catch { throw new OddsError('INVALID_PROVIDER_JSON', 502, 'Odds provider returned invalid data.'); }
      if (!Array.isArray(data)) throw new OddsError('INVALID_PROVIDER_DATA', 502, 'Odds provider returned an unexpected schema.');
      const receivedAt = new Date(clock()).toISOString();
      const quota = {
        remaining: intHeader(response.headers, 'x-requests-remaining'),
        used: intHeader(response.headers, 'x-requests-used'),
        last: intHeader(response.headers, 'x-requests-last')
      };
      Object.assign(headersSnapshot, quota);
      // Reconcile estimate with actual provider charge, if supplied.
      if (quota.last !== null && quota.last >= 0 && quota.last <= 100) {
        budget.used = Math.max(0, budget.used + quota.last - estimatedCredits);
      }
      lastSuccess = receivedAt;
      lastError = null;
      const payload = { events: data, receivedAt, cacheHit: false, quota };
      cache.set(cacheId, { storedAt: clock(), payload });
      return payload;
    })().finally(() => { inflight.delete(cacheId); pendingProviderCredits-=estimatedCredits; });
    inflight.set(cacheId, pending);
    return pending;
  }
  return {
    configured,
    status() { return { configured, lastSuccess, lastError, quota: { ...headersSnapshot },
      budget: budgetStatus(), cacheEntries: cache.size }; },
    getOdds(sport, market, options = {}) {
      if (!Object.hasOwn(SPORTS, sport) || !Object.hasOwn(MARKETS, market)) {
        throw new OddsError('INVALID_FILTER', 400, 'Unsupported sport or market.');
      }
      return request(encodeURIComponent(sport) + '/odds', {
        regions: 'us', markets: market, oddsFormat: 'american', dateFormat: 'iso'
      }, 'odds:' + sport + ':' + market,1,options);
    },
    getScores(sport, options = {}) {
      if (!Object.hasOwn(SPORTS, sport)) throw new OddsError('INVALID_FILTER', 400, 'Unsupported sport.');
      return request(encodeURIComponent(sport) + '/scores', {
        daysFrom: '1', dateFormat: 'iso'
      }, 'scores:' + sport,2,options);
    }
  };
}
