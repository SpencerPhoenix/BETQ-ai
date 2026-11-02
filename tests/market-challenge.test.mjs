import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPriorMarketBlend,analyzeMarketChallenge} from '../src/market-challenge.mjs';

function report(year,bias=0){
  const decisions=[];
  let seed=year+919;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<280;i++){
    const p=0.40+rnd()*.4;
    const actual=rnd()<p?'home':'away';
    decisions.push({
      gameId:year+'-'+i,date:year+'-10-'+String((i%28)+1).padStart(2,'0'),
      week:1+Math.floor(i/16),season:year,
      home:'KC',away:'DEN',modelHomeProbability:Math.max(.03,Math.min(.97,p+bias)),
      closeMarketHomeProbability:p,priceAvailable:true,actual,
      selectedSide:p>=.5?'home':'away',selectedProbability:p,estimatedEV:0.03
    });
  }
  return {season:year,decisions};
}
const years=[2020,2021,2022,2023,2024,2025].map(y=>report(y,.12));
const idx=new Map(years.flatMap(y=>y.decisions.map(d=>[d.gameId,{
  homeAmerican:-110,awayAmerican:+100,
  homeMarketProbability:d.closeMarketHomeProbability,
  awayMarketProbability:1-d.closeMarketHomeProbability
}])));

test('Holdout season changes never affect prior-year fitted model weights',()=>{
  const original=fitPriorMarketBlend(years,2025);
  assert.deepEqual(original.trainedOnYears,[2023,2024]);
  const modified=structuredClone(years);
  for(const d of modified.find(y=>y.season===2025).decisions)
    d.actual=d.actual==='home'?'away':'home';
  const after=fitPriorMarketBlend(modified,2025);
  assert.deepEqual(original,after);
});
test('Market-anchored blend collapses to market on an unhelpfully biased Elo model',()=>{
  const r=fitPriorMarketBlend(years,2025);
  assert.equal(r.chosenWeight,0);
  assert.equal(r.acceptedIndependentContribution,false);
  assert.ok(r.eligibleHistoricalPairs>=500);
});
test('Annual market challenge does not present false positive strategy as verified profit',()=>{
  const result=analyzeMarketChallenge(years,idx,{testYears:[2022,2023,2024,2025]});
  assert.equal(result.years.length,4);
  assert.equal(result.verifiedROI,null);
  assert.equal(result.verifiedCLV,null);
  assert.equal(result.bettingAuthorized,false);
  assert.ok(result.years.every(y=>y.conservativelyCalibrated.brier===y.closingMarket.brier));
  assert.ok(Object.values(result.pooledPolicy).every(p=>p.executable===false&&p.verifiedROI===null));
  assert.ok(result.pooledPolicy.MARKET_FAVORITE_70.graded<=result.pooledPolicy.MARKET_FAVORITE_65.graded);
  assert.ok(result.pooledPolicy.MARKET_FAVORITE_65.graded<=result.pooledPolicy.MARKET_FAVORITE_60.graded);
});
test('Prior years are mandatory and cannot be replaced by target year',()=>{
  assert.throws(()=>fitPriorMarketBlend([years[5]],2025),/Missing prior-year/);
  assert.throws(()=>fitPriorMarketBlend(years,2018),/Invalid test season/);
});
