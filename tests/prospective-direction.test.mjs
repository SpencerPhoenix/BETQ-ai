import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyJournal} from '../src/evidence.mjs';
import {summarizeProspectiveDirection,MOVEMENT_PROTOCOL} from '../src/prospective-direction.mjs';
import {summarizeDerivedForwardMarkets,createDerivedForwardMarketFeed} from '../src/shadow-derived.mjs';
const BASE=Date.parse('2026-11-05T13:00:00Z');
const iso=ms=>new Date(ms).toISOString();
function shot(game,index,model=.62,market=.52,{receivedDelayMs=0,marketDelayMs=0,
  kickDelay=4*86400000,eventId,modelBuiltAt,marketBookCount=4,modelVersion='nfl-elo-1'}={}){
  const captured=BASE+index*1800000; // exact 30 minute gap
  return {
    id:game+'-'+index,gameId:game,season:2026,providerEventId:eventId||game+'-provider',
    home:'HOME',away:'AWAY',gameDate:'2026-11-08',
    commenceTime:iso(BASE+kickDelay),
    capturedAt:iso(captured),sourceReceivedAt:iso(captured+receivedDelayMs),
    marketNewestQuoteAt:iso(captured-5000+marketDelayMs),
    modelBuiltAt:modelBuiltAt||iso(BASE-300000),modelVersion,
    modelHomeProbability:model,marketHomeProbability:market,
    marketBookCount,marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',
    researchOnly:true,independentModel:true
  };
}
function journal(shots){const j=emptyJournal(2026);j.snapshots=shots;return j;}
test('Predeclared standard requires 3pp model gap, 0.5pp price movement, 15min separation, 30 distinct games',()=>{
  assert.equal(MOVEMENT_PROTOCOL.minimumGapProbabilityPoints,3);
  assert.equal(MOVEMENT_PROTOCOL.minimumMovementProbabilityPoints,.5);
  assert.equal(MOVEMENT_PROTOCOL.minimumMinutesBetweenObservations,15);
  assert.equal(MOVEMENT_PROTOCOL.minimumQualifyingGamesToReport,30);
  const r=summarizeProspectiveDirection(journal([
    shot('a',0,.62,.52),shot('a',1,.62,.54),
    shot('b',0,.62,.52),shot('b',1,.62,.515)
  ]));
  assert.equal(r.gamesWithSnapshots,2);
  assert.equal(r.gamesWithEligiblePairedObservations,2);
  assert.equal(r.candidateMarketMovements,2);
  assert.equal(r.qualifyingDirectionMatches,1);
  assert.equal(r.qualifyingDirectionMisses,1);
  assert.equal(r.studyStatus,'INSUFFICIENT_PROSPECTIVE_DIRECTION_SAMPLE');
  assert.equal(r.directionMatchPercent,null);
  assert.equal(r.meanSignedMovementTowardModelPoints,null);
  assert.equal(r.realMoneyROI,null);
  assert.equal(r.verifiedCLV,null);
  assert.equal(r.bettingAuthorized,false);
  assert.equal(r.modelPromoted,false);
  assert.equal(r.marketBeatingEdgeEstablished,false);
  assert.ok(r.preview.every(x=>x.matchup.startsWith('a')||x.matchup.startsWith('b')));
});
test('Repeated same provider quote time, same instant and changed model/kickoff cannot manufacture a lead',()=>{
  for(const modification of [
    s=>{s.marketNewestQuoteAt=iso(BASE-5000);},
    s=>{s.capturedAt=iso(BASE+600000);s.sourceReceivedAt=iso(BASE+600000);},
    s=>{s.modelVersion='nfl-elo-future';},
    s=>{s.modelBuiltAt=iso(BASE+3600000);},
    s=>{s.commenceTime=iso(BASE+5*86400000);},
    s=>{s.providerEventId='different-game-identity';}
  ]){
    const first=shot('a',0,.62,.52),second=shot('a',1,.62,.54);
    modification(second);
    // Either the overarching forward journal gate rejects a malformed
    // observation, or the tighter movement-specific clock/contract gate
    // rejects it. Both outcomes are safe, and neither manufactures an edge.
    try{
      const r=summarizeProspectiveDirection(journal([first,second]));
      assert.equal(r.candidateMarketMovements,0);
      assert.equal(r.directionMatchPercent,null);
    }catch(error){
      assert.match(String(error),/Invalid journal observation/);
    }
  }
});
test('Insufficient independent books and untrusted delayed source timestamps fail closed',()=>{
  for(const second of [
    shot('a',1,.62,.54,{marketBookCount:2}),
    shot('a',1,.62,.54,{receivedDelayMs:180000}),
    shot('a',1,.62,.54,{marketDelayMs:2400000})
  ]){
    try{
      const r=summarizeProspectiveDirection(journal([shot('a',0),second]));
      assert.equal(r.candidateMarketMovements,0);
      assert.equal(r.bettingAuthorized,false);
    }catch(error){
      assert.match(String(error),/Invalid journal observation/);
    }
  }
});
test('30 independent games unlock descriptive rate, NEVER economic advantage or verified ROI',()=>{
  const snapshots=[];
  for(let i=0;i<40;i++){
    const id='game-'+i;
    snapshots.push(shot(id,0,.62,.52),shot(id,1,.62,i%4===0?.51:.54));
  }
  const r=summarizeProspectiveDirection(journal(snapshots));
  assert.equal(r.candidateMarketMovements,40);
  assert.equal(r.qualifyingDirectionMatches,30);
  assert.equal(r.qualifyingDirectionMisses,10);
  assert.equal(r.directionMatchPercent,75);
  assert.equal(r.descriptiveWilson95Percent.length,2);
  assert.equal(r.studyStatus,'RESEARCH_SAMPLE_OBSERVED_NOT_AN_EDGE');
  assert.equal(r.marketBeatingEdgeEstablished,false);
  assert.equal(r.realMoneyROI,null);
  assert.equal(r.verifiedCLV,null);
  assert.equal(r.headlineMetric,null);
  assert.equal(r.preview.length,12);
});
test('Low model disagreement and low market movement are reported as exclusions',()=>{
  const r=summarizeProspectiveDirection(journal([
    shot('small-gap',0,.525,.52),shot('small-gap',1,.525,.54),
    shot('small-move',0,.62,.52),shot('small-move',1,.62,.522),
    shot('good',0,.62,.52),shot('good',1,.62,.54)
  ]));
  assert.equal(r.excluded.disagreementTooSmall,1);
  assert.equal(r.excluded.moveTooSmall,1);
  assert.equal(r.noMaterialMovement,1);
  assert.equal(r.candidateMarketMovements,1);
});
test('No new provider calls: existing source-derived HTTP reader carries the same audit',async()=>{
  let calls=0;
  const j=journal([shot('a',0,.62,.52),shot('a',1,.62,.54)]);
  const feed=createDerivedForwardMarketFeed({
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify(j),{status:200});},
    clock:()=>BASE+3600000
  });
  const a=await feed.get(),b=await feed.get();
  assert.equal(calls,1);
  assert.deepEqual(a,b);
  assert.equal(a.prospectiveModelLeadDiagnostic.candidateMarketMovements,1);
  assert.equal(a.prospectiveModelLeadDiagnostic.directionMatchPercent,null);
  assert.equal(a.prospectiveModelLeadDiagnostic.realMoneyROI,null);
  assert.equal(a.licensedRawBookmakerQuotesIncluded,false);
  assert.ok(!JSON.stringify(a).includes('bookmakerKey'));
});
test('Invalid thresholds and forged outcome journals cannot pass source integrity',()=>{
  const j=journal([shot('a',0,.62,.52)]);
  assert.throws(()=>summarizeProspectiveDirection(j,{reportAt:5}),/Invalid pre-registered/);
  assert.throws(()=>summarizeProspectiveDirection(j,{minDelayMinutes:0}),/Invalid pre-registered/);
  const bad=structuredClone(j);bad.snapshots.push({...bad.snapshots[0]});
  assert.throws(()=>summarizeProspectiveDirection(bad),/Invalid journal observation/);
});
