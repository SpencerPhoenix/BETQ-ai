import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEvents, noVigPair, expectedValue, kellyFraction } from '../src/engine.mjs';
import { createOddsSource } from '../src/odds.mjs';
import { demoEvents } from '../src/demo.mjs';

const NOW = Date.parse('2026-11-01T20:00:00Z');
let seed = 104729;
const rand = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const randomOdds = () => {
  const x = 100 + Math.floor(rand() * 250);
  return rand() < 0.5 ? x : -x;
};

test('Randomized no-vig and EV arithmetic stays bounded over 3000 price sets', () => {
  for (let n = 0; n < 3000; n++) {
    const [a, b] = [randomOdds(), randomOdds()];
    const fair = noVigPair(a, b);
    assert.ok(fair[0] >= 0 && fair[0] <= 1);
    assert.ok(fair[1] >= 0 && fair[1] <= 1);
    assert.ok(Math.abs(fair[0] + fair[1] - 1) <= 1e-12);
    assert.ok(Number.isFinite(expectedValue(fair[0], a)));
    assert.ok(kellyFraction(fair[0], a) >= 0 && kellyFraction(fair[0], a) <= 1);
  }
});

test('Randomized market snapshots never generate WATCH from stale/started events', () => {
  for (let n = 0; n < 300; n++) {
    const events = demoEvents('americanfootball_nfl', NOW);
    for (const event of events) {
      const timing = rand();
      if (timing < 0.33) event.commence_time = new Date(NOW - 600000).toISOString();
      if (timing > 0.66) event.commence_time = new Date(NOW + 30000).toISOString();
      for (const book of event.bookmakers) {
        for (const market of book.markets) {
          if (rand() < 0.30) market.last_update = new Date(NOW - 1800000).toISOString();
          if (market.key === 'spreads' && rand() < 0.30) {
            const line = -(1.5 + Math.floor(rand() * 10));
            market.outcomes[0].point = line;
            market.outcomes[1].point = -line;
          }
        }
      }
    }
    for (const market of ['h2h', 'spreads', 'totals']) {
      const result = analyzeEvents(events, { sport: 'americanfootball_nfl', market, asOf: NOW, demo: true });
      for (const ev of result.events) for (const signal of ev.opportunities) {
        assert.ok(signal.fairProbability === null || (signal.fairProbability >= 0 && signal.fairProbability <= 1));
        assert.ok(signal.impliedProbability > 0 && signal.impliedProbability < 1);
        if (signal.status === 'WATCH') {
          assert.equal(ev.started, false);
          assert.ok(Date.parse(ev.commenceTime) - NOW >= 300000);
          assert.ok(signal.comparatorBooks >= 2);
          assert.ok(signal.quoteAgeSeconds <= 600);
          assert.ok(signal.evPercent >= 1.5);
          assert.ok(signal.theoreticalUnits <= 1);
        } else {
          assert.equal(signal.theoreticalUnits, 0);
        }
      }
    }
  }
});

test('50 simultaneous feed calls are coalesced to one provider request', async () => {
  let count = 0;
  const source = createOddsSource({
    apiKey: 'SAFE_TEST_KEY',
    clock: () => NOW,
    ttlMs: 60000,
    fetchImpl: async () => {
      count++;
      await Promise.resolve();
      return new Response(JSON.stringify(demoEvents('americanfootball_nfl', NOW)), { status: 200 });
    }
  });
  const results = await Promise.all(Array.from({ length: 50 },
    () => source.getOdds('americanfootball_nfl', 'h2h')));
  assert.equal(count, 1);
  assert.equal(results.length, 50);
  assert.ok(results.every(r => r.events.length === 3));
});

test('Provider malformed payloads fail with safe explicit errors', async () => {
  const wrong = createOddsSource({ apiKey: 'SAFE_TEST_KEY', fetchImpl: async () =>
    new Response(JSON.stringify({ events: [] }), { status: 200 }) });
  await assert.rejects(wrong.getOdds('americanfootball_nfl', 'h2h'), { code: 'INVALID_PROVIDER_DATA' });
  const broken = createOddsSource({ apiKey: 'SAFE_TEST_KEY', fetchImpl: async () =>
    new Response('{broken', { status: 200 }) });
  await assert.rejects(broken.getOdds('americanfootball_nfl', 'h2h'), { code: 'INVALID_PROVIDER_JSON' });
});
