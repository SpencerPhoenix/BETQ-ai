import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {MODEL_VERSION} from '../src/nfl-elo.mjs';

const NOW=Date.parse('2026-11-02T13:00:00Z');
const iso=x=>new Date(x).toISOString();
const match={
  id:'fixture-game',sport_key:'americanfootball_nfl',
  home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
  commence_time:iso(NOW+86400000),
  bookmakers:[
    {key:'b1',title:'Book One',markets:[{key:'h2h',last_update:iso(NOW-20000),
      outcomes:[{name:'Kansas City Chiefs',price:-135},{name:'Las Vegas Raiders',price:+115}]}]},
    {key:'b2',title:'Book Two',markets:[{key:'h2h',last_update:iso(NOW-30000),
      outcomes:[{name:'Kansas City Chiefs',price:-130},{name:'Las Vegas Raiders',price:+112}]}]},
    {key:'b3',title:'Book Three',markets:[{key:'h2h',last_update:iso(NOW-20000),
      outcomes:[{name:'Kansas City Chiefs',price:-125},{name:'Las Vegas Raiders',price:+110}]}]}
  ]
};
const elo={
  schema:1,version:MODEL_VERSION,readyForResearch:true,
  generatedAt:iso(NOW-3600000),lastGameDate:'2026-11-01',
  params:{homeAdv:25,scale:1.1},ratings:{KC:1550,LV:1450},
  holdout:{n:284,brier:0.22235,ece:0.053}
};
const replay={
  schema:1,version:'nfl-replay-v2',
  years:[2022,2023,2024,2025].map(season=>({
    season,allGameForecast:{brier:0.226},
    closingMarketBenchmark:{brier:0.209,pairedModelBrier:0.226}
  }))
};
const challenge={
  schema:1,version:'market-challenge-v1',bettingAuthorized:false,
  verifiedCLV:null,verifiedROI:null,years:[2022,2023,2024,2025].map(season=>({
    season,modelContributionWeight:0,
    training:{trainedOnYears:[season-2,season-1]},
    closingMarket:{brier:0.209}
  })),
  pooledPolicy:{MARKET_FAVORITE_65:{
    graded:522,winRatePercent:75.29,hypotheticalClosingPriceROIPercent:-3.32
  }}
};

async function local(fn,bookCount=3){
  let calls=0;
  const source={
    status:()=>({configured:true}),
    getOdds:async()=>{calls++;return{
      events:[{...match,bookmakers:match.bookmakers.slice(0,bookCount)}],
      receivedAt:iso(NOW),cacheHit:false,quota:{remaining:120}
    }},
    getScores:async()=>{throw Error('Scores not used');}
  };
  const server=http.createServer(createHandler({
    source,clock:()=>NOW,nflArtifact:elo,nflEfficiency:null,nflInjuries:null,
    replaySummary:replay,marketChallenge:challenge
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn('http://127.0.0.1:'+server.address().port,()=>calls);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('Market challenge research endpoint is free, read-only and disclaims all real outcomes',async()=>{
  await local(async(base,calls)=>{
    const r=await fetch(base+'/api/research/market');
    const j=await r.json();
    assert.equal(r.status,200);
    assert.equal(j.available,true);
    assert.equal(j.years.length,4);
    assert.equal(j.verifiedROI,null);
    assert.equal(j.verifiedCLV,null);
    assert.equal(j.bettingAuthorized,false);
    assert.equal(calls(),0);
  });
});
test('Every eligible live NFL slate delivers calibrated market reference, vetoed Elo edge and audit',async()=>{
  await local(async(base,calls)=>{
    const response=await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h');
    assert.equal(response.status,200);
    const j=await response.json();
    const game=j.events[0];
    assert.equal(calls(),1);
    assert.equal(game.marketConsensus.available,true);
    assert.equal(game.marketAnchoredResearch.available,true);
    assert.equal(game.marketAnchoredResearch.modelResidualWeight,0);
    assert.equal(game.marketAnchoredResearch.modelIncrementalValueValidated,false);
    assert.equal(game.marketAnchoredResearch.wageringAuthorized,false);
    assert.equal(game.marketAnchoredResearch.researchOnly,true);
    assert.ok(Math.abs(game.marketAnchoredResearch.homeProbability+
      game.marketAnchoredResearch.awayProbability-1)<1e-5);
    assert.equal(j.agentRun.decision,'PASS_NO_PROVEN_MARKET_EDGE');
    assert.equal(j.agentRun.allIndependentContributionsRejected,true);
    assert.equal(j.agentRun.nestedCalibrationReady,true);
    assert.equal(j.agentRun.freshThreeBookMarketGames,1);
    assert.equal(j.agentRun.stages.find(s=>s.id==='calibration').state,'MODEL_WEIGHT_REJECTED');
    assert.equal(j.agentRun.marketFavorite65Historical.winRatePercent,75.29);
    assert.equal(j.agentRun.marketFavorite65Historical.hypotheticalClosingPriceROIPercent,-3.32);
    assert.equal(j.agentRun.mayWager,false);
  });
});
test('Incomplete two-book market cannot masquerade as validated anchor',async()=>{
  await local(async(base)=>{
    const j=await (await fetch(base+'/api/slate?mode=live')).json();
    assert.equal(j.events[0].marketAnchoredResearch.available,false);
    assert.equal(j.agentRun.freshThreeBookMarketGames,0);
    assert.equal(j.agentRun.mayWager,false);
  },2);
});
test('Demo never inherits real market forecast or model edge',async()=>{
  await local(async(base,calls)=>{
    const j=await (await fetch(base+'/api/slate?mode=demo')).json();
    assert.equal(j.agentRun.decision,'DEMO_NO_ACTION');
    assert.equal(j.events.every(g=>g.marketAnchoredResearch===undefined),true);
    assert.equal(calls(),0);
  });
});
