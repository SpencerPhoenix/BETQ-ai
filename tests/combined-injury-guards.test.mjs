import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {createTestOddsSource} from './helpers/mock-budget.mjs';

const NOW=Date.parse('2026-11-07T23:30:00.000Z');
const TOKEN='SYNTHETIC_OPERATOR_TEST_012345678901';
const paid={headers:{'x-betq-paid-request':'true',authorization:'Bearer '+TOKEN}};
async function serve(t,options){
  const server=http.createServer(createHandler(options));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return (path,init)=>fetch('http://127.0.0.1:'+server.address().port+path,init);
}

test('Integrated free injury reads do not authorize odds refresh or bypass authentication and cache-only admission',async t=>{
  let oddsCalls=0,injuryReads=0;
  const source=createTestOddsSource({apiKey:'SYNTHETIC_TEST_KEY',clock:()=>NOW,
    fetchImpl:async()=>{oddsCalls++;return new Response('[]');}});
  const injuryFeed={status:()=>({available:false}),get:async()=>{
    injuryReads++;return {artifact:null,status:{available:false}};
  }};
  const get=await serve(t,{source,clock:()=>NOW,operatorRefreshToken:TOKEN,injuryFeed,
    shadowStore:{capture:async()=>({captured:false})}});
  assert.equal((await get('/api/slate')).status,409);
  assert.equal((await get('/api/slate',{headers:{'x-betq-paid-request':'true'}})).status,401);
  assert.equal(oddsCalls,0);assert.equal(injuryReads,0);
  assert.equal((await get('/api/injuries/nfl')).status,200);
  assert.equal(oddsCalls,0);assert.equal(injuryReads,1);
  assert.equal((await get('/api/slate',paid)).status,200);
  assert.equal(oddsCalls,1);assert.equal(injuryReads,2);
  assert.equal((await get('/api/slate')).status,200);
  assert.equal(oddsCalls,1);assert.equal(injuryReads,3);
  assert.equal((await get('/api/slate',{...paid,method:'HEAD'})).status,405);
  assert.equal((await get('/api/slate?mode=demo')).status,200);
  assert.equal(injuryReads,3);assert.equal((await source.status()).budget.used,1);
});

test('Integrated injury read cannot bypass a zero budget even with valid operator intent',async t=>{
  let oddsCalls=0,injuryReads=0;
  const source=createTestOddsSource({apiKey:'SYNTHETIC_TEST_KEY',clock:()=>NOW,dailyCreditCap:0,
    fetchImpl:async()=>{oddsCalls++;throw Error('provider must not be reached');}});
  const get=await serve(t,{source,clock:()=>NOW,operatorRefreshToken:TOKEN,
    injuryFeed:{status:()=>({available:false}),get:async()=>{injuryReads++;return {artifact:null,status:{available:false}};}}});
  const denied=await get('/api/slate',paid);assert.equal(denied.status,429);
  assert.equal((await denied.json()).error.code,'API_DAILY_BUDGET');
  assert.equal(oddsCalls,0);assert.equal(injuryReads,0);
});

test('Waiting for injury delivery reevaluates kickoff and cannot retain a pregame model',async t=>{
  let now=NOW;
  const event={id:'synthetic-delay',home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    commence_time:new Date(NOW+500).toISOString(),neutralSite:true,bookmakers:[]};
  const source={status:()=>({configured:false}),getOdds:async(_sport,_market,options)=>{
    assert.equal(options.allowPaid,false);
    return {events:[event],receivedAt:new Date(NOW).toISOString(),cacheHit:true};
  }};
  const get=await serve(t,{source,clock:()=>now,
    injuryFeed:{status:()=>({available:false}),get:async()=>{now=NOW+1000;return {artifact:null,status:{available:false}};}}});
  const response=await get('/api/slate');assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.events[0].started,true);
  assert.equal(result.events[0].independentModel.available,false);
  assert.equal(result.events[0].independentModel.reason,'GAME_ALREADY_STARTED');
});

test('Health derives both injury availability fields from one clock observation without a fetch',async t=>{
  let observations=0;
  const get=await serve(t,{source:{status:()=>({configured:false})},clock:()=>NOW,
    injuryFeed:{status:()=>({available:++observations===1}),get:()=>{throw Error('health must not fetch');}}});
  const health=await (await get('/api/health')).json();
  assert.equal(observations,1);
  assert.equal(health.nflIntelligence.injurySourceAvailable,health.nflIntelligence.injurySource.available);
});
