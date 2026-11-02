import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../src/server.mjs';
import { MODEL_VERSION } from '../src/nfl-elo.mjs';

const NOW=Date.parse('2026-11-01T15:00:00Z');
const iso=n=>new Date(n).toISOString();
const home='Kansas City Chiefs',away='Las Vegas Raiders';
const raw={
  id:'fixture-event',sport_key:'americanfootball_nfl',home_team:home,away_team:away,
  commence_time:iso(NOW+5*3600000),
  bookmakers:[[-125,+110],[-130,+117],[-128,+115]].map(([h,a],i)=>({
    key:'book'+i,title:'Fixture Book '+i,
    markets:[{key:'h2h',last_update:iso(NOW-30000),
      outcomes:[{name:home,price:h},{name:away,price:a}]}]
  }))
};
const elo={
  schema:1,version:MODEL_VERSION,readyForResearch:true,
  generatedAt:iso(NOW-86400000),lastGameDate:'2026-10-25',
  params:{homeAdv:25,scale:1.1},ratings:{KC:1560,LV:1480},
  holdout:{n:284,brier:0.22235,ece:0.053}
};
const efficiency={
  schema:1,version:'nfl-efficiency-1',readyForResearch:true,promotable:true,
  generatedAt:iso(NOW-3600000),
  sourceManifest:{project:'nflverse/nflverse-data',sourceLastCompletedGame:'2026-10-25'},
  coverage:{historicalGames:2300,featureReadyGames:2200},
  training:{tune:'2018–2022'},tuning:{n:1200},calibration:{n:570},
  holdout:{elo:{n:284,brier:0.22235},challenger:{n:284,brier:0.21935},
    confidence95:{lower:0.00025,upper:0.00567},deltaBrier:0.003},
  coefficients:{epa:1.2,success:0.5,rest:0.02},
  teamFeatures:{
    KC:{n:8,netEPA:0.22,netSuccess:0.11,offEPA:0.15,defEPA:-0.07,
      latestGameDate:'2026-10-25'},
    LV:{n:8,netEPA:-0.10,netSuccess:-0.06,offEPA:-0.07,defEPA:0.03,
      latestGameDate:'2026-10-25'}
  },limitations:[]
};
const injuries={
  schema:1,source:'NFLVERSE_INJURIES',season:2026,
  sourceUpdatedAt:iso(NOW-3600000),reportCount:10,
  perPlayerTimestampsAvailable:false,advisory:'not confirmed quarterback starter',
  fixtures:[{gameId:'2026_09_LV_KC',week:9,gameDate:'2026-11-01',home:'KC',away:'LV'}],
  reports:{
    'KC:9':{lastPlayerUpdate:iso(NOW-3600000),flaggedCount:1,
      statusCounts:{out:0,doubtful:0,questionable:1},
      flaggedPlayers:[{player:'Fixture QB',position:'QB',status:'QUESTIONABLE'}],
      reportedQBs:[{player:'Fixture QB',position:'QB',status:'QUESTIONABLE'}]},
    'LV:9':{lastPlayerUpdate:iso(NOW-3600000),flaggedCount:0,
      statusCounts:{out:0,doubtful:0,questionable:0},
      flaggedPlayers:[],reportedQBs:[]}
  }
};
function testServer(fn,{injuryArtifact=injuries,model=efficiency}={}){
  const source={status:()=>({configured:true,budget:{limit:12}}),
    getOdds:async()=>({events:[raw],receivedAt:iso(NOW),cacheHit:false,quota:{remaining:490}}),
    getScores:async()=>({events:[],receivedAt:iso(NOW),cacheHit:false,quota:null})};
  const server=http.createServer(createHandler({
    source,clock:()=>NOW,nflArtifact:elo,nflEfficiency:model,nflInjuries:injuryArtifact
  }));
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({
    server,base:'http://127.0.0.1:'+server.address().port
  }))).then(async x=>{try{await fn(x.base);}finally{await new Promise(done=>x.server.close(done));}});
}
test('NFL feature challenger remains separate from Elo and never changes market WATCH/PASS',async()=>{
  await testServer(async base=>{
    const res=await fetch(base+'/api/slate?sport=americanfootball_nfl&market=h2h');
    assert.equal(res.status,200);
    const body=await res.json(),game=body.events[0];
    assert.equal(game.independentModel.available,true);
    assert.equal(game.efficiencyChallenger.available,true);
    assert.equal(game.efficiencyChallenger.automaticSelection,false);
    assert.equal(game.efficiencyChallenger.injuryAdjusted,false);
    assert.equal(game.efficiencyChallenger.startingQuarterbackVerified,false);
    assert.ok(game.efficiencyChallenger.homeWinProbability>0);
    assert.equal(game.injuryContext.available,true);
    assert.equal(game.injuryContext.week,9);
    assert.equal(game.injuryContext.home.reportedQBs[0].status,'QUESTIONABLE');
    assert.equal(game.injuryContext.starterVerified,false);
    assert.ok(game.opportunities.every(o=>['WATCH','PASS'].includes(o.status)));
  });
});
test('Model endpoint reports historical validation without claiming automatic selection or ROI',async()=>{
  await testServer(async base=>{
    const r=await fetch(base+'/api/model/efficiency');
    const x=await r.json();
    assert.equal(x.available,true);
    assert.equal(x.promotableInHistoricalHoldout,true);
    assert.equal(x.automaticallyPromoted,false);
    assert.equal(x.verifiedRealMoneyEdge,false);
    assert.equal(x.holdout.challenger.brier,0.21935);
    const s=await (await fetch(base+'/api/health')).json();
    assert.equal(s.version,'0.4.0');
    assert.equal(s.nflIntelligence.efficiencyChallengerPromoted,false);
    assert.equal(s.nflIntelligence.startingQuarterbacksVerified,false);
  });
});
test('Public injury source date and missing individual timestamps are explicit',async()=>{
  await testServer(async base=>{
    const r=await fetch(base+'/api/injuries/nfl'),j=await r.json();
    assert.equal(j.available,true);
    assert.equal(j.playerTimestampAvailable,false);
    assert.equal(j.starterVerified,false);
    assert.equal(j.modelProbabilitiesAdjusted,false);
  });
});
test('Stale/absent injury and challenger features fail closed while Elo remains',async()=>{
  await testServer(async base=>{
    const p=await (await fetch(base+'/api/slate?sport=americanfootball_nfl&market=h2h')).json();
    assert.equal(p.events[0].independentModel.available,true);
    assert.equal(p.events[0].efficiencyChallenger.available,false);
    assert.equal(p.events[0].injuryContext.available,false);
    assert.ok(p.events[0].opportunities.length>0);
  },{model:null,injuryArtifact:null});
});
test('Demo source does not leak live injury or opponent-specific EPA projections',async()=>{
  await testServer(async base=>{
    const p=await (await fetch(base+'/api/slate?mode=demo&s=1')).json();
    assert.equal(p.demo,true);
    assert.ok(p.events.every(e=>!Object.hasOwn(e,'injuryContext')&&!Object.hasOwn(e,'efficiencyChallenger')));
  });
});
