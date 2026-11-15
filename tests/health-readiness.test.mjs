import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHandler} from '../src/server.mjs';
import {createOddsSource} from '../src/odds.mjs';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const TOKEN = 'OFFLINE_OPERATOR_FIXTURE_0123456789';
const readyStatus = () => ({
  configured: true, lastSuccess: null, lastError: null,
  quota: {remaining: 100, used: 0, last: null}, cacheEntries: 0,
  budget: {persistent: true, available: true, ready: true, reason: null}
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(source, options = {}) {
  const handler = createHandler({
    source, clock: () => NOW, operatorRefreshToken: TOKEN,
    nflEvidenceJournal: null, nflArtifact: null, nflEfficiency: null, nflInjuries: null,
    ...options
  });
  return async (path = '/api/health', {method = 'GET', headers = {}} = {}) => {
    const response = {headers: {}};
    await handler({method, url: path, headers, socket: {remoteAddress: 'offline-test'}}, {
      setHeader(name, value) { response.headers[name] = value; },
      writeHead(status, values) { response.status = status; Object.assign(response.headers, values); },
      end(body) { response.body = body ? JSON.parse(body) : null; }
    });
    return response;
  };
}
function assertUnavailable(response, reason) {
  assert.equal(response.status, 200, 'web liveness must not depend on the ledger');
  assert.equal(response.body.status, 'ok');
  assert.deepEqual(response.body.captureReadiness, {
    ready: false, reason, scope: 'PROVIDER_REFRESH_PREREQUISITES_ONLY'
  });
  assert.equal(response.body.odds.budget.available, false);
  assert.equal(response.body.odds.budget.ready, false);
  assert.equal(response.body.odds.budget.reason, reason);
  assert.equal(response.body.collectionHealth.liveFreshnessVerified, false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
}

test('Normal health preserves its contract and rechecks rather than caching ready', async () => {
  let calls = 0;
  const status = readyStatus();
  const get = fixture({status: () => { calls++; return status; }});
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.app, 'BETQ.ai');
  assert.equal(response.body.serverTime, new Date(NOW).toISOString());
  assert.deepEqual(response.body.odds, status);
  assert.deepEqual(response.body.captureReadiness, {
    ready: true, reason: null, scope: 'PROVIDER_REFRESH_PREREQUISITES_ONLY'
  });
  assert.deepEqual(response.body.operatorRefresh, {
    configured: true, authenticationRequired: true, paidIntentRequired: true
  });
  assert.equal(response.body.collectionHealth.liveFreshnessVerified, false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  status.budget.ready = false;
  status.budget.reason = 'BUDGET_OUTCOME_UNKNOWN';
  const next = await get();
  assert.equal(calls, 2);
  assert.equal(next.body.captureReadiness.ready, false);
  assert.equal(next.body.captureReadiness.reason, 'BUDGET_OUTCOME_UNKNOWN');
});

test('A timely status cannot bypass source, operator, or durable budget prerequisites', async () => {
  for (const [overrides, options, reason] of [
    [{configured: false}, {}, 'LIVE_ODDS_SOURCE_NOT_CONFIGURED'],
    [{}, {operatorRefreshToken: ''}, 'OPERATOR_REFRESH_NOT_CONFIGURED'],
    [{budget: {persistent: false, available: true, ready: true}}, {}, 'DURABLE_BUDGET_NOT_READY'],
    [{budget: {persistent: true, available: false, ready: true}}, {}, 'DURABLE_BUDGET_NOT_READY'],
    [{budget: {persistent: true, available: true, ready: false}}, {}, 'DURABLE_BUDGET_NOT_READY']
  ]) {
    const get = fixture({status: () => ({...readyStatus(), ...overrides})}, options);
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.body.captureReadiness.ready, false);
    assert.equal(response.body.captureReadiness.reason, reason);
  }
});

test('Thrown and rejected status checks fail closed without exposing error details', async () => {
  for (const status of [
    () => { throw Error('private ledger connection details'); },
    () => Promise.reject(Error('private ledger connection details'))
  ]) {
    const get = fixture({configured: true, status});
    const response = await get();
    assertUnavailable(response, 'ODDS_STATUS_UNAVAILABLE');
    assert.equal(response.body.odds.configured, true);
    assert.doesNotMatch(JSON.stringify(response), /private ledger|OFFLINE_OPERATOR_FIXTURE/);
    assertUnavailable(await get(), 'ODDS_STATUS_UNAVAILABLE');
  }
});

test('Malformed status cannot claim readiness or break web liveness', async () => {
  for (const status of [null, undefined, {}, {...readyStatus(), configured: 'true'}]) {
    const response = await fixture({status: () => status})();
    assertUnavailable(response, 'ODDS_STATUS_UNAVAILABLE');
    assert.equal(response.body.odds.configured, null, 'unknown configuration is not reported as missing');
  }
});

test('A hung check has a 500 ms deadline and repeated concurrent probes never multiply work', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0, completed = 0;
  const get = fixture({configured: true, status: () => { calls++; return new Promise(() => {}); }});
  const requests = Array.from({length: 40}, () => get().then(response => { completed++; return response; }));
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(499);
  await flush();
  assert.equal(completed, 0);
  requests.push(get().then(response => { completed++; return response; }));
  t.mock.timers.tick(1);
  for (const response of await Promise.all(requests)) assertUnavailable(response, 'ODDS_STATUS_TIMEOUT');
  assert.equal(completed, 41, 'a late joiner shares the original deadline');
  for (const response of await Promise.all(Array.from({length: 100}, () => get()))) {
    assertUnavailable(response, 'ODDS_STATUS_TIMEOUT');
  }
  t.mock.timers.tick(60000);
  assertUnavailable(await get(), 'ODDS_STATUS_TIMEOUT');
  assert.equal(calls, 1, 'a timeout is not permission to launch another still-pending ledger check');
});

test('A previous ready response is not reused when the next status check hangs', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0;
  const get = fixture({status: () => ++calls === 1 ? readyStatus() : new Promise(() => {})});
  assert.equal((await get()).body.captureReadiness.ready, true);
  const next = get();
  await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(500);
  assertUnavailable(await next, 'ODDS_STATUS_TIMEOUT');
});

test('Concurrent checks share a slow result before the deadline, then require a fresh check', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0;
  const pending = deferred();
  let result = pending.promise;
  const get = fixture({status: () => { calls++; return result; }});
  const requests = Array.from({length: 20}, () => get());
  await flush();
  t.mock.timers.tick(250);
  pending.resolve(readyStatus());
  for (const response of await Promise.all(requests)) assert.equal(response.body.captureReadiness.ready, true);
  assert.equal(calls, 1);
  result = {...readyStatus(), budget: {persistent: true, available: true, ready: false, reason: 'BUDGET_OUTCOME_UNKNOWN'}};
  const next = await get();
  assert.equal(calls, 2);
  assert.equal(next.body.captureReadiness.reason, 'BUDGET_OUTCOME_UNKNOWN');
  t.mock.timers.tick(1000);
});

test('A result after the monotonic deadline fails closed even before the timer callback runs', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let monotonic = 0;
  t.mock.method(performance, 'now', () => monotonic);
  const pending = deferred();
  const get = fixture({status: () => pending.promise});
  const response = get();
  await flush();
  monotonic = 501;
  pending.resolve(readyStatus());
  assertUnavailable(await response, 'ODDS_STATUS_TIMEOUT');
});

test('Late success is discarded and recovery waits for a new, timely readiness check', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const late = deferred(), fresh = deferred();
  let calls = 0;
  const get = fixture({configured: true, status: () => ++calls === 1 ? late.promise : fresh.promise});
  const first = get();
  await flush();
  t.mock.timers.tick(500);
  assertUnavailable(await first, 'ODDS_STATUS_TIMEOUT');
  assertUnavailable(await get(), 'ODDS_STATUS_TIMEOUT');
  assert.equal(calls, 1);
  late.resolve(readyStatus());
  await flush();
  let completed = false;
  const next = get().then(value => { completed = true; return value; });
  await flush();
  assert.equal(calls, 2);
  assert.equal(completed, false, 'the late ready result must never be cached');
  fresh.resolve(readyStatus());
  assert.equal((await next).body.captureReadiness.ready, true);
});

test('A rejection after timeout is handled and does not prevent a later fresh check', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const pending = deferred();
  let calls = 0;
  const get = fixture({status: () => ++calls === 1 ? pending.promise : readyStatus()});
  const first = get();
  await flush();
  t.mock.timers.tick(500);
  assertUnavailable(await first, 'ODDS_STATUS_TIMEOUT');
  pending.reject(Error('private late rejection'));
  await flush();
  const response = await get();
  assert.equal(response.body.captureReadiness.ready, true);
  assert.equal(calls, 2);
});

test('Health timeout neither spends provider credits nor bypasses paid-request gates', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let statusCalls = 0, reservations = 0, providerCalls = 0;
  const source = createOddsSource({
    apiKey: 'OFFLINE_SOURCE_FIXTURE', clock: () => NOW,
    fetchImpl: async () => { providerCalls++; throw Error('must never reach the provider'); },
    budgetStore: {
      status: () => { statusCalls++; return new Promise(() => {}); },
      reserve: async () => {
        reservations++;
        throw Object.assign(Error('offline blocked ledger'), {code: 'DURABLE_BUDGET_UNAVAILABLE', status: 503});
      }
    }
  });
  const get = fixture(source);
  const health = get();
  await flush();
  t.mock.timers.tick(500);
  assertUnavailable(await health, 'ODDS_STATUS_TIMEOUT');
  for (const path of ['/api/slate', '/api/scores']) {
    const ordinary = await get(path);
    assert.equal(ordinary.status, 409);
    assert.equal(ordinary.body.error.code, 'PAID_REFRESH_REQUIRED');
    const unauthenticated = await get(path, {headers: {'x-betq-paid-request': 'true'}});
    assert.equal(unauthenticated.status, 401);
    const authorized = await get(path, {headers: {
      'x-betq-paid-request': 'true', authorization: 'Bearer ' + TOKEN
    }});
    assert.equal(authorized.status, 503);
    assert.equal(authorized.body.error.code, 'DURABLE_BUDGET_UNAVAILABLE');
  }
  assert.equal(statusCalls, 1);
  assert.equal(reservations, 2, 'authenticated paid intent still requires a separate budget reservation');
  assert.equal(providerCalls, 0);
  assertUnavailable(await get(), 'ODDS_STATUS_TIMEOUT');
});
