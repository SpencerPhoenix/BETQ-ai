import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createOddsSource, OddsError } from './odds.mjs';
import { analyzeEvents, SPORTS, MARKETS } from './engine.mjs';
import { demoEvents } from './demo.mjs';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
const CSP = [
  "default-src 'self'", "base-uri 'none'", "connect-src 'self'",
  "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "object-src 'none'", "form-action 'none'", "frame-ancestors 'none'"
].join('; ');

function reply(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': CSP, ...headers
  });
  res.end(JSON.stringify(data));
}
function safeError(res, err) {
  if (err instanceof OddsError) return reply(res, err.status, { error: { code: err.code, message: err.message } });
  console.error('[BETQ] request failed:', err && err.message ? err.message : 'unknown error');
  return reply(res, 500, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
}
export function createHandler({
  source = createOddsSource(),
  clock = Date.now,
  maxAgeMs = Number(process.env.ODDS_MAX_AGE_MS) || 600000
} = {}) {
  const access = new Map();
  return async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Read-only API.' } });
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const ip = req.socket?.remoteAddress || 'unknown';
        const now = clock();
        const bucket = access.get(ip) || { resetAt: now + 600000, count: 0 };
        if (bucket.resetAt < now) { bucket.resetAt = now + 600000; bucket.count = 0; }
        bucket.count++;
        access.set(ip, bucket);
        if (access.size > 10000) access.clear();
        if (bucket.count > 180) {
          return reply(res, 429, { error: { code: 'LOCAL_RATE_LIMIT', message: 'Too many requests. Try again shortly.' } });
        }
        if (url.pathname === '/api/health') return reply(res, 200, {
          status: 'ok', app: 'BETQ.ai', version: '0.1.0',
          serverTime: new Date(now).toISOString(), odds: source.status()
        });
        if (url.pathname === '/api/config') return reply(res, 200, {
          sports: SPORTS, markets: MARKETS,
          maxAgeMs, refreshMs: 90000,
          marketOnly: true, wageringEnabled: false,
          modelValidated: false, injuryDataConnected: false, halftimeModelConnected: false
        });
        if (url.pathname === '/api/slate') {
          const sport = url.searchParams.get('sport') || 'americanfootball_nfl';
          const market = url.searchParams.get('market') || 'h2h';
          const mode = url.searchParams.get('mode') || 'live';
          if (!Object.hasOwn(SPORTS, sport) || !Object.hasOwn(MARKETS, market)
              || !['live', 'demo'].includes(mode)) {
            return reply(res, 400, { error: { code: 'INVALID_FILTER', message: 'Unsupported sport, market or mode.' } });
          }
          const demo = mode === 'demo';
          const snapshot = demo
            ? { events: demoEvents(sport, now), receivedAt: new Date(now).toISOString(), cacheHit: false, quota: null }
            : await source.getOdds(sport, market);
          const analysis = analyzeEvents(snapshot.events, {
            sport, market, asOf: now, maxAgeMs, demo
          });
          return reply(res, 200, {
            ...analysis,
            receivedAt: snapshot.receivedAt, cacheHit: snapshot.cacheHit,
            quota: snapshot.quota, warnings: [
              'Market consensus is not an independently validated win-probability model.',
              'Injury, lineup, weather, halftime and historical calibration are not yet verified.',
              'No real wagers are placed. Demo events and prices are entirely synthetic.'
            ]
          });
        }
        if (url.pathname === '/api/scores') {
          const sport = url.searchParams.get('sport') || 'americanfootball_nfl';
          if (!Object.hasOwn(SPORTS, sport)) return reply(res, 400, {
            error: { code: 'INVALID_FILTER', message: 'Unsupported sport.' }
          });
          const snapshot = await source.getScores(sport);
          return reply(res, 200, {
            source: 'THE_ODDS_API_V4', sport, receivedAt: snapshot.receivedAt,
            cacheHit: snapshot.cacheHit, quota: snapshot.quota,
            games: snapshot.events.map(ev => ({
              id: ev.id, homeTeam: ev.home_team, awayTeam: ev.away_team,
              commenceTime: ev.commence_time, completed: Boolean(ev.completed),
              lastUpdate: ev.last_update || null,
              scores: Array.isArray(ev.scores) ? ev.scores : []
            }))
          });
        }
        return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } });
      }
      const asset = ASSETS.get(url.pathname);
      if (!asset) return reply(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found.' } });
      const body = await readFile(join(PUBLIC_DIR, asset[0]));
      res.writeHead(200, {
        'Content-Type': asset[1],
        'Cache-Control': asset[0] === 'index.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': CSP
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) { safeError(res, err); }
  };
}
export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 3000);
  const server = http.createServer(createHandler(options));
  server.listen(port, '0.0.0.0', () => {
    console.log('[BETQ] terminal listening on port ' + server.address().port);
  });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer();
}
