// All game IDs, source bodies, receipt timestamps, scores and corrections are FABRICATED.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {syntheticBdlOutcomeInput,mutateSyntheticBdl,mutateSyntheticSchedule} from './fixtures/bdl-outcome-candidate.mjs';
import {BDL_RECEIPT_LEDGER_POLICY,emptyBdlReceiptLedger,appendBdlReceipt,validateBdlReceiptLedger,
  summarizeBdlReceiptLedger,assertBdlReceiptLedgerExtension,bdlReceiptDigest} from '../src/bdl-receipt-ledger.mjs';
import {BDL_CANDIDATE_POLICY} from '../src/bdl-outcome-candidate.mjs';
import {OUTCOME_SCORING_POLICY,isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {updateJournal,summarizeEvidence} from '../src/evidence.mjs';
const bytes=s=>new TextEncoder().encode(s);
const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
  const {journal,evaluatedAt,...input}=syntheticBdlOutcomeInput();
  return {journal,input:{...input,recordedAt:evaluatedAt},now:evaluatedAt};
}
function appended(x=fixture(),ledger=emptyBdlReceiptLedger(x.journal)){
  return {...x,...appendBdlReceipt(ledger,x.journal,x.input,{now:x.now})};
}
function later(x,minutes=10){
  const next=structuredClone(x);delete next.ledger;delete next.added;delete next.evidenceRevision;delete next.scoringEligible;
  for(const key of ['bdlRetrievedAt','nflverseRetrievedAt','recordedAt'])
    next.input[key]=new Date(Date.parse(x.input[key])+minutes*60000).toISOString();
  next.now=next.input.recordedAt;return next;
}
function correction(x){
  const next=later(x);
  mutateSyntheticBdl(next.input,e=>{e.home_team_score=14;e.updated_at='2026-11-09T18:10:00.000Z';});
  mutateSyntheticSchedule(next.input,s=>s.replace(',27,17,',',14,17,'));return next;
}
function rehash(entry){const {entrySha256,...body}=entry;entry.entrySha256=bdlReceiptDigest(body);}
const verify=(x,ledger=x.ledger)=>validateBdlReceiptLedger(ledger,x.journal,{now:x.now});

test('Private byte archive binds original bytes, policy, complete journal and first frozen snapshot',()=>{
  const x=fixture(),journalBefore=structuredClone(x.journal),inputBefore=structuredClone(x.input),empty=emptyBdlReceiptLedger(x.journal);
  const out=appended(x,empty),entry=out.ledger.entries[0];
  assert.equal(out.ledger.policy,BDL_RECEIPT_LEDGER_POLICY);assert.equal(out.ledger.candidatePolicy,BDL_CANDIDATE_POLICY);
  assert.equal(out.ledger.activation,'DISABLED');assert.equal(out.ledger.scoringPolicyUnchanged,OUTCOME_SCORING_POLICY);
  assert.equal(out.ledger.baseline.journalSha256,bdlReceiptDigest(x.journal));
  assert.equal(entry.target.firstFrozenSnapshotId,x.journal.snapshots[0].id);
  assert.equal(entry.target.firstFrozenSnapshotSha256,bdlReceiptDigest(x.journal.snapshots[0]));
  assert.equal(entry.receipt.mapping.status,'DECLARED_UNAUTHENTICATED');
  for(const [source,raw] of [['bdl',x.input.bdlBytes],['nflverse',x.input.nflverseBytes]]){
    const ref=entry.receipt[source],archive=out.ledger.archives.find(a=>a.sha256===ref.sha256);
    assert.equal(ref.sha256,sha(raw));assert.equal(archive.byteLength,raw.length);
    assert.deepEqual(new Uint8Array(Buffer.from(archive.bodyBase64,'base64')),raw);
  }
  assert.deepEqual(x.journal,journalBefore);assert.deepEqual(x.input,inputBefore);assert.deepEqual(empty.entries,[]);
  const validated=verify(out);validated.entries[0].candidate.homeScore=99;assert.equal(entry.candidate.homeScore,27);
  x.input.bdlBytes.fill(0);assert.equal(verify(out).entries[0].candidate.homeScore,27);
});
test('Replay and deterministic summary later in time do not manufacture a new current observation',()=>{
  const x=appended(),before=summarizeBdlReceiptLedger(x.ledger,x.journal,{now:x.now});
  const after=summarizeBdlReceiptLedger(x.ledger,x.journal,{now:'2027-01-01T00:00:00.000Z'});
  assert.deepEqual(after,before);assert.equal(before.archiveIntegrityReplayed,true);assert.equal(before.distinctReviewedGames,1);
  for(const key of ['scoringEligible','qualifiesForCurrentScoring','sourceAuthenticityVerified','nativeGameMappingAuthenticated',
    'sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified','sourceFreshnessVerified',
    'providerPublicationTimeVerified','timestampAuthorityVerified','completeHistoryVerified','sourceUseRightsEstablished',
    'externalArchiveWitnessVerified','publicRedistributionAuthorized'])assert.equal(before[key],false);
  assert.equal(before.qualifiedOutcomes,0);assert.doesNotMatch(JSON.stringify(before),/bodyBase64/);
});
test('Exact repeat is idempotent even with a later recording request; only a new receipt adds evidence',()=>{
  const first=appended(),before=structuredClone(first.ledger),repeat=structuredClone(first.input);
  repeat.recordedAt='2026-11-10T18:03:00.000Z';
  const retry=appendBdlReceipt(first.ledger,first.journal,repeat,{now:repeat.recordedAt});
  assert.equal(retry.added,false);assert.equal(retry.evidenceRevision,1);assert.deepEqual(retry.ledger,before);
  const second=appended(later(first),first.ledger);
  assert.equal(second.evidenceRevision,2);assert.equal(second.ledger.archives.length,2);
  assert.equal(second.ledger.entries[1].comparison.scoreRelation,'SAME_SCORE_NEW_RECEIPT');
  assert.deepEqual(second.ledger.entries[0],before.entries[0]);assert.deepEqual(first.ledger,before);
  assert.deepEqual(assertBdlReceiptLedgerExtension(first.ledger,second.ledger,first.journal,{now:second.now}),second.ledger);
});
test('A later matching score correction appends review-only evidence and preserves every prior byte and entry',()=>{
  const first=appended(),original=structuredClone(first.ledger),next=appended(correction(first),first.ledger);
  assert.equal(next.ledger.entries[1].comparison.scoreRelation,'SCORE_CORRECTION_REQUIRES_REVIEW');
  assert.equal(next.ledger.entries[1].candidate.homeScore,14);assert.equal(next.ledger.entries[1].candidate.outcome,'AWAY');
  assert.deepEqual(next.ledger.entries[0],original.entries[0]);assert.deepEqual(next.ledger.archives.slice(0,2),original.archives);
  assert.equal(next.ledger.archives.length,4);assert.equal(first.journal.settlements.length,0);
  const summary=summarizeBdlReceiptLedger(next.ledger,next.journal,{now:next.now});
  assert.equal(summary.rows[0].correctionEvidenceRevisions,1);assert.equal(summary.qualifiedOutcomes,0);
  assert.equal(summary.rows[0].homeScore,14);verify(next);
});
test('Repeated same score after correction cannot erase correction history or resurrect original score',()=>{
  const first=appended(),second=appended(correction(first),first.ledger),third=appended(later(second),second.ledger);
  const report=summarizeBdlReceiptLedger(third.ledger,third.journal,{now:third.now});
  assert.equal(report.rows[0].scoreRelation,'SAME_SCORE_NEW_RECEIPT');assert.equal(report.rows[0].correctionEvidenceRevisions,1);
  assert.equal(report.rows[0].homeScore,14);assert.equal(report.rows[0].evidenceRevision,3);
});
test('Raw retained results are linked, never revised or overwritten when supplied sources disagree',()=>{
  const x=fixture();x.journal.settlements.push({gameId:x.input.gameId,gameDate:'2026-11-08',homeScore:24,awayScore:17,
    outcome:'HOME',revision:1,source:'NFLVERSE_SCHEDULES',verifiedAt:'2026-11-09T18:00:00.000Z'});
  const before=structuredClone(x.journal),out=appended(x);
  assert.equal(out.ledger.entries[0].target.retainedResultSha256,bdlReceiptDigest(x.journal.settlements[0]));
  assert.equal(out.ledger.entries[0].comparison.retainedResultRelation,'DIFFERS_FROM_RETAINED_SCORE_REQUIRES_REVIEW');
  assert.deepEqual(x.journal,before);assert.equal(summarizeEvidence(x.journal,Date.parse(x.now)).sourceCorroboratedSettledGames,0);
});
test('Receipts cannot predate an existing result in their frozen baseline',()=>{
  const x=fixture();x.journal.settlements.push({gameId:x.input.gameId,gameDate:'2026-11-08',homeScore:27,awayScore:17,
    outcome:'HOME',revision:1,source:'NFLVERSE_SCHEDULES',verifiedAt:'2026-11-09T18:02:00.000Z'});
  assert.throws(()=>appended(x),/RECEIPT_PREDATES_RETAINED_RESULT/);
});
test('Current V2 scorer and journal writer reject both new receipt entries and candidates',()=>{
  const x=appended(),entry=x.ledger.entries[0];
  for(const value of [entry,entry.candidate]){
    const record={...value,revision:1,verifiedAt:x.now};
    assert.equal(isSourceCorroboratedSettlement(record,x.journal.snapshots[0]),false);
    assert.throws(()=>updateJournal(x.journal,[],[record],Date.parse(x.now)));
  }
  assert.equal(summarizeEvidence({...x.journal,settlements:[{...entry.candidate,revision:1,verifiedAt:x.now}]},Date.parse(x.now)).sourceCorroboratedSettledGames,0);
});
for(const [name,mutate] of Object.entries({
  changedByte:l=>{const a=l.archives[0];a.bodyBase64=Buffer.from('x'.repeat(a.byteLength)).toString('base64');},
  truncatedBody:l=>l.archives[0].bodyBase64=l.archives[0].bodyBase64.slice(0,-4),
  wrongLength:l=>l.archives[0].byteLength++,missingArchive:l=>l.archives.pop(),
  extraArchive:l=>l.archives.push({sha256:sha(bytes('unused')),byteLength:6,encoding:'base64',bodyBase64:Buffer.from('unused').toString('base64')}),
  duplicateArchive:l=>l.archives.push(structuredClone(l.archives[0])),
  malformedEncoding:l=>l.archives[0].encoding='utf8',noncanonicalBase64:l=>l.archives[0].bodyBase64=' '+l.archives[0].bodyBase64.slice(1),
  wrongPolicy:l=>l.policy='ENABLED',unknownTop:l=>l.enabled=true,unknownArchive:l=>l.archives[0].secret='NEVER_ECHO',
  unknownEntry:l=>l.entries[0].extra=true,wrongRevision:l=>{l.entries[0].evidenceRevision=4;rehash(l.entries[0]);},
  wrongSequence:l=>{l.entries[0].sequence=4;rehash(l.entries[0]);},
  enabledFlag:l=>{l.entries[0].flags.scoringEligible=true;rehash(l.entries[0]);},
  changedTarget:l=>{l.entries[0].target.firstFrozenSnapshotId='changed';rehash(l.entries[0]);},
  changedCandidate:l=>{l.entries[0].candidate.homeScore=99;rehash(l.entries[0]);},
  fakeComparison:l=>{l.entries[0].comparison.scoreRelation='OFFICIAL';rehash(l.entries[0]);},
  relabeledSource:l=>{l.entries[0].candidate.nativeFinalObservation.source='ESPN_SITE_SCOREBOARD_UNOFFICIAL';rehash(l.entries[0]);},
  relabeledArchive:l=>{l.entries[0].receipt.bdl.source='NFLVERSE_SCHEDULES';const e=l.entries[0];e.receiptSha256=bdlReceiptDigest({target:e.target,receipt:e.receipt});rehash(e);}
}))test('Full replay rejects tampering: '+name,()=>{
  const x=appended(),tampered=structuredClone(x.ledger);mutate(tampered);assert.throws(()=>verify(x,tampered));
});
test('Rehashing a changed source receipt cannot evade policy replay, even if archive hash and chain match',()=>{
  const x=appended(),bad=structuredClone(x.ledger),entry=bad.entries[0],archive=bad.archives[0];
  const payload=JSON.parse(Buffer.from(archive.bodyBase64,'base64'));payload.data.home_team_score=99;
  const raw=bytes(JSON.stringify(payload));archive.bodyBase64=Buffer.from(raw).toString('base64');archive.byteLength=raw.length;archive.sha256=sha(raw);
  entry.receipt.bdl.sha256=archive.sha256;entry.receipt.bdl.byteLength=archive.byteLength;
  entry.receiptSha256=bdlReceiptDigest({target:entry.target,receipt:entry.receipt});rehash(entry);
  assert.throws(()=>verify(x,bad),/CANDIDATE_FINAL_SCORE_MISMATCH/);
});
test('Truncation detection requires retained prior history; it is not an external signature',()=>{
  const first=appended(),second=appended(later(first),first.ledger),truncated=structuredClone(second.ledger);
  truncated.entries.pop();assert.doesNotThrow(()=>validateBdlReceiptLedger(truncated,first.journal,{now:second.now}));
  assert.throws(()=>assertBdlReceiptLedgerExtension(second.ledger,truncated,first.journal,{now:second.now}),/RECEIPT_HISTORY_CHANGED/);
  assert.throws(()=>assertBdlReceiptLedgerExtension(first.ledger,emptyBdlReceiptLedger(first.journal),first.journal,{now:second.now}),/RECEIPT_HISTORY_CHANGED/);
});
test('A fully self-consistent forged rewrite still fails comparison with separately retained prior history',()=>{
  const x=appended(),changed=fixture();mutateSyntheticBdl(changed.input,e=>e.home_team_score=26);
  mutateSyntheticSchedule(changed.input,s=>s.replace(',27,17,',',26,17,'));const forged=appended(changed);
  verify(forged);assert.throws(()=>assertBdlReceiptLedgerExtension(x.ledger,forged.ledger,x.journal,{now:x.now}),/RECEIPT_HISTORY_CHANGED/);
});
for(const [name,mutate] of Object.entries({
  probability:j=>j.snapshots[0].modelHomeProbability=.7,
  header:j=>j.provenance.description='CHANGED',
  addition:j=>j.snapshots.push({...j.snapshots[0],id:'later-frozen-snapshot'}),
  deletion:j=>j.snapshots.pop(),
  result:j=>j.settlements.push({gameId:j.snapshots[0].gameId,homeScore:14,awayScore:17,outcome:'AWAY',revision:1,verifiedAt:'2026-11-09T18:00:00.000Z'})
}))test('Exact baseline rejects changed journal: '+name,()=>{
  const x=appended(),journal=structuredClone(x.journal);mutate(journal);
  assert.throws(()=>validateBdlReceiptLedger(x.ledger,journal,{now:x.now}),/BASELINE_CHANGED/);verify(x);
});
test('Frozen snapshot linkage selects the earliest capture deterministically, never best forecast',()=>{
  const x=fixture(),first=structuredClone(x.journal.snapshots[0]),newer={...first,id:'newer',capturedAt:'2026-11-07T12:01:00.000Z'};
  x.journal.snapshots=[newer,first];const out=appended(x);assert.equal(out.ledger.entries[0].target.firstFrozenSnapshotId,first.id);
});
for(const [name,mutate] of Object.entries({
  oldAppend:x=>x.now='2026-11-09T18:04:00.001Z',futureAppend:x=>x.now='2026-11-09T18:02:59.999Z',
  staleBdl:x=>x.input.bdlRetrievedAt='2026-11-09T17:02:59.999Z',
  futureNfl:x=>x.input.nflverseRetrievedAt='2026-11-09T18:03:00.001Z',
  beforeFloor:x=>x.input.bdlRetrievedAt='2026-11-09T17:59:59.999Z',
  noncanonical:x=>x.input.recordedAt='2026-11-09T18:03:00Z',unknownInput:x=>x.input.enabled=true
}))test('Reject stale, future, premature or malformed append: '+name,()=>{const x=fixture();mutate(x);assert.throws(()=>appended(x));});
test('Append currentness accepts the exact 60-second boundary and never future data',()=>{
  const x=fixture();x.now='2026-11-09T18:04:00.000Z';const out=appended(x);verify(out);
  assert.throws(()=>validateBdlReceiptLedger(out.ledger,out.journal,{now:'2026-11-09T18:02:59.999Z'}),/FUTURE_LEDGER_ENTRY/);
  assert.throws(()=>validateBdlReceiptLedger(out.ledger,out.journal,{now:'2026-11-07T11:59:00.000Z'}),/INVALID_FROZEN_JOURNAL/);
});
test('Revisions cannot reuse one source receipt, backdate behind prior recording, or alter data at same receipt times',()=>{
  const first=appended();
  for(const key of ['bdlRetrievedAt','nflverseRetrievedAt']){
    const x=later(first);x.input[key]=first.input[key];assert.throws(()=>appended(x,first.ledger),/BACKDATED_OR_REUSED_SOURCE_RECEIPT/);
    x.input[key]='2026-11-09T18:02:30.000Z';assert.throws(()=>appended(x,first.ledger),/BACKDATED_OR_REUSED_SOURCE_RECEIPT/);
  }
  const altered=structuredClone(first);mutateSyntheticBdl(altered.input,e=>e.extra='new bytes same retrieval');
  assert.throws(()=>appended(altered,first.ledger),/BACKDATED_OR_REUSED_SOURCE_RECEIPT/);
});
test('Corrections require later native record time; regressed record or native identity changes require review',()=>{
  const first=appended();
  const sameUpdate=correction(first);mutateSyntheticBdl(sameUpdate.input,e=>e.updated_at='2026-11-08T22:00:00.000Z');
  assert.throws(()=>appended(sameUpdate,first.ledger),/CORRECTION_RECORD_TIME_NOT_ADVANCED/);
  const regressed=later(first);mutateSyntheticBdl(regressed.input,e=>e.updated_at='2026-11-08T21:00:00.000Z');
  assert.throws(()=>appended(regressed,first.ledger),/PROVIDER_RECORD_TIME_REGRESSED/);
  const changedTeam=later(first);mutateSyntheticBdl(changedTeam.input,e=>e.home_team.id+=10);
  assert.throws(()=>appended(changedTeam,first.ledger),/NATIVE_TEAM_MAPPING_CHANGED/);
  const changedId=later(first);changedId.input.expectedProviderGameId++;mutateSyntheticBdl(changedId.input,e=>e.id++);
  assert.throws(()=>appended(changedId,first.ledger),/DECLARED_NATIVE_MAPPING_CHANGED_OR_REUSED/);
});
test('Narrow kickoff conflicts quarantine entire game, preserve both kickoffs and leave unrelated games reviewable',()=>{
  const x=fixture(),base=x.journal.snapshots[0];
  x.journal.snapshots.push({...base,id:'q1',gameId:'2026_10_BUF_BAL',home:'BAL',away:'BUF',providerEventId:'other-provider'},
    {...base,id:'q2',gameId:'2026_10_BUF_BAL',home:'BAL',away:'BUF',providerEventId:'other-provider',commenceTime:'2026-11-08T18:20:00.000Z'});
  const out=appended(x),report=summarizeBdlReceiptLedger(out.ledger,x.journal,{now:x.now});
  assert.equal(report.quarantine.excludedGameCount,1);assert.equal(report.quarantine.excludedSnapshotCount,2);
  assert.deepEqual(report.quarantine.games[0].observedCommenceTimes,['2026-11-08T18:00:00.000Z','2026-11-08T18:20:00.000Z']);
  assert.throws(()=>appendBdlReceipt(out.ledger,x.journal,{...x.input,gameId:'2026_10_BUF_BAL'},{now:x.now}),/FROZEN_SCHEDULE_QUARANTINED/);
});
test('Target kickoff conflict blocks; later conflict cannot mutate baseline or invalidate replay against original journal',()=>{
  const x=appended(),changed=structuredClone(x.journal);
  changed.snapshots.push({...changed.snapshots[0],id:'conflict',commenceTime:'2026-11-08T18:20:00.000Z'});
  const quarantined=emptyBdlReceiptLedger(changed);
  assert.throws(()=>appendBdlReceipt(quarantined,changed,x.input,{now:x.now}),/FROZEN_SCHEDULE_QUARANTINED/);
  assert.throws(()=>validateBdlReceiptLedger(x.ledger,changed,{now:x.now}),/FROZEN_JOURNAL_BASELINE_CHANGED/);verify(x);
});
test('Non-schedule corruption and changed/reused/missing provider identity never get narrow quarantine exemption',()=>{
  for(const change of [s=>s.home='BUF',s=>s.providerEventId='changed',s=>delete s.providerEventId]){
    const x=fixture(),other={...x.journal.snapshots[0],id:'bad',commenceTime:'2026-11-08T18:20:00.000Z'};change(other);
    x.journal.snapshots.push(other);assert.throws(()=>appended(x),/INVALID_FROZEN_JOURNAL/);
  }
  const x=fixture();delete x.journal.snapshots[0].providerEventId;
  assert.throws(()=>appended(x),/FROZEN_PROVIDER_IDENTITY_REQUIRES_REVIEW/);
});
test('Unknown source text remains exact private archive content, is not echoed in reports or errors',()=>{
  const x=fixture();mutateSyntheticBdl(x.input,(e,p)=>{p.debug='PRIVATE_UNTRUSTED_SOURCE';e.token='NOT_A_REAL_SECRET';});
  const out=appended(x),report=summarizeBdlReceiptLedger(out.ledger,out.journal,{now:out.now});
  assert.match(Buffer.from(out.ledger.archives[0].bodyBase64,'base64').toString(),/PRIVATE_UNTRUSTED_SOURCE/);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_UNTRUSTED_SOURCE|NOT_A_REAL_SECRET|token/);
  const bad=fixture();bad.input.bdlBytes=bytes('PRIVATE_UNTRUSTED_SOURCE');
  assert.throws(()=>appended(bad),error=>!error.message.includes('PRIVATE_UNTRUSTED_SOURCE')&&error.code==='CANDIDATE_INVALID_PROVIDER_JSON');
});
test('Malformed, oversized and invalid UTF8 sources fail closed without network or body disclosure',()=>{
  for(const raw of [new Uint8Array(),new Uint8Array(262145),new Uint8Array([255]),bytes('{"data":1}')]){
    const x=fixture();x.input.bdlBytes=raw;assert.throws(()=>appended(x));
  }
  const x=fixture();x.input.nflverseBytes=new Uint8Array(4000001);assert.throws(()=>appended(x),/INVALID_SOURCE_BYTES/);
});
test('Plain finite bounded data is required; accessors, sparse arrays, symbols and unknown options reject',()=>{
  for(const bad of [undefined,NaN,Infinity,()=>1,new Date(),Object.assign([], {x:1}),Array(2),{x:undefined}, {[Symbol('x')]:1}])
    assert.throws(()=>bdlReceiptDigest(bad));
  let accessed=false;const getter={get x(){accessed=true;return 1;}};assert.throws(()=>bdlReceiptDigest(getter));assert.equal(accessed,false);
  const x=appended();for(const now of [null,undefined,NaN,Infinity,-1,1.5])assert.throws(()=>validateBdlReceiptLedger(x.ledger,x.journal,{now}));
  assert.throws(()=>validateBdlReceiptLedger(x.ledger,x.journal,{now:x.now,enable:true}));
  let nested={};for(let i=0;i<34;i++)nested={nested};assert.throws(()=>bdlReceiptDigest(nested),/RECORD_COMPLEXITY_LIMIT/);
});
test('Source module is pure, remains absent from production consumers, and is independent of global fetch',async()=>{
  const source=await readFile(new URL('../src/bdl-receipt-ledger.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|process\.|Date\.now\(|node:fs|node:https?|node:net|readFile|writeFile/);
  for(const path of ['../src/server.mjs','../scripts/capture-evidence.mjs'])
    assert.doesNotMatch(await readFile(new URL(path,import.meta.url),'utf8'),/bdl-receipt-ledger/);
  const prior=globalThis.fetch;globalThis.fetch=()=>{throw Error('NETWORK_PROHIBITED');};
  try{verify(appended());}finally{globalThis.fetch=prior;}
});

function twoGameInputs({home='BUF',away='DEN',homeId=99903,awayId=99904,nativeGameId=9999002}={}){
  const first=fixture(),gameId=`2026_10_${away}_${home}`;
  first.journal.snapshots.push({...first.journal.snapshots[0],id:'second-game',gameId,home,away,providerEventId:'synthetic-provider-second'});
  const initial=appended(first),second=later(first);
  second.input.gameId=gameId;second.input.expectedProviderGameId=nativeGameId;
  mutateSyntheticBdl(second.input,e=>{e.id=nativeGameId;e.home_team={id:homeId,abbreviation:home};e.visitor_team={id:awayId,abbreviation:away};});
  mutateSyntheticSchedule(second.input,s=>s.replace('2026_10_LV_KC',gameId).replace(',KC,LV,',`,${home},${away},`));
  return {initial,second};
}
test('Native team IDs must map one-to-one to canonical teams across different games and sides',()=>{
  for(const options of [{homeId:99901,awayId:99902},{homeId:99902},{awayId:99901},
    {home:'LV',homeId:99903},{away:'KC',awayId:99904}]){
    const {initial,second}=twoGameInputs(options);
    assert.throws(()=>appended(second,initial.ledger),/GLOBAL_NATIVE_TEAM_MAPPING_CONFLICT/);
  }
  const {initial,second}=twoGameInputs({home:'LV',homeId:99902,away:'BUF',awayId:99903});
  const next=appended(second,initial.ledger);verify(next);
  assert.equal(summarizeBdlReceiptLedger(next.ledger,next.journal,{now:next.now}).distinctReviewedGames,2);
});
test('Native game ID cannot be reused for a different frozen game',()=>{
  const {initial,second}=twoGameInputs({nativeGameId:9999001});
  assert.throws(()=>appended(second,initial.ledger),/DECLARED_NATIVE_MAPPING_CHANGED_OR_REUSED/);
});

test('Custom-prototype arrays and source-byte accessors reject without executing caller code',()=>{
  let executed=false;const array=Object.setPrototypeOf([],Object.create(Array.prototype,{[Symbol.iterator]:{value(){executed=true;return [][Symbol.iterator]();}}}));
  assert.throws(()=>bdlReceiptDigest(array),/INVALID_RECORD_ARRAY/);assert.equal(executed,false);
  const x=fixture();Object.defineProperty(x.input.bdlBytes,'valueOf',{get(){executed=true;throw Error('EXECUTED');}});
  assert.throws(()=>appended(x),/INVALID_SOURCE_BYTES/);assert.equal(executed,false);
  const y=fixture();Object.defineProperty(y.input.bdlBytes,'byteLength',{get(){executed=true;throw Error('EXECUTED');}});
  assert.throws(()=>appended(y),/INVALID_SOURCE_BYTES/);assert.equal(executed,false);
});


test('Only NFLverse source allowance rises to four MB; BDL allowance stays bounded',()=>{
  const x=fixture(),original=Buffer.from(x.input.nflverseBytes).toString('utf8');
  x.input.nflverseBytes=bytes(original.replace(/\n$/,'A'.repeat(4000000-Buffer.byteLength(original))+'\n'));
  assert.equal(x.input.nflverseBytes.length,4000000);
  const out=appended(x);verify(out);
  assert.equal(out.ledger.entries[0].receipt.nflverse.byteLength,4000000);
  const y=fixture();y.input.nflverseBytes=new Uint8Array(4000001);
  assert.throws(()=>appended(y),/INVALID_SOURCE_BYTES/);
  const z=fixture();z.input.bdlBytes=new Uint8Array(262145);
  assert.throws(()=>appended(z),/INVALID_SOURCE_BYTES/);
});
