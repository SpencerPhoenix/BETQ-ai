import test from 'node:test';
import assert from 'node:assert/strict';
import { toDecimal, impliedProbability, noVigPair, expectedValue, kellyFraction, median, analyzeEvents } from '../src/engine.mjs';
import { demoEvents } from '../src/demo.mjs';
const NOW = Date.parse('2026-11-01T20:00:00Z');
const base = (market = 'h2h', events = demoEvents('americanfootball_nfl', NOW), asOf = NOW) =>
  analyzeEvents(events, { sport: 'americanfootball_nfl', market, asOf, demo: true });

test('American odds convert correctly and reject malformed prices', () => {
  assert.equal(toDecimal(150), 2.5);
  assert.equal(toDecimal(-200), 1.5);
  assert.equal(impliedProbability(100), 0.5);
  assert.equal(impliedProbability(-100), 0.5);
  assert.equal(toDecimal(0), null);
  assert.equal(toDecimal(99), null);
  assert.equal(toDecimal(Infinity), null);
});
test('Two-way no-vig probabilities sum to one', () => {
  const p = noVigPair(-120, 110);
  assert.ok(Math.abs(p[0] + p[1] - 1) < 1e-10);
  assert.ok(p[0] > p[1]);
  assert.equal(noVigPair(0, -110), null);
});
test('EV, Kelly and median arithmetic', () => {
  assert.equal(expectedValue(0.5, 100), 0);
  assert.ok(Math.abs(expectedValue(0.6, 100) - 0.2) < 1e-12);
  assert.ok(Math.abs(kellyFraction(0.6, 100) - 0.2) < 1e-12);
  assert.equal(kellyFraction(0.1, -110), 0);
  assert.equal(median([0.3, 0.1, 0.2]), 0.2);
  assert.equal(median([0.1, 0.3]), 0.2);
  assert.equal(median([]), null);
});
test('Demo slate is labeled, ranked and never independently validated', () => {
  const result = base();
  assert.equal(result.demo, true);
  assert.equal(result.source, 'SYNTHETIC_DEMO');
  assert.equal(result.independentlyValidated, false);
  assert.equal(result.summary.games, 3);
  assert.ok(result.summary.signals >= 6);
  assert.ok(result.events.some(e => e.topSignal));
  assert.ok(result.events.every(e => e.demo));
});
test('Best-price book never participates in its own baseline', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  const before = base('h2h', events).events[0].opportunities.find(s => s.side === 'home');
  const edited = structuredClone(events);
  const quote = edited[0].bookmakers.find(b => b.key === before.bookmakerKey);
  quote.markets.find(m => m.key === 'h2h').outcomes.find(o => o.name === edited[0].home_team).price += 10;
  const after = base('h2h', edited).events[0].opportunities.find(s => s.side === 'home');
  assert.equal(after.bookmakerKey, before.bookmakerKey);
  assert.equal(after.fairProbability, before.fairProbability);
  assert.notEqual(after.evPercent, before.evPercent);
});
test('Spreads at different lines do not become interchangeable quotes', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  events[0].bookmakers[0].markets.find(m => m.key === 'spreads').outcomes
    .forEach(o => { o.point = o.name === events[0].home_team ? -4.5 : 4.5; });
  const slate = base('spreads', events);
  const entries = slate.events[0].opportunities;
  const alternate = entries.filter(x => x.contractId === 'spread:-4.5');
  assert.equal(alternate.length, 2);
  assert.ok(alternate.every(x => x.status === 'PASS'));
  assert.ok(entries.some(x => x.contractId === 'spread:-3.5'));
});
test('Totals at different points are strictly separated', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  const quote = events[0].bookmakers[0].markets.find(m => m.key === 'totals');
  quote.outcomes.forEach(o => { o.point = 48.5; });
  const slate = base('totals', events);
  assert.ok(slate.events[0].opportunities.some(x => x.contractId === 'total:48.5'));
  assert.ok(slate.events[0].opportunities.some(x => x.contractId === 'total:47.5'));
  assert.ok(slate.events[0].opportunities.filter(x => x.contractId === 'total:48.5').every(x => x.status === 'PASS'));
});
test('Any started game is blocked from WATCH status', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  events[0].commence_time = new Date(NOW - 1000).toISOString();
  const result = base('h2h', events);
  assert.ok(result.events[0].opportunities.every(x => x.status === 'PASS'));
  assert.ok(result.events[0].opportunities.every(x => x.reasons.includes('KICKOFF_STARTED')));
});
test('A one-book market cannot produce a WATCH label', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  events[0].bookmakers = events[0].bookmakers.slice(0, 1);
  const result = base('h2h', events);
  assert.ok(result.events[0].opportunities.every(x => x.status === 'PASS'));
  assert.ok(result.events[0].opportunities.every(x => x.reasons.includes('INSUFFICIENT_COMPARATORS')));
});
test('Old quotes are removed rather than counted as fresh', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  events[0].bookmakers.forEach(book => book.markets.forEach(m => {
    m.last_update = new Date(NOW - 3600000).toISOString();
  }));
  const result = base('h2h', events);
  assert.equal(result.events[0].opportunities.length, 0);
});
test('Unknown teams and unsupported markets fail closed', () => {
  const events = demoEvents('americanfootball_nfl', NOW);
  events[0].bookmakers[0].markets.find(m => m.key === 'h2h').outcomes[0].name = 'UNKNOWN';
  assert.equal(base('h2h', events).events[0].opportunities[0].booksAtLine, 3);
  assert.throws(() => base('player_props'), /Unsupported market/);
  assert.equal(base('h2h', [{ id: 'x', home_team: 'A', away_team: 'B', bookmakers: null }]).summary.games, 0);
});
