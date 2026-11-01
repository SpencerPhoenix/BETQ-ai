import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/server.mjs';
import { createOddsSource } from '../src/odds.mjs';
import { demoEvents } from '../src/demo.mjs';
const NOW = Date.parse('2026-11-01T20:00:00Z');
function localServer(source) {
  const server = http.createServer(createHandler({ source, clock: () => NOW }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ server, base: 'http://127.0.0.1:' + server.address().port })));
}
const fakeSource = {
  status: () => ({ configured: false, lastSuccess: null, lastError: null, quota: null }),
  getOdds: async () => ({ events: demoEvents('americanfootball_nfl', NOW), receivedAt: new Date(NOW).toISOString(), cacheHit: false, quota: null }),
  getScores: async () => ({ events: [], receivedAt: new Date(NOW).toISOString(), cacheHit: false, quota: null })
};
test('Health reports setup state without leaking API key', async (t) => {
  const { server, base } = await localServer(fakeSource);
  t.after(() => server.close());
  const res = await fetch(base + '/api/health');
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /BETQ.ai/);
  assert.doesNotMatch(body, /apiKey/);
  assert.match(res.headers.get('content-security-policy'), /default-src/);
});
test('Demo slate delivers explicitly synthetic events', async (t) => {
  const { server, base } = await localServer(fakeSource);
  t.after(() => server.close());
  const res = await fetch(base + '/api/slate?mode=demo&sport=americanfootball_nfl&market=h2h');
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.source, 'SYNTHETIC_DEMO');
  assert.equal(json.events.length, 3);
  assert.equal(json.events[0].demo, true);
  assert.equal(json.independentlyValidated, false);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
test('Unknown API filters and write requests fail closed', async (t) => {
  const { server, base } = await localServer(fakeSource);
  t.after(() => server.close());
  assert.equal((await fetch(base + '/api/slate?sport=bogus')).status, 400);
  assert.equal((await fetch(base + '/api/slate?mode=unlocked')).status, 400);
  assert.equal((await fetch(base + '/api/slate', { method: 'POST' })).status, 405);
});
test('Static site is served by strict allowlist and CSP', async (t) => {
  const { server, base } = await localServer(fakeSource);
  t.after(() => server.close());
  const homepage = await fetch(base + '/');
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /BETQ.ai/);
  const script = await fetch(base + '/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/.env')).status, 404);
});
test('Unconfigured provider rejects live data but permits demo', async (t) => {
  const source = createOddsSource({ apiKey: '' });
  const { server, base } = await localServer(source);
  t.after(() => server.close());
  const live = await fetch(base + '/api/slate?mode=live');
  assert.equal(live.status, 503);
  assert.equal((await live.json()).error.code, 'SETUP_REQUIRED');
  assert.equal((await fetch(base + '/api/slate?mode=demo')).status, 200);
});
test('Odds provider cache avoids duplicate credits', async () => {
  let calls = 0, seenUrl = '';
  const fetchImpl = async (url) => {
    calls++; seenUrl = url.toString();
    return new Response(JSON.stringify(demoEvents('americanfootball_nfl', NOW)), {
      status: 200, headers: { 'x-requests-remaining': '496', 'x-requests-last': '1' }
    });
  };
  const source = createOddsSource({ apiKey: 'SERVER_SIDE_SECRET', fetchImpl, clock: () => NOW, ttlMs: 90000 });
  assert.equal((await source.getOdds('americanfootball_nfl', 'h2h')).cacheHit, false);
  assert.equal((await source.getOdds('americanfootball_nfl', 'h2h')).cacheHit, true);
  assert.equal(calls, 1);
  assert.match(seenUrl, /markets=h2h/);
  assert.equal(source.status().quota.remaining, 496);
  assert.equal(JSON.stringify(source.status()).includes('SERVER_SIDE_SECRET'), false);
  await assert.rejects(source.getOdds('unknown_sport', 'h2h'), { code: 'INVALID_FILTER' });
});
test('Provider errors never echo private credentials', async () => {
  const source = createOddsSource({
    apiKey: 'SUPER_PRIVATE_KEY', fetchImpl: async () => new Response('unauthorized', { status: 401 })
  });
  await assert.rejects(source.getOdds('americanfootball_nfl', 'h2h'), err => {
    assert.equal(err.code, 'API_KEY_REJECTED');
    assert.equal(err.message.includes('SUPER_PRIVATE_KEY'), false);
    return true;
  });
});
