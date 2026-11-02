import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {disabledShadowStore} from '../src/shadow-store.mjs';

const NOW=Date.parse('2026-11-04T18:00:00.000Z');
const iso=n=>new Date(n).toISOString();
const raw={
  id:'shadow-provider-test',sport_key:'americanfootball_nfl',
  home_team:'Baltimore Ravens',away_team:'Cincinnati Bengals',
  commence_time:iso(NOW+86400000),
  bookmakers:[[-120,110],[-125,115],[-130,120]].map(([a,b],i)=>({
    key:'b'+i,title:'Book '+i,markets:[{
      key:'h2h',last_update:iso(NOW-30000),
      outcomes:[
        {name:'Baltimore Ravens',price:a},
        {name:'Cincinnati Bengals',price:b}
      ]
    }]
  }))
};
const snapshot=(cacheHit=false)=>({
  events:[raw],receivedAt:iso(NOW),cacheHit,quota:{remaining:999,used:0,last:1}
});
const mockArchive=()=>{
  const observed=[];
  return{
    observed,
    async capture(s,opts){
      observed.push({snapshot:s,asOf:opts.now});
      return {captured:true,inserted:3,privateOnly:true};
    },
    async status(){return{
      schema:1,version:'betq-shadow-v1',available:true,captureEnabled:true,
      durableStorage:true,recordedQuoteRevisions:9,
      rawBookmakerQuotesExposed:false,realMoneyROI:null,verifiedCLV:null,
      wageringAuthorized:false
    };},
    async analysis(){return{
      available:false,reason:'WAITING_FOR_REVIEWED_CONTROLS',
      rawBookmakerQuotesExposed:false,realMoneyROI:null,verifiedCLV:null
    };}
  };
};
async function serve(fn,{cached=false,archive=disabledShadowStore()}={}){
  let oddsCalls=0,scoreCalls=0;
  const source={
    status:()=>({configured:true,budget:{limit:12,used:0}}),
    async getOdds(){oddsCalls++;return snapshot(cached);},
    async getScores(){scoreCalls++;return{events:[],receivedAt:iso(NOW),cacheHit:false,quota:null};}
  };
  const server=http.createServer(createHandler({
    source,shadowStore:archive,clock:()=>NOW
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn('http://127.0.0.1:'+server.address().port,{
    calls:()=>({oddsCalls,scoreCalls}),archive
  });}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('Shadow public readiness and analysis never invoke paid provider or expose raw prices',async()=>{
  await serve(async(base,ctx)=>{
    const readiness=await (await fetch(base+'/api/shadow/status')).json();
    const analysis=await (await fetch(base+'/api/shadow/study')).json();
    assert.equal(readiness.available,false);
    assert.equal(readiness.captureEnabled,false);
    assert.equal(readiness.durableStorage,false);
    assert.equal(readiness.rawBookmakerQuotesExposed,false);
    assert.equal(readiness.verifiedCLV,null);
    assert.equal(analysis.available,false);
    assert.equal(ctx.calls().oddsCalls,0);
    assert.equal(ctx.calls().scoreCalls,0);
  });
});
test('Synthetic QB latency example is labeled fabricated and uses zero bookmaker provider credits',async()=>{
  await serve(async(base,ctx)=>{
    const r=await fetch(base+'/api/shadow/demo');
    const report=await r.json();
    assert.equal(r.status,200);
    assert.equal(report.synthetic,true);
    assert.equal(report.nQBEventsEligible,1);
    assert.equal(report.realMoneyROI,null);
    assert.equal(report.verifiedCLV,null);
    assert.equal(report.privateBookmakerQuotesIncluded,false);
    assert.equal(report.privateSourceUrlsIncluded,false);
    assert.equal(report.wageringAuthorized,false);
    assert.equal(report.causalEffectEstablished,undefined);
    assert.equal(ctx.calls().oddsCalls,0);
  });
});
test('No unauthenticated public ingestion, source review or arbitrary query interface exists',async()=>{
  await serve(async(base)=>{
    for(const path of ['/api/shadow/status','/api/shadow/study','/api/shadow/demo']){
      const r=await fetch(base+path,{method:'POST',body:'{}',
        headers:{'Content-Type':'application/json'}});
      assert.equal(r.status,405);
    }
    assert.equal((await fetch(base+'/api/shadow/raw-quotes')).status,404);
    assert.equal((await fetch(base+'/api/shadow/import-qb')).status,404);
    assert.equal((await fetch(base+'/api/shadow/approve')).status,404);
  });
});
test('Optional same-response private capture happens without a second paid odds call',async()=>{
  const archive=mockArchive();
  await serve(async(base,ctx)=>{
    const r=await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h');
    const j=await r.json();
    assert.equal(r.status,200);
    assert.equal(ctx.calls().oddsCalls,1);
    assert.equal(ctx.archive.observed.length,1);
    assert.equal(ctx.archive.observed[0].asOf,NOW);
    assert.equal(j.shadowCapture.inserted,3);
    assert.equal(j.shadowCapture.privateOnly,true);
    assert.equal(j.agentRun.mayWager,false);
  },{archive});
});
test('Cache, synthetic demonstration and unrelated sports never trigger private write',async()=>{
  const archive=mockArchive();
  await serve(async(base,ctx)=>{
    const urls=[
      '/api/slate?mode=demo',
      '/api/slate?mode=live&sport=basketball_nba&market=h2h',
      '/api/slate?mode=live&sport=americanfootball_nfl&market=spreads'
    ];
    for(const path of urls){
      const r=await fetch(base+path);
      assert.equal(r.status,200);
    }
    assert.equal(ctx.archive.observed.length,0);
    assert.equal(ctx.calls().oddsCalls,2);
  },{archive});
  const other=mockArchive();
  await serve(async(base,ctx)=>{
    const r=await fetch(base+'/api/slate?mode=live');
    const j=await r.json();
    assert.equal(r.status,200);
    assert.equal(ctx.archive.observed.length,0);
    assert.equal(j.shadowCapture.inserted,0);
  },{cached:true,archive:other});
});
