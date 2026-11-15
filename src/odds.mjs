import { SPORTS, MARKETS } from './engine.mjs';
import {readBoundedText} from './integrity.mjs';
import {configuredProviderBudget} from './configured-provider-budget.mjs';

export class OddsError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const intHeader = (headers, key) => {
  const raw=headers.get(key);
  return typeof raw==='string' && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
};
export function createOddsSource({
  apiKey = process.env.ODDS_API_KEY || '',
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  ttlMs = Number(process.env.CACHE_TTL_MS) || 300000,
  budgetStore = configuredProviderBudget()
} = {}) {
  apiKey = typeof apiKey==='string' ? apiKey.trim() : '';
  ttlMs = Number.isFinite(ttlMs) && ttlMs>0 ? ttlMs : 300000;
  const cache = new Map();
  const inflight = new Map();
  let lastSuccess = null;
  let lastError = null;
  const configured = Boolean(apiKey.trim());
  const headersSnapshot = { remaining: null, used: null, last: null };
  const budgetError = (error) => new OddsError(
    typeof error?.code==='string' ? error.code : 'DURABLE_BUDGET_UNAVAILABLE',
    [429,503].includes(error?.status) ? error.status : 503,
    'Paid refresh is blocked by the durable credit ledger. Check operator budget readiness.');
  async function ledgerStatus() {
    try { return await budgetStore.status(); }
    catch { return {persistent:false,available:false,ready:false,reason:'DURABLE_BUDGET_UNAVAILABLE'}; }
  }

  async function request(path, query, cacheId,estimatedCredits=1,{allowPaid=false}={}) {
    if (!configured) throw new OddsError('SETUP_REQUIRED', 503, 'Set ODDS_API_KEY in the running server environment to enable live odds.');
    const fresh = cache.get(cacheId);
    if (fresh && clock() - fresh.storedAt < Math.max(5000, ttlMs)) {
      return { ...fresh.payload, cacheHit: true };
    }
    // Ordinary page loads may reuse fresh data, never open an upstream request.
    // Do not treat a still-pending paid request as a cached observation.
    if (allowPaid !== true) throw new OddsError('PAID_REFRESH_REQUIRED', 409,
      'No fresh cached data. An authenticated operator must refresh the shared snapshot.');
    if (inflight.has(cacheId)) return inflight.get(cacheId);
    // Install the in-flight promise before awaiting the durable transaction.
    // Public cache-only reads never join this request or authorize any spending.
    const pending = (async () => {
      let reservation;
      try { reservation=await budgetStore.reserve({estimatedCredits}); }
      catch(error) { throw budgetError(error); }
      const url = new URL('https://api.the-odds-api.com/v4/sports/' + path);
      url.searchParams.set('apiKey', apiKey);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      let response;
      try {
        response = await fetchImpl(url, {
          headers: { Accept: 'application/json' }, redirect: 'error',
          signal: AbortSignal.timeout(10000)
        });
      } catch {
        lastError = { at: new Date(clock()).toISOString(), code: 'UPSTREAM_UNREACHABLE' };
        throw new OddsError('UPSTREAM_UNREACHABLE', 502, 'Odds provider temporarily unavailable.');
      }
      // Persist provider accounting even on an HTTP error or malformed body.
      // A failed/unknown request keeps its reservation; never refund from a guess.
      const quota = {
        remaining: intHeader(response.headers, 'x-requests-remaining'),
        used: intHeader(response.headers, 'x-requests-used'),
        last: intHeader(response.headers, 'x-requests-last')
      };
      Object.assign(headersSnapshot, quota);
      try { await budgetStore.reconcile(reservation,quota); }
      catch(error) {
        lastError={at:new Date(clock()).toISOString(),code:'BUDGET_RECONCILIATION_FAILED'};
        throw budgetError(error);
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
      lastSuccess = receivedAt;
      lastError = null;
      const payload = { events: data, receivedAt, cacheHit: false, quota };
      cache.set(cacheId, { storedAt: clock(), payload });
      return payload;
    })().finally(() => { inflight.delete(cacheId); });
    inflight.set(cacheId, pending);
    return pending;
  }
  return {
    configured,
    async status() { return { configured, lastSuccess, lastError, quota: { ...headersSnapshot },
      budget: await ledgerStatus(), cacheEntries: cache.size }; },
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
