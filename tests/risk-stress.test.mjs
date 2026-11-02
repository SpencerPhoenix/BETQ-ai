import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalOutcomeBlocks,simulateBankrollRisk} from '../src/risk-stress.mjs';
const sample={
  version:'nfl-replay-v2',years:[2022,2023].map(season=>({
    season,
    decisions:Array.from({length:120},(_,i)=>({
      gameId:season+'_'+i,season,week:Math.floor(i/8)+1,
      date:season+'-09-'+String(i%28+1).padStart(2,'0'),
      actual:i%3===0?'home':'away',
      selectedSide:'home',selectedOdds:i%2===0?+120:-125,
      priceAvailable:true,estimatedEV:.06
    }))
  }))
};
test('Historical outcomes preserve week block identity and flat hypothetical one-unit profit',()=>{
  const p=historicalOutcomeBlocks(sample,{thresholdEVPercent:3});
  assert.equal(p.blocks.length,30);
  assert.equal(p.eligible,240);
  assert.equal(p.noVerifiedEntry,true);
  assert.ok(p.blocks[0].rows.some(x=>x.netPerUnit===1.2));
  assert.ok(p.blocks[0].rows.some(x=>x.netPerUnit===-1));
  assert.match(p.priceBasis,/NOT_VERIFIED/);
});
test('Seeded week-block stress is reproducible and explicitly conditional, not risk-of-ruin fact',()=>{
  const p=historicalOutcomeBlocks(sample);
  const args={iterations:700,seed:9081,startingBankroll:100,stakeFraction:.01,practicalRuinFraction:.5};
  const first=simulateBankrollRisk(p,args),second=simulateBankrollRisk(p,args);
  assert.deepEqual(first,second);
  assert.equal(first.exactRealWorldRiskOfRuin,null);
  assert.equal(first.verifiedHistoricalROI,null);
  assert.equal(first.verifiedCLV,null);
  assert.equal(first.providerPriceTimeVerified,false);
  assert.equal(first.bettingAuthorized,false);
  assert.ok(first.pathMaxDrawdownPercent.p95>=first.pathMaxDrawdownPercent.median);
  assert.ok(first.frequencyCrossingPracticalRuinPercent>=0);
  assert.ok(first.frequencyCrossingPracticalRuinPercent<=100);
  assert.ok(first.frequencyEndingBelowStartPercent>=0);
  assert.ok(first.frequencyEndingBelowStartPercent<=100);
});
test('All losses cross practical threshold when stressed long enough, without literal zero',()=>{
  const p={blocks:Array.from({length:10},(_,w)=>({
    id:'2025:'+w,rows:Array.from({length:30},(_,i)=>({
      gameId:'x'+w+':'+i,date:'2025-10-01',netPerUnit:-1
    }))
  })),eligible:300};
  const r=simulateBankrollRisk(p,{iterations:150,seed:12,stakeFraction:.01});
  assert.equal(r.frequencyCrossingPracticalRuinPercent,100);
  assert.equal(r.frequencyEndingBelowStartPercent,100);
  assert.ok(r.endingBankrollReturnPercent.median>-100);
  assert.ok(r.endingBankrollReturnPercent.median<-90);
});
test('Bounded scenario rejects invalid sample, stakes, paths and assumptions',()=>{
  const p=historicalOutcomeBlocks(sample);
  for(const args of [
    {iterations:20},{iterations:50000},{stakeFraction:0},{stakeFraction:.08},
    {adverseWinFlipRate:-.05},{adverseWinFlipRate:.5},
    {startingBankroll:0},{practicalRuinFraction:1}
  ])assert.throws(()=>simulateBankrollRisk(p,args),/Invalid bounded risk scenario/);
  assert.throws(()=>historicalOutcomeBlocks(sample,{thresholdEVPercent:2}),/Invalid retrospective sample policy/);
});
test('Adverse deterioration is no more favorable when using identical seeded draws',()=>{
  const p=historicalOutcomeBlocks(sample);
  const baseline=simulateBankrollRisk(p,{iterations:1000,seed:9021,adverseWinFlipRate:0});
  const adverse=simulateBankrollRisk(p,{iterations:1000,seed:9021,adverseWinFlipRate:.2});
  // Same seed; week selection streams differ due to conditional flips, so
  // assert a clear distribution-level stress effect rather than path equality.
  assert.ok(adverse.endingBankrollReturnPercent.median<
    baseline.endingBankrollReturnPercent.median);
});
