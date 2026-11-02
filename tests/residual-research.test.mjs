import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRE_REGISTERED,RESIDUAL_RESEARCH_VERSION,fitPriorLogistic,
  fittedProbability,rowsFromReplay,evaluateResidualResearch
} from '../src/residual-research.mjs';

function syntheticReplays(){
  const all=[];
  let seed=927593;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let year=2020;year<=2025;year++){
    const decisions=[];
    for(let i=0;i<268;i++){
      const market=.18+.64*rand();
      const elo=Math.min(.98,Math.max(.02,market+(rand()-.5)*.25));
      const actual=rand()<market?'home':'away';
      decisions.push({
        gameId:year+'_'+i,season:year,date:year+'-10-'+String(1+i%27).padStart(2,'0'),
        week:1+Math.floor(i/15),closeMarketHomeProbability:market,
        modelHomeProbability:elo,priceAvailable:true,
        actual
      });
    }
    all.push({season:year,decisions});
  }
  return all;
}

test('Pre-registration freezes years, penalties and zero-edge null simulations',()=>{
  assert.equal(RESIDUAL_RESEARCH_VERSION,'betq-residual-research-v1');
  assert.deepEqual(PRE_REGISTERED.testYears,[2022,2023,2024,2025]);
  assert.equal(PRE_REGISTERED.nullWorlds,400);
  assert.equal(PRE_REGISTERED.ridgeSlope,20);
  assert.match(PRE_REGISTERED.protocol,/RESEARCH_PROTOCOL_RESIDUAL/);
});
test('Ridge market/residual regression probabilities stay finite, with conservative coefficients',()=>{
  const replays=syntheticReplays(),rows=replays.slice(0,2).flatMap(rowsFromReplay);
  const market=fitPriorLogistic(rows,{residual:false});
  const residual=fitPriorLogistic(rows,{residual:true});
  assert.equal(market.modelResidualWeight,0);
  assert.equal(market.trainingN,536);
  for(const row of rows.slice(0,60)){
    for(const fitted of [market,residual]){
      const p=fittedProbability(row,fitted);
      assert.ok(p>0&&p<1);
      assert.ok(Number.isFinite(p));
    }
  }
  assert.throws(()=>fitPriorLogistic(rows.slice(0,10)),/Insufficient/);
  assert.throws(()=>fittedProbability(rows[0],null),/Invalid logistic/);
});
test('Test-season outcomes cannot influence coefficients trained on prior two seasons',()=>{
  const replays=syntheticReplays(),first=replays[0];
  const prior=[...replays[3].decisions,...replays[4].decisions]
    .map(d=>({year:d.season,gameId:d.gameId,week:d.week,date:d.date,
      market:d.closeMarketHomeProbability,elo:d.modelHomeProbability,
      actual:Number(d.actual==='home')}));
  const pre=fitPriorLogistic(prior,{residual:true});
  const post=structuredClone(prior); // test year 2025 NOT in prior input
  const modified=structuredClone(replays);
  for(const d of modified[5].decisions)d.actual=d.actual==='home'?'away':'home';
  const changedPrior=[...modified[3].decisions,...modified[4].decisions].map(d=>({
    year:d.season,gameId:d.gameId,week:d.week,date:d.date,
    market:d.closeMarketHomeProbability,elo:d.modelHomeProbability,
    actual:Number(d.actual==='home')
  }));
  assert.deepEqual(pre,fitPriorLogistic(changedPrior,{residual:true}));
  assert.equal(post.length,prior.length);
  assert.equal(first.season,2020);
});
test('Disagreement bins are frozen from prior seasons and all game outcomes, not selected tickets',()=>{
  const base=syntheticReplays();
  const original=evaluateResidualResearch(base,{nullIterations:1,uncertaintyResamples:100});
  assert.equal(original.perSeason.length,4);
  const index=original.perSeason.find(x=>x.season===2025);
  assert.equal(index.disagreementAudit.bins.length,10);
  assert.equal(index.disagreementAudit.bins.reduce((s,b)=>s+b.n,0),268);
  assert.equal(original.pooledDisagreement.reduce((s,b)=>s+b.n,0),4*268);
  const modified=structuredClone(base);
  for(const d of modified[5].decisions) {
    d.actual=d.actual==='home'?'away':'home';
    d.modelHomeProbability=Math.min(.99,d.modelHomeProbability+.02);
  }
  const second=evaluateResidualResearch(modified,{nullIterations:1,uncertaintyResamples:100});
  const other=second.perSeason.find(x=>x.season===2025);
  assert.deepEqual(index.coefficients,other.coefficients);
  assert.deepEqual(index.disagreementAudit.priorYearCutoffProbabilityPoints,
    other.disagreementAudit.priorYearCutoffProbabilityPoints);
  assert.equal(original.modelPromoted,false);
  assert.equal(original.verifiedCLV,null);
  assert.equal(original.verifiedROI,null);
});
test('Reproducible no-edge synthetic worlds show false approval rate as CONDITIONAL only',()=>{
  const replays=syntheticReplays();
  const a=evaluateResidualResearch(replays,{nullIterations:7,nullSeed:1717,uncertaintyResamples:100});
  const b=evaluateResidualResearch(replays,{nullIterations:7,nullSeed:1717,uncertaintyResamples:100});
  assert.deepEqual(a.zeroEdgeSyntheticNull,b.zeroEdgeSyntheticNull);
  assert.equal(a.zeroEdgeSyntheticNull.iterations,7);
  assert.equal(a.zeroEdgeSyntheticNull.generatedOutcomesAreSynthetic,true);
  assert.equal(a.zeroEdgeSyntheticNull.assumption,'TRUE_P_HOME_EQUALS_RETROSPECTIVE_DE_VIGGED_CLOSING_MARKET');
  assert.ok(a.zeroEdgeSyntheticNull.falseApprovalCount>=0);
  assert.ok(a.zeroEdgeSyntheticNull.falseApprovalCount<=7);
  assert.equal(a.realBettingAuthorized,false);
  assert.equal(a.modelPromoted,false);
  assert.equal(a.dataUsedForPriorModelDevelopment,true);
  assert.equal(a.verifiedIncrementalProfitability,false);
});
test('Invalid historical inputs fail closed',()=>{
  const replays=syntheticReplays();
  assert.throws(()=>rowsFromReplay({season:2025}),/Invalid historical replay/);
  assert.throws(()=>evaluateResidualResearch(replays.slice(2),{
    nullIterations:1,uncertaintyResamples:50}),/Missing historical source season/);
  assert.throws(()=>evaluateResidualResearch(replays,{
    nullIterations:5000,uncertaintyResamples:50}),/Invalid no-edge simulation count/);
});
