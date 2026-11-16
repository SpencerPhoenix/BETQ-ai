import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHandler} from '../src/server.mjs';
import {describeMarketCaptureContract,MARKET_CAPTURE_CONTRACT_ID} from '../src/evidence-compat.mjs';
import {syntheticDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';

const NOW=Date.parse('2026-11-07T12:00:00.000Z');
const artifact=syntheticDeliveryArtifact('2026-11-07T11:00:00.000Z','2026-11-06');

test('actual read-only health advertises producer capability without provider access or readiness claims',async()=>{
  let paid=0,statusReads=0;
  const forbidden=()=>{paid++;throw Error('PROVIDER_REQUEST_FORBIDDEN');};
  const handler=createHandler({clock:()=>NOW,nflArtifact:artifact,nflEvidenceJournal:null,
    nflEfficiency:null,nflInjuries:null,operatorRefreshToken:'',
    source:{getOdds:forbidden,getScores:forbidden,status:()=>{statusReads++;return {configured:false};}}});
  const get=async()=>{
    let code,body;
    await handler({method:'GET',url:'/api/health',headers:{},socket:{remoteAddress:'offline-test'}},
      {setHeader(){},writeHead(value){code=value;},end(value){body=JSON.parse(value);}});
    assert.equal(code,200);return body;
  };
  const first=await get();
  assert.deepEqual(first.marketCaptureContract,describeMarketCaptureContract());
  assert.equal(first.captureReadiness.ready,false);
  assert.equal(first.captureReadiness.scope,'PROVIDER_REFRESH_PREREQUISITES_ONLY');
  assert.equal(first.collectionHealth.liveFreshnessVerified,false);
  assert.equal(first.operatorRefresh.configured,false);
  first.marketCaptureContract.maximumQuoteAgeMs=Number.MAX_SAFE_INTEGER;
  const next=await get();assert.equal(next.marketCaptureContract.maximumQuoteAgeMs,600000);
  assert.equal(next.marketCaptureContract.historicalBackfillAllowed,false);
  assert.equal(paid,0);assert.equal(statusReads,2);
});

async function collector(t,health){
  const directory=await mkdtemp(join(tmpdir(),'betq-market-contract-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));await mkdir(join(directory,'data'));
  await writeFile(join(directory,'data/nfl_elo.json'),JSON.stringify(artifact));
  const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
  const program=`Date.now=()=>${NOW};let paid=0,healthReads=0,scheduleReads=0;
    globalThis.fetch=async(input,options)=>{
      const url=String(input);
      if(url==='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'){
        scheduleReads++;return new Response('game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\\n');
      }
      if(url==='https://offline-betq.test/api/health'){
        healthReads++;
        if(options.headers.Authorization||options.headers.authorization||options.headers['x-betq-paid-request']||options.credentials!=='omit'||options.redirect!=='error')throw Error('UNSAFE_HEALTH_REQUEST');
        return Response.json(${JSON.stringify(health)});
      }
      if(url.startsWith('https://offline-betq.test/api/slate?')){paid++;throw Error('PAID_REQUEST_MUST_NOT_HAPPEN');}
      throw Error('UNEXPECTED_EXTERNAL_REQUEST '+url);
    };
    await import(${JSON.stringify(entry)});
    if(paid!==0||healthReads!==1||scheduleReads!==1)throw Error('BAD_REQUEST_COUNTS '+JSON.stringify({paid,healthReads,scheduleReads}));`;
  const output=execFileSync(process.execPath,['--input-type=module','-e',program],{
    cwd:directory,encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,BETQ_PRODUCTION_URL:'https://offline-betq.test',BETQ_OPERATOR_APPROVED_ORIGIN:'https://offline-betq.test',
      BETQ_OPERATOR_REFRESH_TOKEN:'OFFLINE_OPERATOR_FIXTURE_0123456789'}});
  const journal=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8'));
  assert.deepEqual(journal.snapshots,[]);assert.deepEqual(journal.settlements,[]);
  return output;
}

for(const variant of ['old producer','wrong policy','missing oldest proof','weakened book count','missing book identity policy','backfill allowed'])
  test('actual collector rejects '+variant+' before any paid slate request',async t=>{
    const health=modelHealthFixture(artifact,NOW);
    if(variant==='old producer')delete health.marketCaptureContract;
    if(variant==='wrong policy')health.marketCaptureContract.policy='NEWEST_QUOTE_ONLY';
    if(variant==='missing oldest proof')delete health.marketCaptureContract.absoluteOldestQuoteTimeRequired;
    if(variant==='weakened book count')health.marketCaptureContract.minimumDistinctBooks=2;
    if(variant==='missing book identity policy')delete health.marketCaptureContract.bookmakerIdentityPolicy;
    if(variant==='backfill allowed')health.marketCaptureContract.historicalBackfillAllowed=true;
    assert.equal(health.captureReadiness.ready,true); // Capability is an additional gate.
    assert.match(await collector(t,health),/SKIPPED: MODEL_RUNTIME_CONTRACT_INCOMPATIBLE/);
  });

function slateHarness(){
  let sourceReads=0,paidReads=0;
  const token='OFFLINE_OPERATOR_FIXTURE_0123456789';
  const handler=createHandler({clock:()=>NOW,nflArtifact:artifact,nflEvidenceJournal:null,nflEfficiency:null,nflInjuries:null,
    operatorRefreshToken:token,injuryFeed:{get:async()=>({artifact:null}),status:()=>({available:false})},
    shadowStore:{capture:async()=>({captured:false})},
    source:{getOdds:async(sport,market,options)=>{sourceReads++;if(options.allowPaid)paidReads++;
      return {events:[],receivedAt:new Date(NOW).toISOString(),cacheHit:true,quota:null};},status:()=>({configured:true})}});
  return {get sourceReads(){return sourceReads;},get paidReads(){return paidReads;},
    async get(query='',policy=undefined,extraHeaders={}){
      let code,body;const headers={...extraHeaders};
      if(policy!==undefined)headers['x-betq-expected-market-policy']=policy;
      await handler({method:'GET',url:'/api/slate'+query,headers,socket:{remoteAddress:'offline-test'}},
        {setHeader(){},writeHead(value){code=value;},end(value){body=JSON.parse(value);}});
      return {code,body};
    }};
}

test('market policy pin rejects malformed, mismatched and wrong-scope requests before any provider access',async()=>{
  const h=slateHarness(),policy=describeMarketCaptureContract().policy;
  for(const bad of ['',null,[],[policy],true,'older-policy',policy+' ',policy+','+policy]){
    const out=await h.get('',bad,{'x-betq-paid-request':'true',authorization:'Bearer OFFLINE_OPERATOR_FIXTURE_0123456789'});
    assert.equal(out.code,409);assert.equal(out.body.error.code,'MARKET_CAPTURE_POLICY_MISMATCH');
  }
  for(const query of ['?mode=demo','?sport=basketball_nba','?market=spreads','?market=totals']){
    const out=await h.get(query,policy);assert.equal(out.code,409);assert.equal(out.body.error.code,'MARKET_CAPTURE_POLICY_MISMATCH');
  }
  assert.equal(h.sourceReads,0);assert.equal(h.paidReads,0);
});

test('matching market pin advertises response capability without granting paid permission',async()=>{
  const h=slateHarness(),contract=describeMarketCaptureContract();
  const out=await h.get('',contract.policy);assert.equal(out.code,200);
  assert.deepEqual(out.body.marketCaptureContract,contract);
  assert.equal(h.sourceReads,1);assert.equal(h.paidReads,0);
  out.body.marketCaptureContract.minimumDistinctBooks=1;
  const ordinary=await h.get();assert.equal(ordinary.code,200);
  assert.deepEqual(ordinary.body.marketCaptureContract,contract);
  assert.equal(h.paidReads,0);
  for(const query of ['?mode=demo','?sport=basketball_nba','?market=spreads']){
    const other=await h.get(query);assert.equal(other.code,200);assert.equal(other.body.marketCaptureContract,null);
  }
  assert.equal(h.paidReads,0);
});


test('standalone read-only compatibility CLI refuses old producer metadata without any fetch',()=>{
  const health=modelHealthFixture(artifact,NOW);delete health.marketCaptureContract;
  const entry=new URL('../scripts/verify-evidence-health.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',
    `globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};await import(${JSON.stringify(entry)});`],
    {input:JSON.stringify(health),encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH}});
  assert.equal(result.status,1);assert.match(result.stderr,/MARKET_CAPTURE_CONTRACT_MISSING/);
  assert.doesNotMatch(result.stderr,/NETWORK_FORBIDDEN/);
});


test('composite market contract pin binds freshness and bookmaker identity before source access',async()=>{
  const h=slateHarness(),contract=describeMarketCaptureContract();
  assert.equal(MARKET_CAPTURE_CONTRACT_ID,contract.policy+'+'+contract.bookmakerIdentityPolicy);
  for(const value of ['',null,[],[MARKET_CAPTURE_CONTRACT_ID],true,contract.policy,contract.bookmakerIdentityPolicy,
    contract.policy+'+OLDER_BOOK_IDENTITY',MARKET_CAPTURE_CONTRACT_ID+' ',MARKET_CAPTURE_CONTRACT_ID+','+MARKET_CAPTURE_CONTRACT_ID]){
    const out=await h.get('',contract.policy,{'x-betq-expected-market-contract':value,
      'x-betq-paid-request':'true',authorization:'Bearer OFFLINE_OPERATOR_FIXTURE_0123456789'});
    assert.equal(out.code,409);assert.equal(out.body.error.code,'MARKET_CAPTURE_CONTRACT_MISMATCH');
  }
  for(const query of ['?mode=demo','?sport=basketball_nba','?market=spreads']){
    const out=await h.get(query,undefined,{'x-betq-expected-market-contract':MARKET_CAPTURE_CONTRACT_ID});
    assert.equal(out.code,409);assert.equal(out.body.error.code,'MARKET_CAPTURE_CONTRACT_MISMATCH');
  }
  assert.equal(h.sourceReads,0);assert.equal(h.paidReads,0);
  const valid=await h.get('',contract.policy,{'x-betq-expected-market-contract':MARKET_CAPTURE_CONTRACT_ID});
  assert.equal(valid.code,200);assert.deepEqual(valid.body.marketCaptureContract,contract);
  assert.equal(h.sourceReads,1);assert.equal(h.paidReads,0);
});
