import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFutureMarketCapture,summarizeDerivedMarketObservations,summarizeWrittenMarketCapture} from '../src/market-capture-diagnostics.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {isEligibleModelSnapshot,isEligibleMarketSnapshot} from '../src/evidence-integrity.mjs';

// Fabricated observations only. No provider, network, credential or data writes.
const now=Date.parse('2026-11-07T12:00:00.000Z'),iso=n=>new Date(n).toISOString();
const context={capturedAt:iso(now),sourceReceivedAt:iso(now-1000),commenceTime:iso(now+3600000)};
const consensus=()=>({available:true,method:'ALL_BOOKS_MEDIAN_DE_VIG',books:3,homeProbability:.55,
  oldestQuoteAt:iso(now-600000),latestQuoteAt:iso(now-2000)});

test('Future diagnostic uses exact absolute oldest bound, not relative display age',()=>{
  const c=consensus(),before=structuredClone(c);
  assert.deepEqual(assessFutureMarketCapture(c,context),{eligible:true,reasons:[]});
  assert.deepEqual(c,before);
  c.oldestQuoteAt=iso(now-600001);c.oldestQuoteAgeSeconds=1;
  assert.deepEqual(assessFutureMarketCapture(c,context),{eligible:false,reasons:['OLDEST_QUOTE_EXPIRED_AT_CAPTURE']});
  delete c.oldestQuoteAt;
  assert.deepEqual(assessFutureMarketCapture(c,context),{eligible:false,reasons:['MISSING_OR_INVALID_OLDEST_QUOTE_TIMESTAMP']});
});

test('Diagnostics fail closed for absent, malformed and wrong-order timestamp proof',()=>{
  const examples=[
    [{...consensus(),latestQuoteAt:iso(now-500)},context,'QUOTE_AFTER_SOURCE_RECEIPT'],
    [{...consensus(),oldestQuoteAt:iso(now-1000)},context,'QUOTE_BOUND_ORDER_INVALID'],
    [consensus(),{...context,sourceReceivedAt:iso(now+1)},'SOURCE_RECEIPT_AFTER_CAPTURE'],
    [consensus(),{...context,commenceTime:iso(now-2000)},'QUOTE_NOT_PREGAME'],
    [consensus(),{...context,capturedAt:'2026-11-07T12:00:00Z'},'INVALID_CAPTURE_TIMESTAMP'],
    [{...consensus(),books:3.5},context,'INSUFFICIENT_OR_INVALID_BOOK_COUNT'],
    [{...consensus(),homeProbability:NaN},context,'INVALID_CONSENSUS_PROBABILITY'],
    [{...consensus(),method:'BOOKMAKER_TIMESTAMP_FALLBACK'},context,'UNSUPPORTED_CONSENSUS_METHOD']
  ];
  for(const [c,input,reason] of examples){const result=assessFutureMarketCapture(c,input);assert.equal(result.eligible,false);assert.ok(result.reasons.includes(reason),reason);}
});

test('Unavailable consensus diagnostics never echo raw provider values or invent provenance',()=>{
  for(const c of [null,{}, {available:'true'}, {available:false,reason:'private source body/credential'}])
    assert.deepEqual(assessFutureMarketCapture(c,context),{eligible:false,reasons:['CONSENSUS_UNAVAILABLE']});
  assert.deepEqual(assessFutureMarketCapture({available:false,reason:'INVALID_BOOKMAKER_COLLECTION'},context),
    {eligible:false,reasons:['INVALID_BOOKMAKER_COLLECTION']});
});

test('Derived observations distinguish model-only outcomes and overlapping fixed reasons',()=>{
  const rows=[{eligible:true,reasons:[]},{eligible:false,reasons:['INVALID_CAPTURE_TIMESTAMP','INVALID_SOURCE_RECEIPT_TIMESTAMP']},
    {eligible:false,reasons:['INVALID_CAPTURE_TIMESTAMP']}];
  const result=summarizeDerivedMarketObservations(rows);
  assert.equal(result.modelObservations,3);assert.equal(result.pairedMarketObservations,1);assert.equal(result.modelOnlyObservations,2);
  assert.deepEqual(result.reasonCounts,{INVALID_CAPTURE_TIMESTAMP:2,INVALID_SOURCE_RECEIPT_TIMESTAMP:1});
  assert.equal(result.reasonCountsOverlap,true);
  assert.equal(result.scope,'MODEL_ELIGIBLE_OBSERVATIONS_BEFORE_IDENTITY_ADMISSION');
});

const modelOnly=s=>({...s,marketOldestQuoteAt:null,marketNewestQuoteAt:null,marketHomeProbability:null,marketBookCount:null,marketBasis:null});
const journal=snapshots=>({snapshots});
test('Written diagnostics count actual appended rows and do not claim source authenticity or outcomes',()=>{
  const shots=syntheticScoringJournal(2).snapshots;
  shots[1]=modelOnly(shots[1]);const original=journal([]),updated=journal(shots),before=structuredClone(updated);
  const result=summarizeWrittenMarketCapture(original,shots,updated);
  assert.equal(result.status,'PARTIAL_MARKET_PROVENANCE_APPENDED');
  assert.equal(result.appendedSnapshots,2);assert.equal(result.appendedPairedMarketSnapshots,1);assert.equal(result.appendedModelOnlySnapshots,1);
  assert.equal(result.newFirstForecastGames,2);assert.equal(result.newFirstForecastGamesWithMarket,1);assert.equal(result.newFirstForecastGamesWithoutMarket,1);
  for(const key of ['historicalEvidenceReconstructed','baselineSelectionChanged','sourceAuthenticityVerified','resultCorroborationVerified','roiOrClvEstablished'])assert.equal(result[key],false);
  assert.deepEqual(updated,before);assert.deepEqual(original,{snapshots:[]});
});

test('Same-ID improved candidate is not counted as appended or used to rewrite the frozen baseline',()=>{
  const paired=syntheticScoringJournal(1).snapshots[0],old=modelOnly(paired),original=journal([old]),before=structuredClone(original);
  const result=summarizeWrittenMarketCapture(original,[paired,paired],structuredClone(original));
  assert.equal(result.status,'NO_NEW_MARKET_EVIDENCE');assert.equal(result.duplicateMarketImprovementsNotWritten,1);
  assert.equal(result.appendedPairedMarketSnapshots,0);assert.equal(result.newFirstForecastGames,0);
  assert.equal(result.unchangedLegacyFirstForecastsWithoutMarket,1);assert.deepEqual(original,before);
  assert.equal(isEligibleModelSnapshot(old),true);assert.equal(isEligibleMarketSnapshot(old),false);
});

test('Later paired capture remains new evidence but does not replace an earlier model-only first forecast',()=>{
  const paired=syntheticScoringJournal(1).snapshots[0],old=modelOnly({...paired,id:'earliest',capturedAt:iso(now-1)});
  // Move the original source receipt with the earlier model-only capture; no old quote proof is inferred.
  old.sourceReceivedAt=iso(now-1000);
  const result=summarizeWrittenMarketCapture(journal([old]),[paired],journal([old,paired]));
  assert.equal(result.status,'PAIRED_MARKET_PROVENANCE_APPENDED');assert.equal(result.appendedPairedMarketSnapshots,1);
  assert.equal(result.newFirstForecastGames,0);assert.equal(result.unchangedLegacyFirstForecastsWithoutMarket,1);
  assert.equal(result.baselineSelectionChanged,false);assert.equal(result.historicalEvidenceReconstructed,false);
});

test('Only actually appended model-only rows report no usable market provenance',()=>{
  const shots=syntheticScoringJournal(1).snapshots.map(modelOnly);
  const result=summarizeWrittenMarketCapture(journal([]),shots,journal(shots));
  assert.equal(result.status,'MODEL_ONLY_NO_USABLE_MARKET_PROVENANCE');assert.equal(result.appendedPairedMarketSnapshots,0);
  assert.equal(result.appendedModelOnlySnapshots,1);assert.equal(result.newFirstForecastGamesWithoutMarket,1);
});
