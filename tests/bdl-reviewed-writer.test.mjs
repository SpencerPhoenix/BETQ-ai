import test from 'node:test';
import assert from 'node:assert/strict';
import {updateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {latestSettlementsByRevision,isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {isReviewedBdlSettlement,isDescriptivelyQualifiedSettlement,reviewedResultDigest} from '../src/bdl-reviewed-result.mjs';
import {reviewedBdlFixture} from './fixtures/bdl-reviewed-result.mjs';

const identity=s=>Object.fromEntries(['gameId','season','gameDate','home','away','commenceTime'].map(k=>[k,s[k]]));
function lowProvenance(snapshot,now,homeScore=27,awayScore=17){
  return {...identity(snapshot),source:'NFLVERSE_SCHEDULES',homeScore,awayScore,
    outcome:homeScore===awayScore?'TIE':homeScore>awayScore?'HOME':'AWAY',
    terminalStatusReceipt:{...identity(snapshot),bindingPolicy:'FROZEN_RESULT_RECEIPT_V1',source:'NFLVERSE_SCHEDULES',status:'FINAL',
      homeScore,awayScore,observedAt:new Date(now).toISOString(),sha256:'a'.repeat(64)}};
}

test('later public admission appends original review time and preserves every original row',()=>{
  const {journal,snapshot,result,now}=reviewedBdlFixture(),before=structuredClone(journal);
  const out=updateJournal(journal,[],[result],now),stored=out.journal.settlements.at(-1);
  assert.equal(out.settlementRevisions,1);assert.equal(stored.revision,2);
  assert.equal(stored.verifiedAt,result.verifiedAt);assert.notEqual(stored.verifiedAt,new Date(now).toISOString());
  assert.deepEqual(out.journal.snapshots,journal.snapshots);assert.deepEqual(out.journal.settlements.slice(0,1),journal.settlements);
  assert.deepEqual(journal,before);assert.equal(isReviewedBdlSettlement(stored,snapshot),true);
  assert.equal(isSourceCorroboratedSettlement(stored,snapshot),false);
  const summary=summarizeEvidence(out.journal,now);assert.equal(summary.sourceCorroboratedSettledGames,0);assert.equal(summary.forwardMetrics,null);
});

test('exact receipt repeats are idempotent and changed content under the same receipt is rejected',()=>{
  const f=reviewedBdlFixture(),once=updateJournal(f.journal,[],[f.result],f.now).journal;
  const repeat=updateJournal(once,[],[f.result,f.result],f.now+1000);
  assert.equal(repeat.settlementRevisions,0);assert.deepEqual(repeat.journal,once);
  const altered=structuredClone(f.result);altered.review.encryptedArtifactSha256='f'.repeat(64);
  assert.throws(()=>updateJournal(once,[],[altered],f.now+1000),/receipt reused/);
});

test('same-score lower-provenance polls cannot downgrade reviewed descriptive qualification',()=>{
  const f=reviewedBdlFixture(),once=updateJournal(f.journal,[],[f.result],f.now).journal;
  const out=updateJournal(once,[],[lowProvenance(f.snapshot,f.now)],f.now);
  assert.equal(out.settlementRevisions,0);assert.deepEqual(out.journal,once);
  assert.equal(isDescriptivelyQualifiedSettlement(out.journal.settlements.at(-1),f.snapshot),true);
});

test('a real correction appends unqualified revision and replay never restores the older reviewed score',()=>{
  const f=reviewedBdlFixture(),once=updateJournal(f.journal,[],[f.result],f.now).journal;
  const corrected=updateJournal(once,[],[lowProvenance(f.snapshot,f.now,24,17)],f.now);
  assert.equal(corrected.settlementRevisions,1);assert.equal(corrected.journal.settlements.length,3);
  const latest=latestSettlementsByRevision(corrected.journal.settlements).get(f.snapshot.gameId);
  assert.equal(latest.homeScore,24);assert.equal(latest.revision,3);
  assert.equal(isDescriptivelyQualifiedSettlement(latest,f.snapshot),false);
  const replay=updateJournal(corrected.journal,[],[f.result],f.now+1000);
  assert.equal(replay.settlementRevisions,0);assert.deepEqual(replay.journal,corrected.journal);
  const differentReceipt=structuredClone(f.result);differentReceipt.review.receiptSha256='f'.repeat(64);
  assert.throws(()=>updateJournal(corrected.journal,[],[differentReceipt],f.now+1000),/binding changed/);
});

test('stale target, changed frozen history, backdated and future reviews cannot be admitted',()=>{
  for(const mutate of [
    f=>{f.result.review.retainedResultSha256=null;},
    f=>{f.result.review.allFrozenSnapshotsSha256='a'.repeat(64);},
    f=>{f.journal.settlements[0].verifiedAt='2026-11-09T19:00:00.000Z';f.result.review.retainedResultSha256=reviewedResultDigest(f.journal.settlements[0]);},
    f=>{f.now=Date.parse(f.result.verifiedAt)-1;},
    f=>{f.result.review.firstFrozenSnapshotSha256='b'.repeat(64);},
    f=>{f.result.nativeFinalObservation.rawBody='NOT_ALLOWED';},
  ]){
    const f=reviewedBdlFixture();mutate(f);const before=structuredClone(f.journal);
    assert.throws(()=>updateJournal(f.journal,[],[f.result],f.now));assert.deepEqual(f.journal,before);
  }
});

test('changed native mapping is not admitted as another revision',()=>{
  const f=reviewedBdlFixture(),once=updateJournal(f.journal,[],[f.result],f.now).journal;
  const changed=structuredClone(f.result);changed.review.receiptSha256='f'.repeat(64);
  changed.review.retainedResultSha256=reviewedResultDigest(once.settlements.at(-1));
  changed.nativeFinalObservation.providerGameId++;
  assert.throws(()=>updateJournal(once,[],[changed],f.now),/native game mapping/);
  changed.nativeFinalObservation.providerGameId--;changed.nativeFinalObservation.providerHomeTeamId+=10;
  assert.throws(()=>updateJournal(once,[],[changed],f.now),/native team mapping/);
});

test('known kickoff conflict remains unmodifiable even for a matching reviewed receipt',()=>{
  const f=reviewedBdlFixture();f.journal.snapshots.push({...f.snapshot,id:'later-conflict',capturedAt:'2026-11-07T12:01:00.000Z',commenceTime:'2026-11-08T18:05:00.000Z'});
  f.result.review.allFrozenSnapshotsSha256=reviewedResultDigest(f.journal.snapshots);
  const before=structuredClone(f.journal);
  assert.throws(()=>updateJournal(f.journal,[],[f.result],f.now),/Quarantined schedule/);
  assert.deepEqual(f.journal,before);
});

test('first reviewed outcome may append only with explicit null prior binding',()=>{
  const f=reviewedBdlFixture({prior:false});const out=updateJournal(f.journal,[],[f.result],f.now);
  assert.equal(out.settlementRevisions,1);assert.equal(out.journal.settlements[0].revision,1);
  f.result.review.retainedResultSha256='f'.repeat(64);
  assert.throws(()=>updateJournal(f.journal,[],[f.result],f.now),/binding changed/);
});


test('reviewed admission rejects provider drift, missing provider identity and duplicate frozen event aliases',()=>{
  for(const mutate of [
    f=>{delete f.journal.snapshots[0].providerEventId;},
    f=>{f.journal.snapshots.push({...f.snapshot,id:'provider-drift',capturedAt:'2026-11-07T12:01:00.000Z',providerEventId:'different'});},
    f=>{f.journal.snapshots.push({...f.snapshot,id:'event-alias',gameId:'2026_11_LV_KC',providerEventId:'alias'});},
  ]){
    const f=reviewedBdlFixture();mutate(f);
    f.result.review.firstFrozenSnapshotSha256=reviewedResultDigest(f.journal.snapshots[0]);
    f.result.review.allFrozenSnapshotsSha256=reviewedResultDigest(f.journal.snapshots.filter(s=>s.gameId===f.result.gameId));
    assert.throws(()=>updateJournal(f.journal,[],[f.result],f.now),/provider mapping/);
  }
});

test('older source observations cannot overwrite a more recently retained score correction',async()=>{
  const f=reviewedBdlFixture(),prior=f.journal.settlements[0];
  prior.homeScore=24;prior.verifiedAt='2026-11-09T18:02:30.000Z';
  const {createHash}=await import('node:crypto');
  prior.resultHash=createHash('sha256').update(prior.gameId+'|24|17').digest('hex').slice(0,24);
  f.result.review.retainedResultSha256=reviewedResultDigest(prior);
  assert.equal(isReviewedBdlSettlement(f.result,f.snapshot),true);
  assert.throws(()=>updateJournal(f.journal,[],[f.result],f.now),/RECEIPT_PREDATES_RETAINED_RESULT/);
  const {validateRetainedJournal}=await import('../src/evidence-journal-feed.mjs');
  const {gradeRetainedGames}=await import('../src/game-grading.mjs');
  f.journal.settlements.push(f.result);
  assert.throws(()=>validateRetainedJournal(f.journal,f.now),/RECEIPT_PREDATES_RETAINED_RESULT/);
  assert.equal(gradeRetainedGames(f.journal,{now:f.now}).available,false);
});

test('new review requires strictly newer native and community observations and recording time',async()=>{
  const f=reviewedBdlFixture();
  f.result.nativeFinalObservation.collectorRetrievedAt=f.result.verifiedAt;
  f.result.communityScoreObservation.collectorRetrievedAt=f.result.verifiedAt;
  const once=updateJournal(f.journal,[],[f.result],f.now).journal;
  const {validateRetainedJournal}=await import('../src/evidence-journal-feed.mjs');
  const {gradeRetainedGames}=await import('../src/game-grading.mjs');
  const {createHash}=await import('node:crypto');
  function next(){
    const r=structuredClone(f.result);r.revision++;r.homeScore=28;
    r.nativeFinalObservation.homeScore=28;r.communityScoreObservation.homeScore=28;
    r.resultHash=createHash('sha256').update(r.gameId+'|28|17').digest('hex').slice(0,24);
    r.verifiedAt=r.review.recordedAt='2026-11-09T18:06:00.000Z';
    r.nativeFinalObservation.collectorRetrievedAt='2026-11-09T18:04:00.000Z';
    r.communityScoreObservation.collectorRetrievedAt='2026-11-09T18:05:00.000Z';
    r.review.receiptSha256='b'.repeat(64);r.review.retainedResultSha256=reviewedResultDigest(f.result);return r;
  }
  for(const mutate of [
    r=>{r.nativeFinalObservation.collectorRetrievedAt=f.result.verifiedAt;},
    r=>{r.communityScoreObservation.collectorRetrievedAt=f.result.verifiedAt;},
    r=>{r.verifiedAt=r.review.recordedAt=f.result.verifiedAt;r.nativeFinalObservation.collectorRetrievedAt=f.result.verifiedAt;r.communityScoreObservation.collectorRetrievedAt=f.result.verifiedAt;},
  ]){
    const r=next();mutate(r);assert.equal(isReviewedBdlSettlement(r,f.snapshot),true);
    assert.throws(()=>updateJournal(once,[],[r],f.now),/BACKDATED_OR_REUSED_SOURCE_RECEIPT/);
    const direct=structuredClone(once);direct.settlements.push(r);
    assert.throws(()=>validateRetainedJournal(direct,f.now),/BACKDATED_OR_REUSED_SOURCE_RECEIPT/);
    assert.equal(gradeRetainedGames(direct,{now:f.now}).available,false);
  }
  const valid=updateJournal(once,[],[next()],f.now).journal;
  validateRetainedJournal(valid,f.now);assert.equal(valid.settlements.length,3);
  assert.equal(gradeRetainedGames(valid,{now:f.now}).games[0].status,'GRADED');
});
