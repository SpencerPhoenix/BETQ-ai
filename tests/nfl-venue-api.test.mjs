import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {MODEL_VERSION,eloProbability} from '../src/nfl-elo.mjs';

const NOW=Date.parse('2026-11-02T13:00:00Z');
const iso=value=>new Date(value).toISOString();
const artifact={
  schema:1,version:MODEL_VERSION,readyForResearch:true,
  generatedAt:iso(NOW-3600000),lastGameDate:'2026-11-01',
  params:{homeAdv:55,scale:1},ratings:{KC:1500,LV:1500},
  holdout:{n:284,brier:0.23,ece:0.05}
};
const event={
  id:'venue-regression',sport_key:'americanfootball_nfl',
  home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
  commence_time:iso(NOW+86400000),
  bookmakers:['one','two','three'].map(key=>({key,title:key,markets:[{
    key:'h2h',last_update:iso(NOW-1000),outcomes:[
      {name:'Kansas City Chiefs',price:-110},{name:'Las Vegas Raiders',price:-110}
    ]
  }]}))
};

async function slate(overrides,{crossKickoff=false}={}){
  let clock=NOW,calls=0;
  const input={...event,...overrides};
  const source={
    status:()=>({configured:true}),
    getOdds:async()=>{
      calls++;
      if(crossKickoff)clock=Date.parse(input.commence_time);
      return {events:[input],receivedAt:iso(clock),cacheHit:false,quota:{remaining:100}};
    },
    getScores:async()=>{throw Error('No score request expected');}
  };
  const server=http.createServer(createHandler({
    source,clock:()=>clock,nflArtifact:artifact,nflEfficiency:null,nflInjuries:null,
    shadowStore:{capture:async()=>({captured:false,reason:'OFFLINE_TEST'})}
  }));
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
  });
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+
      '/api/slate?sport=americanfootball_nfl&market=h2h&mode=live',{
        headers:{'x-betq-paid-request':'true'}
      });
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(calls,1,'Only the injected offline odds source is called');
    assert.equal(payload.events.length,1);
    return payload.events[0];
  }finally{await new Promise(resolve=>server.close(resolve));}
}

test('API preserves explicit neutral venue metadata in the research projection',async()=>{
  const game=await slate({neutralSite:true});
  assert.equal(game.independentModel.available,true);
  assert.equal(game.independentModel.homeWinProbability,0.5);
  assert.equal(game.independentModel.awayWinProbability,0.5);
  assert.equal(game.independentModel.use,'RESEARCH_ONLY');
  assert.ok(game.opportunities.every(offer=>['WATCH','PASS'].includes(offer.status)));
});

test('API preserves explicit home venue metadata and fitted home advantage',async()=>{
  const game=await slate({neutralSite:false});
  assert.equal(game.independentModel.available,true);
  assert.equal(game.independentModel.homeWinProbability,
    Number(eloProbability(1500,1500,55,false).toFixed(6)));
});

test('API does not drop a malformed venue flag before predictor validation',async()=>{
  const game=await slate({neutralSite:'false'});
  assert.deepEqual(game.independentModel,{available:false,reason:'INVALID_NEUTRAL_SITE'});
  assert.ok(game.opportunities.every(offer=>offer.eloStatus===undefined));
  assert.equal(game.marketConsensus.available,true);
});

test('API suppresses venue-aware projections when fetching crosses kickoff',async()=>{
  const commence_time=iso(NOW+1000);
  const game=await slate({neutralSite:true,commence_time},{crossKickoff:true});
  assert.equal(game.commenceTime,commence_time);
  assert.equal(game.started,true);
  assert.deepEqual(game.independentModel,{available:false,reason:'GAME_ALREADY_STARTED'});
  assert.ok(game.opportunities.every(offer=>offer.eloStatus===undefined));
});
