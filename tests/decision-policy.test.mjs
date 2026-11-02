import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {applyDecisionAuthority} from '../src/decision-policy.mjs';
import {createHandler} from '../src/server.mjs';
import {MODEL_VERSION} from '../src/nfl-elo.mjs';

const NOW=Date.parse('2026-11-02T13:00:00Z');
const iso=n=>new Date(n).toISOString();
const raw={
  id:'fixture-2026',sport_key:'americanfootball_nfl',
  home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
  commence_time:iso(NOW+86400000),
  bookmakers:[[-120,+110],[-125,+115],[-130,+120],[-135,+125]].map(([a,b],i)=>({
    key:'book-'+i,title:'Book '+i,
    markets:[{key:'h2h',last_update:iso(NOW-50000),
      outcomes:[{name:'Kansas City Chiefs',price:a},{name:'Las Vegas Raiders',price:b}]}]
  }))
};
const elo={
  schema:1,version:MODEL_VERSION,readyForResearch:true,
  generatedAt:iso(NOW-3600000),lastGameDate:'2026-11-01',
  params:{homeAdv:25,scale:1.1},ratings:{KC:1550,LV:1450},
  holdout:{n:284,brier:0.22235,ece:.053}
};
const modelArtifact={
  schema:1,version:'market-challenge-v1',bettingAuthorized:false,
  verifiedCLV:null,verifiedROI:null,
  years:[2022,2023,2024,2025].map(season=>({
    season,modelContributionWeight:0,closingMarket:{brier:.209},
    training:{trainedOnYears:[season-2,season-1]}
  }))
};
const replay={
  years:[2022,2023,2024,2025].map(season=>({
    season,allGameForecast:{brier:.23},
    closingMarketBenchmark:{brier:.21,pairedModelBrier:.23}
  }))
};

function sample(){
  return {
    summary:{watch:1,signals:1},events:[{
      id:'x',started:false,commenceTime:iso(NOW+86400000),
      opportunities:[{
        id:'x|h2h|h2h|home',status:'WATCH',basis:'MARKET_CONSENSUS_ONLY',
        lastUpdated:iso(NOW-10000),comparatorBooks:3,theoreticalUnits:1,
        rawKellyPercent:11,independentModelValidated:false
      }]
    }]
  };
}
test('Authority preserves research price difference but blocks all staking on model failure',()=>{
  const data=sample();
  const report=applyDecisionAuthority(data,{
    decision:'PASS_NO_PROVEN_MARKET_EDGE',nestedCalibrationReady:true,
    allIndependentContributionsRejected:true,marketBenchmarkConsistentlyBetter:true
  },{asOf:NOW});
  const s=report.events[0].opportunities[0];
  assert.equal(s.status,'WATCH'); // Original *market scanner* status remains explicit.
  assert.equal(s.rawMarketScreenStatus,'WATCH');
  assert.equal(s.rawMarketScenarioUnits,1);
  assert.equal(s.recommendedUnits,0);
  assert.equal(s.theoreticalUnits,0);
  assert.equal(s.executionStatus,'NOT_AUTHORIZED');
  assert.equal(s.executionAuthorized,false);
  assert.equal(s.paperStagingAuthorized,false);
  assert.equal(s.independentEdgeVerified,false);
  assert.equal(s.selectionAuthority,'UNVALIDATED_RESEARCH');
  assert.ok(s.authorityReasons.includes('AGENT_RISK_VETO'));
  assert.ok(s.authorityReasons.includes('INDEPENDENT_MODEL_FAILED_MARKET_BENCHMARK'));
  assert.equal(report.summary.actionableSelections,0);
  assert.equal(report.summary.researchOnlyCandidates,1);
  assert.equal(report.executionGate.allSuggestedUnitsSuppressed,true);
});
test('No authorization can be constructed from incomplete or deceptive agent scores',()=>{
  for(const settings of [
    {decision:'RESEARCH_ONLY_UNPROMOTED',nestedCalibrationReady:true,
      allIndependentContributionsRejected:false,marketBenchmarkConsistentlyBetter:false},
    {decision:'PASS_NO_HISTORY'},
    {decision:'NO_VALIDATED_EDGE',nestedCalibrationReady:true}
  ]){
    const r=applyDecisionAuthority(sample(),settings,{asOf:NOW});
    assert.equal(r.events[0].opportunities[0].paperStagingAuthorized,false);
    assert.equal(r.summary.actionableSelections,0);
    assert.equal(r.executionGate.bettingAuthorized,false);
  }
  assert.throws(()=>applyDecisionAuthority(null,{}),/complete market analysis/);
  assert.throws(()=>applyDecisionAuthority(sample(),null),/complete market analysis/);
});
test('Stale/near kickoff/future-dated quote cannot qualify even as price watch',()=>{
  for(const date of [NOW-700000,NOW+180000]){
    const report=sample();
    report.events[0].opportunities[0].lastUpdated=iso(date);
    const r=applyDecisionAuthority(report,{decision:'PASS_NO_EDGE'}, {asOf:NOW});
    assert.equal(r.events[0].opportunities[0].researchClassification,'NO_QUALIFIED_MARKET_DIFFERENCE');
    assert.equal(r.events[0].opportunities[0].executionAuthorized,false);
  }
  const started=sample();
  started.events[0].commenceTime=iso(NOW+100000);
  const r=applyDecisionAuthority(started,{decision:'PASS_NO_EDGE'},{asOf:NOW});
  assert.ok(r.events[0].opportunities[0].authorityReasons.includes('QUOTE_OR_KICKOFF_NOT_CURRENT'));
});
test('10000 randomized quote/timestamp/scenario inputs never issue paper stakes',()=>{
  let seed=922333,random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let n=0;n<10000;n++){
    const d=sample(),s=d.events[0].opportunities[0];
    s.lastUpdated=iso(NOW+(random()-.7)*1800000);
    s.theoreticalUnits=random()*500;
    s.comparatorBooks=Math.floor(random()*12);
    s.status=random()<.6?'WATCH':'PASS';
    s.independentModelValidated=random()<.5;
    d.events[0].commenceTime=iso(NOW+random()*86400000);
    const out=applyDecisionAuthority(d,{
      decision:random()<.5?'PASS_NO_PROVEN_MARKET_EDGE':'RESEARCH_ONLY_UNPROMOTED',
      nestedCalibrationReady:random()<.5,
      allIndependentContributionsRejected:random()<.5,
      marketBenchmarkConsistentlyBetter:random()<.5
    },{asOf:NOW});
    assert.equal(out.summary.actionableSelections,0);
    assert.equal(out.events[0].opportunities[0].theoreticalUnits,0);
    assert.equal(out.events[0].opportunities[0].executionAuthorized,false);
    assert.equal(out.events[0].opportunities[0].paperStagingAuthorized,false);
  }
});
test('Server applies independent authority to real and demo sources, zero extra paid odds calls',async(t)=>{
  let requests=0;
  const source={
    status:()=>({configured:true}),
    getOdds:async()=>{requests++;return {events:[raw],receivedAt:iso(NOW),cacheHit:false,quota:null};},
    getScores:async()=>{throw Error('Not used');}
  };
  const server=http.createServer(createHandler({
    source,clock:()=>NOW,nflArtifact:elo,
    marketChallenge:modelArtifact,replaySummary:replay
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const p=await (await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h')).json();
  assert.equal(requests,1);
  assert.equal(p.agentRun.decision,'PASS_NO_PROVEN_MARKET_EDGE');
  assert.equal(p.executionGate.bettingAuthorized,false);
  assert.equal(p.summary.actionableSelections,0);
  assert.ok(p.events[0].opportunities.length>0);
  for(const o of p.events[0].opportunities){
    assert.equal(o.executionAuthorized,false);
    assert.equal(o.theoreticalUnits,0);
    assert.equal(o.paperStagingAuthorized,false);
  }
  const demo=await (await fetch(base+'/api/slate?mode=demo')).json();
  assert.equal(demo.summary.actionableSelections,0);
  assert.equal(demo.executionGate.bettingAuthorized,false);
  assert.equal(requests,1);
});
test('Client risk veto is not merely decorative; paper action is explicitly blocked',async()=>{
  const {readFile}=await import('node:fs/promises');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(js.includes('state.slate?.executionGate?.bettingAuthorized !== true'));
  assert.ok(js.includes('signal.paperStagingAuthorized !== true'));
  assert.ok(js.includes('Paper staging locked · research only'));
  assert.ok(js.includes('PRICE WATCH · NOT A BET'));
  assert.ok(!js.includes("signal.status === 'WATCH' ? '' : ' disabled') + '>Stage paper ticket"));
});
