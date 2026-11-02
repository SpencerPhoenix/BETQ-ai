import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strictAmerican,singleSettlement,illustrativePrice,assertSameContract,
  evaluateLockedPrice,summarizeROI
} from '../src/price-metrics.mjs';

const now=Date.parse('2026-11-01T20:00:00Z');
const d=ms=>new Date(ms).toISOString();
const base={
  sport:'americanfootball_nfl',eventId:'nfl-2026-100',market:'h2h',
  selectionId:'KC',period:'FULL_GAME',americanOdds:-110,
  capturedAt:d(now),kickoffAt:d(now+3*3600000),
  sourceProvider:'trusted-feed',sourceRecordId:'quote-entry-abc',sourceAttested:true
};
const close={
  ...base,americanOdds:-125,capturedAt:d(now+3*3600000-2*60000),
  sourceRecordId:'quote-close-def',oppositeAmerican:+115
};

test('ROI counts each stake, returns payouts, and treats PUSH and VOID differently',()=>{
  assert.deepEqual(singleSettlement(110,-110,'WIN'),{
    result:'WIN',stake:110,odds:-110,risked:110,netProfit:100,grossReturn:210
  });
  assert.deepEqual(singleSettlement(110,-110,'LOSS'),{
    result:'LOSS',stake:110,odds:-110,risked:110,netProfit:-110,grossReturn:0
  });
  assert.equal(singleSettlement(110,-110,'PUSH').risked,110);
  assert.equal(singleSettlement(110,-110,'PUSH').netProfit,0);
  assert.equal(singleSettlement(110,-110,'VOID').risked,0);
  assert.equal(singleSettlement(110,-110,'OPEN').netProfit,null);
  assert.throws(()=>singleSettlement(1.001,+110,'WIN'),/Stake/);
  assert.throws(()=>singleSettlement(0,+110,'WIN'),/Stake/);
  assert.throws(()=>singleSettlement(100,0,'WIN'),/American odds/);
});

test('American odds convert to decimal before price CLV division',()=>{
  assert.ok(Math.abs(strictAmerican(-110)-(1+100/110))<1e-10);
  assert.equal(strictAmerican(+100),2);
  assert.equal(strictAmerican(-100),2);
  assert.throws(()=>strictAmerican(99),/American odds/);
  assert.throws(()=>strictAmerican(100.5),/American odds/);
  const m=illustrativePrice({
    entryAmerican:-110,closingAmerican:-125,
    closingOppositeAmerican:+115,stake:110,result:'WIN'
  });
  assert.ok(Math.abs(m.rawCLVPercent-6.0606)<0.001);
  assert.ok(m.noVigClosingProbability>0.5&&m.noVigClosingProbability<0.6);
  assert.ok(m.closingOverroundPercent>0);
  assert.equal(m.settlement.netProfit,100);
  assert.equal(m.verifiedCLV,false);
  assert.equal(m.verifiedROI,false);
});

test('Price changes: worse entry, unchanged price, and no-vig are signed correctly',()=>{
  const better=illustrativePrice({entryAmerican:+150,closingAmerican:+130,stake:100});
  const worse=illustrativePrice({entryAmerican:-130,closingAmerican:-110,stake:100});
  assert.ok(better.rawCLVPercent>0);
  assert.ok(worse.rawCLVPercent<0);
  assert.equal(illustrativePrice({entryAmerican:-110,closingAmerican:-110}).rawCLVPercent,0);
  assert.equal(illustrativePrice({entryAmerican:-110,closingAmerican:-125}).noVigCLVPercent,null);
  assert.ok(better.impliedProbabilityMovePoints>0);
});

test('Exact game/selection/period/handicap matching excludes mixed contracts',()=>{
  assert.equal(assertSameContract(base,close),true);
  for(const field of ['sport','eventId','market','selectionId','period']){
    assert.throws(()=>assertSameContract(base,{...close,[field]:'different'}),/Contract|contract|Unsupported/);
  }
  const spreadEntry={...base,market:'spreads',line:-2.5};
  const spreadClose={...close,market:'spreads',line:-2.5};
  assert.equal(assertSameContract(spreadEntry,spreadClose),true);
  assert.throws(()=>assertSameContract(spreadEntry,{...spreadClose,line:-3.5}),/Spread\/total line/);
  assert.throws(()=>assertSameContract({...base,market:'totals',line:48.5},
    {...close,market:'totals',line:49.5}),/Spread\/total line/);
  assert.throws(()=>assertSameContract({...base,market:'spreads',line:3.5},
    {...close,market:'spreads',line:-3.5}),/Spread\/total line/);
});

test('Time and provenance are required for trustworthy matched CLV',()=>{
  const valid=evaluateLockedPrice(base,close);
  assert.equal(valid.sameContract,true);
  assert.equal(valid.state,'ATTESTED_PRICE_PROXY');
  assert.equal(valid.verifiedCLV,false); // still NOT a certified closing book source
  assert.ok(valid.rawPriceMovementPercent>0);
  assert.ok(Number.isFinite(valid.noVigClosePriceMovementPercent));
  assert.equal(valid.closingLeadMinutes,2);
  assert.throws(()=>evaluateLockedPrice(base,{...close,capturedAt:d(now+3*3600000+1000)}),/pre-kickoff/);
  assert.throws(()=>evaluateLockedPrice(base,{...close,capturedAt:d(now-1000)}),/pre-kickoff/);
  assert.throws(()=>evaluateLockedPrice(base,{...close,kickoffAt:d(now+2*3600000)}),/pre-kickoff/);
  const early=evaluateLockedPrice(base,{...close,capturedAt:d(now+1*3600000)});
  assert.equal(early.state,'NEAR_CLOSE_PROXY_NOT_TRUE_CLOSE');
  const unver=evaluateLockedPrice(base,{...close,sourceAttested:false});
  assert.equal(unver.state,'UNVERIFIED_CLOSE_PRICE');
});

test('Graded ROI uses total money risked, not initial bankroll; void/open excluded',()=>{
  const rows=[
    {id:'a',stake:100,odds:+100,status:'WIN'},
    {id:'b',stake:100,odds:-110,status:'LOSS'},
    {id:'c',stake:50,odds:-110,status:'PUSH'},
    {id:'d',stake:100,odds:-110,status:'VOID'},
    {id:'e',stake:200,odds:-110,status:'OPEN'}
  ];
  const r=summarizeROI(rows,{startingBankroll:1000});
  assert.equal(r.totalRisked,250);
  assert.equal(r.profit,0);
  assert.equal(r.roiPercent,0);
  assert.equal(r.bankrollGrowthPercent,0);
  assert.equal(r.counts.push,1);
  assert.equal(r.counts.void,1);
  assert.equal(r.counts.open,1);
  assert.equal(r.verifiedRealMoneyROI,false);
});

test('Duplicate, manipulated and unverified transactions cannot inflate verified ROI',()=>{
  const sample=[
    {id:'one',stake:100,odds:+100,status:'WIN'},
    {id:'one',stake:100,odds:+100,status:'WIN'},
    {id:'other',stake:100,odds:+100,status:'LOSS'}
  ];
  const roi=summarizeROI(sample);
  assert.equal(roi.counts.duplicate,1);
  assert.equal(roi.roiPercent,0);
  const unverified=summarizeROI(sample,{mode:'VERIFIED_TRANSACTION'});
  assert.equal(unverified.roiPercent,null);
  assert.equal(unverified.counts.unverified,2);
  const fakeVerified=summarizeROI([{
    ...sample[0],executionVerified:true,settlementVerified:true,
    executionReference:'trusted-fill-001',resultReference:'trusted-final-001'
  }],{mode:'VERIFIED_TRANSACTION'});
  assert.equal(fakeVerified.verifiedRealMoneyROI,false);
  assert.equal(fakeVerified.sourceTrust,'UNVALIDATED_ATTESTATIONS_ONLY');
});

test('Deterministic 10,000-price stress: CLV ordering, quote arithmetic and bounded profits',()=>{
  let seed=877331;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const american=()=> {
    const mag=100+Math.floor(rnd()*900);
    return rnd()<0.5?mag:-mag;
  };
  for(let i=0;i<10000;i++){
    const entry=american(),closeOdds=american(),stake=1+Math.floor(rnd()*1000);
    const result=rnd()<0.49?'WIN':'LOSS';
    const m=illustrativePrice({entryAmerican:entry,closingAmerican:closeOdds,stake,result});
    assert.ok(Number.isFinite(m.rawCLVPercent));
    assert.ok(m.rawCLVPercent<1000&&m.rawCLVPercent>-100);
    assert.equal(m.rawCLVPercent>0,strictAmerican(entry)>strictAmerican(closeOdds));
    assert.ok(Number.isFinite(m.settlement.netProfit));
    assert.ok(m.settlement.risked>0);
    assert.ok(m.settlement.grossReturn>=0);
  }
});
