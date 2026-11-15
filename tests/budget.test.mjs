import test from 'node:test';
import assert from 'node:assert/strict';
import {createOddsSource} from '../src/odds.mjs';
import {configuredProviderBudget} from '../src/configured-provider-budget.mjs';
import {mockBudget} from './helpers/mock-budget.mjs';
const NOW=Date.parse('2026-11-07T12:00:00Z');
const fixture=(headers={})=>new Response('[]',{headers});
const paid={allowPaid:true};

test('Unconfigured durable store never reaches even an injected provider',async()=>{
  let calls=0;
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:configuredProviderBudget({env:{}}),
    fetchImpl:async()=>{calls++;return fixture();}});
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h',paid),{code:'DURABLE_BUDGET_REQUIRED'});
  assert.equal(calls,0);
  assert.equal((await source.status()).budget.ready,false);
});

test('Direct source reads default to cache-only even with a ready injected ledger',async()=>{
  let calls=0;
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:mockBudget(),
    fetchImpl:async()=>{calls++;return fixture();}});
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),{code:'PAID_REFRESH_REQUIRED'});
  await assert.rejects(source.getScores('americanfootball_nfl'),{code:'PAID_REFRESH_REQUIRED'});
  assert.equal(calls,0);
});

test('Restarted source shares daily budget through the injected ledger; no local reset',async()=>{
  let calls=0;
  const budgetStore=mockBudget({dailyCreditCap:2,clock:()=>NOW});
  const options={apiKey:'OFFLINE_FIXTURE',budgetStore,clock:()=>NOW,
    fetchImpl:async()=>{calls++;return fixture();}};
  await createOddsSource(options).getOdds('americanfootball_nfl','h2h',paid);
  await createOddsSource(options).getOdds('americanfootball_nfl','h2h',paid);
  await assert.rejects(createOddsSource(options).getOdds('americanfootball_nfl','h2h',paid),{code:'API_DAILY_BUDGET'});
  assert.equal(calls,2);
});

test('Source never lowers a high operator reserve floor',async()=>{
  let calls=0;
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',
    budgetStore:mockBudget({reserveCredits:9000,remaining:7000}),
    fetchImpl:async()=>{calls++;return fixture();}});
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h',paid),{code:'PROVIDER_CREDIT_RESERVE'});
  assert.equal(calls,0);
  assert.equal((await source.status()).budget.minimumProviderCredits,9000);
});

test('Credit reservation occurs before request and reconciliation before payload caching',async()=>{
  const order=[];
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:{
    reserve:async({estimatedCredits})=>{order.push('reserve:'+estimatedCredits);return {id:'fixture'};},
    reconcile:async(reservation,quota)=>{assert.equal(reservation.id,'fixture');assert.equal(quota.last,2);order.push('reconcile');},
    status:async()=>({ready:true})
  },fetchImpl:async(url,init)=>{order.push('fetch');assert.equal(init.redirect,'error');return fixture({'x-requests-last':'2'});}});
  await source.getScores('americanfootball_nfl',paid);
  assert.deepEqual(order,['reserve:2','fetch','reconcile']);
  assert.equal((await source.getScores('americanfootball_nfl')).cacheHit,true);
});

test('Provider errors and malformed JSON still persist provider charge headers',async()=>{
  for(const [body,status,code] of [['bad',502,'UPSTREAM_ERROR'],['{bad',200,'INVALID_PROVIDER_JSON']]){
    let reconciled=0;
    const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:{
      reserve:async()=>({id:'fixture'}),status:async()=>({}),
      reconcile:async(_,quota)=>{reconciled++;assert.equal(quota.remaining,70);}
    },fetchImpl:async()=>new Response(body,{status,headers:{'x-requests-remaining':'70','x-requests-last':'2'}})});
    await assert.rejects(source.getScores('americanfootball_nfl',paid),{code});
    assert.equal(reconciled,1);
  }
});

test('Unavailable reconciliation never returns or caches provider result',async()=>{
  let calls=0;
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:{
    reserve:async()=>({id:'fixture'}),status:async()=>({ready:false}),
    reconcile:async()=>{throw Error('fixture database secret should be hidden');}
  },fetchImpl:async()=>{calls++;return fixture();}});
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h',paid),error=>{
    assert.equal(error.code,'DURABLE_BUDGET_UNAVAILABLE');assert.doesNotMatch(error.message,/secret/);return true;
  });
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),{code:'PAID_REFRESH_REQUIRED'});
  assert.equal(calls,1);
});

test('Ledger outage preserves fresh public cache without authorizing provider calls',async()=>{
  let failed=false,calls=0;
  const ledger=mockBudget();
  const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:{
    reserve:async args=>{if(failed)throw Error('offline');return ledger.reserve(args);},
    reconcile:(...args)=>ledger.reconcile(...args),status:async()=>{if(failed)throw Error('offline');return ledger.status();}
  },fetchImpl:async()=>{calls++;return fixture();}});
  await source.getOdds('americanfootball_nfl','h2h',paid);
  failed=true;
  assert.equal((await source.getOdds('americanfootball_nfl','h2h')).cacheHit,true);
  assert.equal((await source.status()).budget.ready,false);
  assert.equal(calls,1);
});

test('Missing and malformed quota headers never become an invented zero',async()=>{
  for(const value of [null,'',' ','-1','1.5','Infinity','9007199254740992']){
    const headers=value===null?{}:{'x-requests-remaining':value};
    let seen;
    const source=createOddsSource({apiKey:'OFFLINE_FIXTURE',budgetStore:{
      reserve:async()=>({id:'fixture'}),reconcile:async(_,quota)=>{seen=quota;},status:async()=>({})
    },fetchImpl:async()=>fixture(headers)});
    await source.getOdds('americanfootball_nfl','h2h',paid);
    assert.equal(seen.remaining,null);
  }
});

test('Zero daily budget blocks simultaneous requests across independent sources',async()=>{
  let calls=0;
  const budgetStore=mockBudget({dailyCreditCap:0});
  const results=await Promise.allSettled(Array.from({length:20},()=>createOddsSource({
    apiKey:'OFFLINE_FIXTURE',budgetStore,fetchImpl:async()=>{calls++;return fixture();}
  }).getOdds('americanfootball_nfl','h2h',paid)));
  assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='API_DAILY_BUDGET'));
  assert.equal(calls,0);
});
