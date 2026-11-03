import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyJournal,summarizeEvidence} from '../src/evidence.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {isCorroboratedSettlement,reconcileSettlements} from '../src/settlement-only.mjs';
import {isValidEvidenceSummary,createEvidenceFeed} from '../src/evidence-feed.mjs';

const now=Date.parse('2026-11-04T12:30:00.000Z');
const iso=n=>new Date(n).toISOString();
function fixture(){
  const journal=emptyJournal(2026);
  journal.snapshots.push({
    id:'original',gameId:'2026_08_CHI_SEA',gameDate:'2026-11-02',season:2026,
    home:'SEA',away:'CHI',commenceTime:'2026-11-03T01:20:00.000Z',
    capturedAt:'2026-11-02T01:00:00.000Z',sourceReceivedAt:'2026-11-02T00:59:59.000Z',
    modelBuiltAt:'2026-11-01T12:00:00.000Z',modelHomeProbability:0.61,
    marketHomeProbability:0.60,marketBookCount:4,marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',
    marketNewestQuoteAt:'2026-11-02T00:59:58.000Z',
    independentModel:true,researchOnly:true
  });
  const row={game_id:'2026_08_CHI_SEA',season:'2026',game_type:'REG',
    gameday:'2026-11-02',home_team:'SEA',away_team:'CHI',home_score:'17',away_score:'34'};
  const attestation={status:'CROSS_SOURCE_FINAL',corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
    gameId:row.game_id,gameDate:row.gameday,homeScore:17,awayScore:34,
    eventId:'401123456',observedAt:iso(now),sourceSha256:'a'.repeat(64),
    officialLeagueCertification:false};
  const options={now,attestations:{[row.game_id]:attestation},
    communitySourceSha256:'b'.repeat(64),communitySourceObservedAt:iso(now-1000)};
  return {journal,row,options};
}

test('independent final status alone cannot append without fresh primary-source provenance',()=>{
  const {journal,row,options}=fixture();
  for(const invalid of [
    {communitySourceSha256:null},{communitySourceSha256:'not-a-digest'},
    {communitySourceObservedAt:null},{communitySourceObservedAt:'invalid'},
    {communitySourceObservedAt:iso(now-3600001)},
    {communitySourceObservedAt:iso(now+120001)}
  ]){
    const result=reconcileSettlements(journal,[row],{...options,...invalid});
    assert.equal(result.appended,0,JSON.stringify(invalid));
    assert.equal(result.incompleteSourceProvenanceCandidates,1);
    assert.deepEqual(result.journal,journal);
  }
});

test('persisted scoring requires both source vintages tied to the reconciliation timestamp',()=>{
  const {journal,row,options}=fixture();
  const result=reconcileSettlements(journal,[row],options);
  assert.equal(result.appended,1);
  const record=result.journal.settlements[0];
  assert.equal(isCorroboratedSettlement(record),true);
  for(const invalid of [
    {communitySourceVintage:undefined},
    {communitySourceVintage:{...record.communitySourceVintage,sha256:null}},
    {communitySourceVintage:{...record.communitySourceVintage,publicationTimeVerified:true}},
    {communitySourceVintage:{...record.communitySourceVintage,collectorObservedAt:iso(now+120001)}},
    {communitySourceVintage:{...record.communitySourceVintage,collectorObservedAt:iso(now-3600001)}},
    {verifiedAt:undefined},{verifiedAt:'invalid'},{verifiedAt:iso(now+2*3600000)},
    {finalityAttestation:{...record.finalityAttestation,observedAt:iso(now+120001)}},
    {finalityAttestation:{...record.finalityAttestation,observedAt:iso(now-3600001)}}
  ])assert.equal(isCorroboratedSettlement({...record,...invalid}),false,JSON.stringify(invalid));
  for(const invalid of ['2026-11-04','2026-02-30T12:30:00.000Z','2026-11-04T12:30:00',0]){
    assert.equal(isCorroboratedSettlement({...record,verifiedAt:invalid,
      communitySourceVintage:{...record.communitySourceVintage,collectorObservedAt:invalid},
      finalityAttestation:{...record.finalityAttestation,observedAt:invalid}}),false);
  }
  // Valid old records do not expire merely because the reporting clock advances.
  assert.equal(summarizeEvidence(result.journal,now+365*86400000).sourceCorroboratedSettledGames,1);
});

test('both source receipt freshness boundaries are inclusive',()=>{
  const {journal,row,options}=fixture();
  for(const delta of [-3600000,120000]){
    const timestamp=iso(now+delta);
    const result=reconcileSettlements(journal,[row],{...options,
      communitySourceObservedAt:timestamp,
      attestations:{[row.game_id]:{...options.attestations[row.game_id],observedAt:timestamp}}});
    assert.equal(result.appended,1);
    assert.equal(isCorroboratedSettlement(result.journal.settlements[0]),true);
  }
});

test('incomplete same-score provenance is upgraded append-only and then idempotent',()=>{
  const {journal,row,options}=fixture();
  const first=reconcileSettlements(journal,[row],options).journal;
  delete first.settlements[0].communitySourceVintage;
  const before=structuredClone(first.settlements[0]);
  const upgraded=reconcileSettlements(first,[row],options);
  assert.equal(upgraded.appended,1);
  assert.equal(upgraded.upgradedLegacySettlements,1);
  assert.deepEqual(upgraded.journal.settlements[0],before);
  assert.equal(upgraded.journal.settlements[1].revision,2);
  assert.equal(isCorroboratedSettlement(upgraded.journal.settlements[1]),true);
  assert.deepEqual(upgraded.journal.snapshots,journal.snapshots);
  assert.equal(reconcileSettlements(upgraded.journal,[row],options).appended,0);
});

test('incomplete legacy provenance is preserved but cannot unlock ordinary or sequential scores',()=>{
  const {journal,row,options}=fixture();
  const record=reconcileSettlements(journal,[row],options).journal.settlements[0];
  delete record.communitySourceVintage;
  for(let i=0;i<30;i++){
    const gameId='legacy-'+i;
    journal.snapshots.push({...journal.snapshots[0],id:'legacy-shot-'+i,gameId});
    journal.settlements.push({...record,gameId,
      finalityAttestation:{...record.finalityAttestation,gameId}});
  }
  journal.snapshots.shift();
  const before=JSON.stringify(journal);
  const report=summarizeEvidence(journal,now);
  assert.equal(report.settledGames,30);
  assert.equal(report.sourceCorroboratedSettledGames,0);
  assert.equal(report.forwardMetrics,null);
  assert.equal(report.marketComparison,null);
  const sequential=calculateSequentialEvidence(journal);
  assert.equal(sequential.eligibleSettledNonTieGames,0);
  assert.equal(sequential.properScores,null);
  assert.equal(JSON.stringify(journal),before);
});

test('remote challenger performance requires a corroborated sample, not just 30 legacy finals',async()=>{
  const fallback=summarizeEvidence(emptyJournal(2026),now);
  const report={...fallback,prospectiveGames:30,settledGames:30,
    pairedChallengerSettled:30,challengerForwardComparison:{n:30},
    sourceCorroboratedSettledGames:0,sourceUncorroboratedSettledGames:30};
  assert.equal(isValidEvidenceSummary(report),false);
  assert.equal(isValidEvidenceSummary({...report,sourceCorroboratedSettledGames:undefined}),false);
  assert.equal(isValidEvidenceSummary({...report,sourceCorroboratedSettledGames:29}),false);
  const valid={...report,sourceCorroboratedSettledGames:30,sourceUncorroboratedSettledGames:0};
  assert.equal(isValidEvidenceSummary(valid),true);
  for(const invalid of [
    {pairedChallengerSettled:30.5,challengerForwardComparison:{n:30.5}},
    {challengerForwardComparison:{n:31}},
    {pairedChallengerSettled:31,challengerForwardComparison:{n:31}}
  ])assert.equal(isValidEvidenceSummary({...valid,...invalid}),false);
  const feed=createEvidenceFeed({fallback,clock:()=>now,fetchImpl:async()=>
    new Response(JSON.stringify(report),{status:200})});
  assert.deepEqual(await feed.get(),fallback);
  assert.equal(feed.status().lastError,'PUBLICATION_UNAVAILABLE_OR_INVALID');
});
