import { SPORTS, MARKETS } from './engine.mjs';

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
  ttlMs = Number(process.env.CACHE_TTL_MS) || 90000
} = {}) {
  const cache = new Map();
  const inflight = new Map();
  let lastSuccess = null;
  let lastError = null;
  const configured = Boolean(apiKey.trim());
  const headersSnapshot = { remaining: null, used: null, last: null };

  async function request(path, query, cacheId) {
    if (!configured) throw new OddsError('SETUP_REQUIRED', 503, 'Set ODDS_API_KEY in the running server environment to enable live odds.');
    const fresh = cache.get(cacheId);
    if (fresh && clock() - fresh.storedAt < Math.max(5000, ttlMs)) {
      return { ...fresh.payload, cacheHit: true };
    }
    if (inflight.has(cacheId)) return inflight.get(cacheId);
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
      const raw = await response.text();
      if (raw.length > 5000000) throw new OddsError('OVERSIZE_PAYLOAD', 502, 'Provider payload exceeded safety limit.');
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
      lastSuccess = receivedAt;
      lastError = null;
      const payload = { events: data, receivedAt, cacheHit: false, quota };
      cache.set(cacheId, { storedAt: clock(), payload });
      return payload;
    })().finally(() => inflight.delete(cacheId));
    inflight.set(cacheId, pending);
    return pending;
  }
  return {
    configured,
    status() { return { configured, lastSuccess, lastError, quota: { ...headersSnapshot }, cacheEntries: cache.size }; },
    getOdds(sport, market) {
      if (!Object.hasOwn(SPORTS, sport) || !Object.hasOwn(MARKETS, market)) {
        throw new OddsError('INVALID_FILTER', 400, 'Unsupported sport or market.');
      }
      return request(encodeURIComponent(sport) + '/odds', {
        regions: 'us', markets: market, oddsFormat: 'american', dateFormat: 'iso'
      }, 'odds:' + sport + ':' + market);
    },
    getScores(sport) {
      if (!Object.hasOwn(SPORTS, sport)) throw new OddsError('INVALID_FILTER', 400, 'Unsupported sport.');
      return request(encodeURIComponent(sport) + '/scores', {
        daysFrom: '1', dateFormat: 'iso'
      }, 'scores:' + sport);
    }
  };
}
