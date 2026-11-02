import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/server.mjs';
import { MODEL_VERSION } from '../src/nfl-elo.mjs';

const now=Date.parse('2026-11-02T01:00:00Z');
const date=(value)=>new Date(value).toISOString();
const event={
  id:'controlled-fixture',sport_key:'americanfootball_nfl',
  home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
  commence_time:date(now+86400000),
  bookmakers:[
    { key:'alpha',title:'Alpha',markets:[{key:'h2h',last_update:date(now-20000),outcomes:[
      {name:'Kansas City Chiefs',price:-120},{name:'Las Vegas Raiders',price:+110}]}] },
    { key:'bravo',title:'Bravo',markets:[{key:'h2h',last_update:date(now-30000),outcomes:[
      {name:'Kansas City Chiefs',price:-125},{name:'Las Vegas Raiders',price:+108}]}] },
    { key:'charlie',title:'Charlie',markets:[{key:'h2h',last_update:date(now-30000),outcomes:[
      {name:'Kansas City Chiefs',price:-130},{name:'Las Vegas Raiders',price:+115}]}] }
  ]
};
const artifact={
  schema:1,version:MODEL_VERSION,readyForResearch:true,generatedAt:date(now-3600000),
  lastGameDate:'2026-11-01',source:{project:'nflverse/nflverse-data',license:'CC BY 4.0'},
  trainingProtocol:{'parameterTuning':'2018-2022'},
  tuning:{n:1365,brier:0.225},
  calibration:{n:570,brier:0.222},
  holdout:{n:284,brier:0.22235,ece:0.053,accuracy:0.6585},
  params:{k:20,homeAdv:55,scale:1,regression:0.35},
  ratings:{KC:1550,LV:1450},completedGames:7393,completed2026:117,limitations:[]
};
function withServer(testFn,model=artifact){
  const source={
    status:()=>({configured:true}),
    getOdds:async()=>({events:[event],receivedAt:date(now),cacheHit:false,quota:{remaining:100}}),
    getScores:async()=>({events:[],receivedAt:date(now),cacheHit:false,quota:{remaining:100}})
  };
  const server=http.createServer(createHandler({source,nflArtifact:model,clock:()=>now}));
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({
    url:'http://127.0.0.1:'+server.address().port,server
  }))).then(async x=>{try{return await testFn(x.url);}finally{await new Promise(resolve=>x.server.close(resolve));}});
}
test('Live NFL odds carry Elo research-only evidence without changing market status',async()=>{
  await withServer(async base=>{
    const r=await fetch(base+'/api/slate?sport=americanfootball_nfl&market=h2h&mode=live');
    assert.equal(r.status,200);
    const payload=await r.json();
    assert.equal(payload.demo,false);
    const game=payload.events[0];
    assert.equal(game.marketConsensus.available,true);
    assert.equal(game.marketConsensus.method,'ALL_BOOKS_MEDIAN_DE_VIG');
    assert.equal(game.marketConsensus.books,3);
    assert.ok(game.marketConsensus.homeProbability>0&&game.marketConsensus.homeProbability<1);
    assert.equal(game.marketConsensus.basis,'MARKET_DERIVED_NOT_INDEPENDENT');
    assert.equal(game.independentModel.available,true);
    assert.equal(game.independentModel.independentOfOdds,true);
    assert.equal(game.independentModel.use,'RESEARCH_ONLY');
    assert.ok(game.independentModel.homeWinProbability>0.5);
    assert.equal(game.opportunities.length,2);
    for(const offer of game.opportunities){
      assert.ok(['WATCH','PASS'].includes(offer.status));
      assert.equal(offer.eloStatus,'RESEARCH_ONLY');
      assert.ok(Number.isFinite(offer.eloBaselineProbability));
      assert.ok(Number.isFinite(offer.eloIndicativeEvPercent));
    }
  });
});
test('Demo must never display live model projections',async()=>{
  await withServer(async base=>{
    const r=await fetch(base+'/api/slate?mode=demo&sport=americanfootball_nfl&market=h2h');
    const payload=await r.json();
    assert.equal(payload.demo,true);
    assert.ok(payload.events.every(x=>x.independentModel===undefined));
  });
});
test('Model report exposes training lineage without odds API key',async()=>{
  await withServer(async base=>{
    const r=await fetch(base+'/api/model/nfl');const payload=await r.json();
    assert.equal(payload.available,true);
    assert.equal(payload.source.project,'nflverse/nflverse-data');
    assert.equal(payload.holdout.n,284);
    assert.equal(payload.use,'RESEARCH_ONLY');
    assert.equal(JSON.stringify(payload).includes('apiKey'),false);
  });
});
test('Stale model suppresses projections but retains market scanning',async()=>{
  await withServer(async base=>{
    const r=await fetch(base+'/api/slate?sport=americanfootball_nfl&market=h2h');
    const p=await r.json();
    assert.equal(p.events[0].independentModel.available,false);
    assert.equal(p.events[0].independentModel.reason,'MODEL_SNAPSHOT_STALE');
    assert.equal(p.events[0].opportunities.length,2);
    assert.ok(p.events[0].opportunities.every(x=>x.eloStatus===undefined));
  },{...artifact,generatedAt:date(now-16*86400000)});
});
