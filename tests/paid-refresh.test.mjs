import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/server.mjs';
import {createTestOddsSource as createOddsSource} from './helpers/mock-budget.mjs';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const TOKEN='OFFLINE_OPERATOR_FIXTURE_0123456789';
const PAID = { headers: { 'x-betq-paid-request': 'true',authorization:'Bearer '+TOKEN } };
async function fixture(t, { dailyCreditCap = 12, fetchImpl } = {}) {
  let now = NOW, calls = 0, captures = 0;
  const source = createOddsSource({
    apiKey: 'TEST_FIXTURE_ONLY', clock: () => now, ttlMs: 5000, dailyCreditCap,
    fetchImpl: async (...args) => {
      calls++;
      return fetchImpl ? fetchImpl(...args) : new Response('[]', { status: 200 });
    }
  });
  const server = http.createServer(createHandler({
    source, clock: () => now, operatorRefreshToken:TOKEN,
    shadowStore: { capture: async () => { captures++; return { captured: false }; } },
    evidenceFeed: { get: async () => ({ researchOnly: true }) }
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {
    source, calls: () => calls, captures: () => captures,
    advance: ms => { now += ms; },
    get: (path, init) => fetch('http://127.0.0.1:' + server.address().port + path, init)
  };
}
async function blocked(response) {
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'PAID_REFRESH_REQUIRED');
}

test('Cold page, static assets, config and default live requests spend zero provider credits', async t => {
  const f = await fixture(t);
  for (const path of ['/', '/app.js', '/api/health', '/api/config', '/api/evidence/nfl', '/api/slate?mode=demo']) {
    assert.equal((await f.get(path)).status, 200, path);
  }
  for (const path of ['/api/slate', '/api/slate?mode=live', '/api/scores']) await blocked(await f.get(path));
  assert.equal((await (await f.get('/api/config')).json()).paidRefreshRequiresExplicitRequest, true);
  assert.equal(f.calls(), 0);
  assert.equal(f.captures(), 0);
  assert.equal((await f.source.status()).budget.used, 0);
});

test('Only explicit paid intent plus operator authentication authorizes a cold GET', async t => {
  const f = await fixture(t);
  for (const value of ['', 'false', '1', 'True', 'true, true']) {
    await blocked(await f.get('/api/slate?mode=live', { headers: { 'x-betq-paid-request': value } }));
  }
  await blocked(await f.get('/api/slate?allowPaid=true&refresh=1'));
  assert.equal(f.calls(), 0);
  for(const headers of [{'x-betq-paid-request':'true'},{'x-betq-paid-request':'true',authorization:'Bearer wrong-token'}]){
    assert.equal((await f.get('/api/slate',{headers})).status,401);
  }
  assert.equal(f.calls(),0);
  assert.equal((await f.get('/api/slate?mode=live', PAID)).status, 200);
  assert.equal(f.calls(), 1);
  assert.equal((await f.source.status()).budget.used, 1);
});

test('Explicit refresh populates cache; ordinary reads stay free and expired reads fail closed', async t => {
  const f = await fixture(t);
  const first = await (await f.get('/api/slate', PAID)).json();
  assert.equal(first.cacheHit, false);
  const cached = await (await f.get('/api/slate')).json();
  assert.equal(cached.cacheHit, true);
  assert.equal(f.calls(), 1);
  assert.equal(f.captures(), 1, 'cached display must not capture a new private observation');
  await blocked(await f.get('/api/slate?sport=basketball_nba'));
  await blocked(await f.get('/api/slate?market=spreads'));
  f.advance(5000);
  await blocked(await f.get('/api/slate'));
  assert.equal(f.calls(), 1);
  assert.equal((await f.source.status()).budget.used, 1);
  assert.equal((await f.get('/api/slate', PAID)).status, 200);
  assert.equal(f.calls(), 2);
});

test('HEAD and disallowed methods cannot spend credits even with an explicit header', async t => {
  const f = await fixture(t);
  for (const path of ['/api/slate', '/api/slate?mode=live', '/api/scores']) {
    for (const method of ['HEAD', 'POST', 'OPTIONS']) {
      const response = await f.get(path, { ...PAID, method });
      assert.equal(response.status, 405, method + ' ' + path);
    }
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.captures(), 0);
  assert.equal((await f.source.status()).budget.used, 0);
});

test('Explicit score refresh still reserves two credits and cannot bypass daily budget', async t => {
  const f = await fixture(t, { dailyCreditCap: 2 });
  await blocked(await f.get('/api/scores'));
  assert.equal((await f.get('/api/scores', PAID)).status, 200);
  assert.equal((await f.source.status()).budget.used, 2);
  const cached = await (await f.get('/api/scores')).json();
  assert.equal(cached.cacheHit, true);
  const rejected = await f.get('/api/slate', PAID);
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error.code, 'API_DAILY_BUDGET');
  assert.equal(f.calls(), 1);
});

test('Concurrent explicit requests coalesce, but a cache-only request cannot join paid inflight work', async () => {
  let calls = 0, finish;
  const source = createOddsSource({
    apiKey: 'TEST_FIXTURE_ONLY', clock: () => NOW,
    fetchImpl: () => { calls++; return new Promise(resolve => { finish = resolve; }); }
  });
  const pending = Array.from({ length: 20 }, () => source.getOdds('americanfootball_nfl', 'h2h', { allowPaid: true }));
  await assert.rejects(source.getOdds('americanfootball_nfl', 'h2h', { allowPaid: false }), { code: 'PAID_REFRESH_REQUIRED' });
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls, 1);
  finish(new Response('[]', { status: 200 }));
  await Promise.all(pending);
  assert.equal((await source.getOdds('americanfootball_nfl', 'h2h', { allowPaid: false })).cacheHit, true);
  assert.equal((await source.status()).budget.used, 1);
});

test('Failed paid fetch does not let subsequent cache-only display retry the provider', async t => {
  const f = await fixture(t, { fetchImpl: async () => new Response('unavailable', { status: 502 }) });
  assert.equal((await f.get('/api/slate', PAID)).status, 502);
  await blocked(await f.get('/api/slate'));
  assert.equal(f.calls(), 1);
  assert.equal((await f.source.status()).budget.used, 1);
});


test('Zero daily budget blocks even explicit HTTP refresh while demo and health remain available',async t=>{
  const f=await fixture(t,{dailyCreditCap:0});
  for(const path of ['/api/slate','/api/scores']){
    const response=await f.get(path,PAID);
    assert.equal(response.status,429);
    const body=await response.json();
    assert.equal(body.error.code,'API_DAILY_BUDGET');
    assert.match(body.error.message,/blocked/);
  }
  assert.equal((await f.get('/api/slate?mode=demo',PAID)).status,200);
  const health=await(await f.get('/api/health')).json();
  assert.equal(health.odds.budget.limit,0);
  assert.equal(health.odds.budget.used,0);
  assert.equal(f.calls(),0);
  assert.equal(f.captures(),0);
});

test('Bearer alone, invalid auth and query strings never permit paid work',async t=>{
  const f=await fixture(t);
  await blocked(await f.get('/api/slate',{headers:{authorization:'Bearer '+TOKEN}}));
  await blocked(await f.get('/api/slate?token='+TOKEN+'&paid=true'));
  for(const authorization of ['Bearer '+TOKEN+'x','Basic '+TOKEN,'Bearer '+TOKEN+', Bearer '+TOKEN]){
    const response=await f.get('/api/scores',{headers:{'x-betq-paid-request':'true',authorization}});
    assert.equal(response.status,401);
    assert.doesNotMatch(await response.text(),new RegExp(TOKEN));
  }
  assert.equal(f.calls(),0);
});

test('Health distinguishes running web server from blocked collection without secrets',async t=>{
  const source={status:async()=>({configured:true,budget:{persistent:true,available:true,ready:false,
    reason:'BUDGET_OUTCOME_UNKNOWN',unresolvedReservations:1}})};
  const server=http.createServer(createHandler({source,operatorRefreshToken:TOKEN}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/health');
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.status,'ok');
  assert.equal(body.captureReadiness.ready,false);
  assert.equal(body.captureReadiness.reason,'BUDGET_OUTCOME_UNKNOWN');
  assert.equal(body.operatorRefresh.authenticationRequired,true);
  assert.doesNotMatch(JSON.stringify(body),new RegExp(TOKEN));
});

test('Missing operator credential cannot enable paid work even with spoofed headers',async t=>{
  let calls=0;
  const server=http.createServer(createHandler({operatorRefreshToken:'',source:{
    status:async()=>({configured:true,budget:{persistent:true,available:true,ready:true}}),
    getOdds:async()=>{calls++;throw Error('must not be called');}
  }}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/api/slate',PAID);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error.code,'OPERATOR_REFRESH_NOT_CONFIGURED');
  const health=await(await fetch(base+'/api/health')).json();
  assert.equal(health.captureReadiness.ready,false);
  assert.equal(health.captureReadiness.reason,'OPERATOR_REFRESH_NOT_CONFIGURED');
  assert.equal(calls,0);
});
