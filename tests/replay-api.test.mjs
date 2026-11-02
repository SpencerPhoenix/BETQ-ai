import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
const NOW=Date.parse('2026-11-01T20:00:00Z');
const years=[2022,2023,2024,2025].map(season=>({
  season,allGameForecast:{n:280,brier:.23},
  closingMarketBenchmark:{brier:.21,pairedModelBrier:.23}
}));
const summary={schema:1,version:'nfl-replay-v2',years,
  verifiedBettingROI:null,verifiedCLV:null,defaultThresholdEVPercent:3};
const decision={gameId:'2025_01_LV_KC',season:2025,date:'2025-09-07',week:1,
  home:'KC',away:'LV',modelHomeProbability:.61,
  priceAvailable:true,selectedSide:'home',selectedOdds:-110,
  selectedProbability:.61,estimatedEV:.16,closeMarketHomeProbability:.52,
  actual:'home',finalScore:'10-21',quoteTimeVerified:false};
const replayFull={schema:1,version:'nfl-replay-v2',
  years:[{season:2025,decisions:[decision,{...decision,gameId:'2025_02_LV_KC',
    actual:'away',finalScore:'21-10',estimatedEV:.01}]}]};
async function withLocal(fn){
  let calls=0;
  const source={
    status:()=>({configured:false}),getOdds:async()=>{calls++;return{events:[],receivedAt:new Date(NOW).toISOString(),cacheHit:false,quota:null}},
    getScores:async()=>{calls++;return{events:[],receivedAt:new Date(NOW).toISOString(),cacheHit:false,quota:null}}
  };
  const server=http.createServer(createHandler({
    source,clock:()=>NOW,replaySummary:summary,replayFull
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn('http://127.0.0.1:'+server.address().port,()=>calls);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
test('Public yearly replay summary never charges provider API or invents verified returns',async()=>{
  await withLocal(async(base,calls)=>{
    const r=await fetch(base+'/api/replay/nfl');
    assert.equal(r.status,200);
    const json=await r.json();
    assert.equal(json.available,true);
    assert.equal(json.years.length,4);
    assert.equal(json.verifiedROI,null);
    assert.equal(json.verifiedCLV,null);
    assert.match(json.dataTrust,/NOT_VERIFIED/);
    assert.equal(calls(),0);
  });
});
test('Single season selected plays are gradeable from historical prices, not filled bets',async()=>{
  await withLocal(async(base,calls)=>{
    const r=await fetch(base+'/api/replay/nfl/plays?season=2025&ev=3&page=0');
    assert.equal(r.status,200);
    const d=await r.json();
    assert.equal(d.rows.length,1);
    assert.equal(d.total,1);
    assert.equal(d.rows[0].selectedAmericanOdds,-110);
    assert.equal(d.rows[0].outcome,'WIN');
    assert.equal(d.rows[0].executableEntryVerified,false);
    assert.equal(d.rows[0].priceTimeVerified,false);
    assert.equal(d.realMoneyROI,null);
    assert.equal(calls(),0);
  });
});
test('Malformed replay filters and unsupported thresholds do not bypass allowlist',async()=>{
  await withLocal(async(base,calls)=>{
    for(const q of [
      'season=2025&ev=7','season=2021&ev=3','season=2025&ev=3&page=-1',
      'season=2025&ev=3&page=3.5','season=2025&ev=3&url=https://evil.test'
    ]){
      const r=await fetch(base+'/api/replay/nfl/plays?'+q);
      assert.equal(r.status,400,q);
    }
    assert.equal((await fetch(base+'/api/replay/nfl/plays',{method:'POST'})).status,405);
    assert.equal(calls(),0);
  });
});
test('Every slate request creates independent stage report without claiming actions',async()=>{
  await withLocal(async(base,calls)=>{
    const r=await fetch(base+'/api/slate?mode=demo&sport=americanfootball_nfl&market=h2h');
    const j=await r.json();
    assert.equal(j.agentRun.version,'quant-agent-run-2');
    assert.equal(j.agentRun.mayWager,false);
    assert.equal(j.agentRun.decision,'DEMO_NO_ACTION');
    assert.equal(j.agentRun.realMoneyROI,null);
    assert.equal(calls(),0);
  });
});
