/**
 * PRIVATE, local-only source-byte archive and disabled evidence ledger.
 * Supplied byte integrity is not source authenticity, a trusted observation clock,
 * upstream independence, retention permission, or settlement qualification.
 * No transport, storage, environment access, or production consumer lives here.
 */
import {createHash} from 'node:crypto';
import {assessBdlOutcomeCandidate,BDL_CANDIDATE_POLICY} from './bdl-outcome-candidate.mjs';
import {validateJournal} from './evidence.mjs';
import {canonicalTimestamp,providerContinuityConflicts} from './evidence-integrity.mjs';
import {validateRetainedIdentityState,scheduleQuarantineMetadata} from './retained-schedule-quarantine.mjs';
import {OUTCOME_SCORING_POLICY} from './settlement-qualification.mjs';

export const BDL_RECEIPT_LEDGER_POLICY='BDL_SUPPLIED_SOURCE_BYTE_RECEIPTS_V1_DISABLED';
const MAX_ENTRIES=1000,MAX_ARCHIVE_BYTES=8000000,MAX_CANONICAL_CHARS=16000000;
const ARCHIVE_MEANING='SUPPLIED_BYTES_INTEGRITY_AND_REPLAY_ONLY';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const time=value=>{const at=canonicalTimestamp(value);if(!Number.isFinite(at))fail('CANONICAL_UTC_REQUIRED');return at;};
const nowOf=options=>{
  exact(options,['now']);
  const now=typeof options.now==='string'?time(options.now):options.now;
  if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)fail('INVALID_CALLER_CLOCK');return now;
};
function keysOf(value){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)fail('PLAIN_RECORD_REQUIRED');
  const keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'||!Object.getOwnPropertyDescriptor(value,key)?.enumerable||
    !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value')))fail('PLAIN_RECORD_REQUIRED');
  return keys;
}
function exact(value,keys){
  if(keysOf(value).sort().join('|')!==[...keys].sort().join('|'))fail('UNEXPECTED_OR_MISSING_FIELDS');
}
/** Deterministic JSON-data digest. Never a signature or external witness. */
export function bdlReceiptDigest(value){
  let nodes=0,chars=0;
  const bounded=s=>{chars+=Buffer.byteLength(s);if(chars>MAX_CANONICAL_CHARS)fail('RECORD_SIZE_LIMIT');return s;};
  const canonical=(v,depth=0)=>{
    if(++nodes>250000||depth>32)fail('RECORD_COMPLEXITY_LIMIT');
    if(v===null||typeof v==='boolean')return bounded(JSON.stringify(v));
    if(typeof v==='string'){if(v.length>MAX_CANONICAL_CHARS)fail('RECORD_SIZE_LIMIT');return bounded(JSON.stringify(v));}
    if(typeof v==='number'&&Number.isFinite(v))return bounded(JSON.stringify(v));
    if(Array.isArray(v)){
      if(Object.getPrototypeOf(v)!==Array.prototype||v.length>25000||Reflect.ownKeys(v).length!==v.length+1)fail('INVALID_RECORD_ARRAY');
      const items=[];
      for(let i=0;i<v.length;i++){
        const descriptor=Object.getOwnPropertyDescriptor(v,String(i));
        if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))fail('INVALID_RECORD_ARRAY');
        items.push(canonical(descriptor.value,depth+1));
      }
      bounded('['+','.repeat(Math.max(0,v.length-1))+']');return '['+items.join(',')+']';
    }
    const keys=keysOf(v).sort();
    bounded('{'+','.repeat(Math.max(0,keys.length-1))+'}');
    return '{'+keys.map(key=>bounded(JSON.stringify(key)+':')+canonical(v[key],depth+1)).join(',')+'}';
  };
  return sha(canonical(value));
}
const same=(a,b)=>bdlReceiptDigest(a)===bdlReceiptDigest(b);
const flags=()=>({researchOnly:true,scoringEligible:false,qualifiesForCurrentScoring:false,qualifiedOutcomes:0,
  sourceAuthenticityVerified:false,nativeGameMappingAuthenticated:false,sourceIndependenceVerified:false,
  officialLeagueCertification:false,historicalAsOfVerified:false,sourceFreshnessVerified:false,
  providerPublicationTimeVerified:false,timestampAuthorityVerified:false,externalArchiveWitnessVerified:false,
  completeHistoryVerified:false,sourceUseRightsEstablished:false,publicRedistributionAuthorized:false});
function journalState(journal,now){
  bdlReceiptDigest(journal);
  try{validateJournal(journal);return validateRetainedIdentityState(journal,now);}
  catch{fail('INVALID_FROZEN_JOURNAL');}
}
function baselineFor(journal,state){
  return {journalSha256:bdlReceiptDigest(journal),snapshotCount:journal.snapshots.length,
    settlementCount:journal.settlements.length,quarantine:scheduleQuarantineMetadata(journal,state.schedules)};
}
/** Binds the entire original journal, including quarantined records, without copying it. */
export function emptyBdlReceiptLedger(journal){
  const state=journalState(journal,Number.MAX_SAFE_INTEGER),baseline=baselineFor(journal,state);
  return {schema:1,policy:BDL_RECEIPT_LEDGER_POLICY,candidatePolicy:BDL_CANDIDATE_POLICY,activation:'DISABLED',
    scoringPolicyUnchanged:OUTCOME_SCORING_POLICY,archiveMeaning:ARCHIVE_MEANING,flags:flags(),baseline,
    baselineSha256:bdlReceiptDigest(baseline),archives:[],entries:[]};
}
function targetFor(journal,state,gameId){
  if(typeof gameId!=='string'||!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(gameId))fail('INVALID_TARGET_ID');
  if(state.schedules.blocked.has(gameId))fail('FROZEN_SCHEDULE_QUARANTINED');
  if(providerContinuityConflicts(journal.snapshots).has(gameId))fail('FROZEN_PROVIDER_IDENTITY_REQUIRES_REVIEW');
  const snapshots=journal.snapshots.filter(s=>s.gameId===gameId)
    .sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0));
  if(!snapshots.length)fail('MISSING_FROZEN_GAME');
  const first=snapshots[0],retained=state.latest.get(gameId);
  return {gameId,frozenIdentity:Object.fromEntries(['gameId','season','gameDate','home','away','commenceTime'].map(k=>[k,first[k]])),
    firstFrozenSnapshotId:first.id,firstFrozenSnapshotSha256:bdlReceiptDigest(first),
    allFrozenSnapshotsSha256:bdlReceiptDigest(snapshots),retainedResultSha256:retained?bdlReceiptDigest(retained):null,
    retainedResultVerifiedAt:retained?.verifiedAt??null};
}
function archiveMap(archives){
  if(!Array.isArray(archives)||archives.length>MAX_ENTRIES*2)fail('INVALID_ARCHIVES');
  let total=0;const map=new Map();
  for(const archive of archives){
    exact(archive,['sha256','byteLength','encoding','bodyBase64']);
    if(!digest(archive.sha256)||!Number.isSafeInteger(archive.byteLength)||archive.byteLength<1||
      archive.byteLength>4000000||archive.encoding!=='base64'||typeof archive.bodyBase64!=='string'||
      archive.bodyBase64.length!==4*Math.ceil(archive.byteLength/3))fail('INVALID_ARCHIVE');
    total+=archive.byteLength;if(total>MAX_ARCHIVE_BYTES)fail('ARCHIVE_BYTES_LIMIT');
    const bytes=Buffer.from(archive.bodyBase64,'base64');
    if(bytes.length!==archive.byteLength||bytes.toString('base64')!==archive.bodyBase64||sha(bytes)!==archive.sha256)
      fail('ARCHIVE_CONTENT_MISMATCH');
    if(map.has(archive.sha256))fail('DUPLICATE_ARCHIVE');map.set(archive.sha256,bytes);
  }
  return map;
}
function sourceBytes(receipt,source,max,map,used){
  exact(receipt,['source','sha256','byteLength','retrievedAt']);time(receipt.retrievedAt);
  const bytes=map.get(receipt.sha256);
  if(receipt.source!==source||!digest(receipt.sha256)||!bytes||receipt.byteLength!==bytes.length||bytes.length>max)
    fail('SOURCE_ARCHIVE_BINDING_MISMATCH');
  used.add(receipt.sha256);return bytes;
}
function assess(journal,receipt,recordedAt,map,used){
  exact(receipt,['mapping','bdl','nflverse']);
  exact(receipt.mapping,['gameId','expectedProviderGameId','status']);
  if(receipt.mapping.status!=='DECLARED_UNAUTHENTICATED'||!Number.isSafeInteger(receipt.mapping.expectedProviderGameId)||
    receipt.mapping.expectedProviderGameId<=0)fail('INVALID_DECLARED_NATIVE_MAPPING');
  const bdlBytes=sourceBytes(receipt.bdl,'BALLDONTLIE_NFL_GAMES',262144,map,used);
  const nflverseBytes=sourceBytes(receipt.nflverse,'NFLVERSE_SCHEDULES',4000000,map,used);
  const assessment=assessBdlOutcomeCandidate({journal,gameId:receipt.mapping.gameId,
    expectedProviderGameId:receipt.mapping.expectedProviderGameId,bdlBytes,nflverseBytes,
    bdlRetrievedAt:receipt.bdl.retrievedAt,nflverseRetrievedAt:receipt.nflverse.retrievedAt,evaluatedAt:recordedAt});
  if(assessment.status!=='MATCHED_NONQUALIFYING_CANDIDATE')fail('CANDIDATE_'+assessment.reason);
  return assessment.candidate;
}
const scoreEqual=(a,b)=>a.homeScore===b.homeScore&&a.awayScore===b.awayScore;
function comparisonFor(candidate,prior,retained){
  return {priorEvidenceEntrySha256:prior?.entrySha256??null,
    scoreRelation:!prior?'INITIAL_OBSERVATION':scoreEqual(candidate,prior.candidate)?'SAME_SCORE_NEW_RECEIPT':'SCORE_CORRECTION_REQUIRES_REVIEW',
    retainedResultRelation:!retained?'NO_RETAINED_RESULT':scoreEqual(candidate,retained)?'MATCHES_RETAINED_SCORE':'DIFFERS_FROM_RETAINED_SCORE_REQUIRES_REVIEW'};
}
function revisionTimes(receipt,recordedAt,target,prior){
  const recorded=time(recordedAt),times=[time(receipt.bdl.retrievedAt),time(receipt.nflverse.retrievedAt)];
  if(target.retainedResultVerifiedAt!==null&&times.some(at=>at<time(target.retainedResultVerifiedAt)))fail('RECEIPT_PREDATES_RETAINED_RESULT');
  if(prior&&(recorded<=time(prior.recordedAt)||times.some(at=>at<time(prior.recordedAt))||
    times[0]<=time(prior.receipt.bdl.retrievedAt)||times[1]<=time(prior.receipt.nflverse.retrievedAt)))fail('BACKDATED_OR_REUSED_SOURCE_RECEIPT');
}
const bodyOf=entry=>{const {entrySha256,...body}=entry;return body;};
function replay(ledger,journal,now){
  // Check the bounded data shape before traversing caller-owned objects.
  bdlReceiptDigest(ledger);
  exact(ledger,['schema','policy','candidatePolicy','activation','scoringPolicyUnchanged','archiveMeaning','flags','baseline','baselineSha256','archives','entries']);
  if(ledger.schema!==1||ledger.policy!==BDL_RECEIPT_LEDGER_POLICY||ledger.candidatePolicy!==BDL_CANDIDATE_POLICY||
    ledger.activation!=='DISABLED'||ledger.scoringPolicyUnchanged!==OUTCOME_SCORING_POLICY||ledger.archiveMeaning!==ARCHIVE_MEANING||
    !same(ledger.flags,flags())||!Array.isArray(ledger.entries)||ledger.entries.length>MAX_ENTRIES)fail('INVALID_LEDGER');
  const state=journalState(journal,now),baseline=baselineFor(journal,state);
  if(!same(ledger.baseline,baseline)||!digest(ledger.baselineSha256)||ledger.baselineSha256!==bdlReceiptDigest(baseline))fail('FROZEN_JOURNAL_BASELINE_CHANGED');
  const map=archiveMap(ledger.archives),used=new Set(),receipts=new Set(),games=new Map(),nativeIds=new Map(),nativeTeams=new Map(),canonicalTeams=new Map();
  let previous=null;
  for(let i=0;i<ledger.entries.length;i++){
    const entry=ledger.entries[i];
    exact(entry,['baselineSha256','sequence','evidenceRevision','previousEntrySha256','previousGameEntrySha256','recordedAt','target','receipt','receiptSha256','candidate','comparison','flags','entrySha256']);
    const recorded=time(entry.recordedAt);
    if(recorded>now)fail('FUTURE_LEDGER_ENTRY');
    if(entry.baselineSha256!==ledger.baselineSha256||entry.sequence!==i+1||
      entry.previousEntrySha256!==(previous?.entrySha256??null)||(previous&&recorded<time(previous.recordedAt))||
      !digest(entry.entrySha256)||entry.entrySha256!==bdlReceiptDigest(bodyOf(entry))||!same(entry.flags,flags()))fail('INVALID_RECEIPT_CHAIN');
    const target=targetFor(journal,state,entry.target?.gameId);
    if(!same(entry.target,target)||entry.receipt?.mapping?.gameId!==target.gameId)fail('FROZEN_RECEIPT_TARGET_CHANGED');
    const prior=games.get(target.gameId);
    if(entry.evidenceRevision!==(prior?.evidenceRevision??0)+1||entry.previousGameEntrySha256!==(prior?.entrySha256??null))fail('INVALID_EVIDENCE_REVISION');
    if(entry.receiptSha256!==bdlReceiptDigest({target,receipt:entry.receipt}))fail('RECEIPT_DIGEST_MISMATCH');
    if(receipts.has(entry.receiptSha256))fail('DUPLICATE_EVIDENCE_RECEIPT');receipts.add(entry.receiptSha256);
    const candidate=assess(journal,entry.receipt,entry.recordedAt,map,used);
    if(!same(entry.candidate,candidate))fail('CANDIDATE_REPLAY_MISMATCH');
    const native=entry.receipt.mapping.expectedProviderGameId,existingGame=nativeIds.get(native);
    if((existingGame&&existingGame!==target.gameId)||(prior&&prior.receipt.mapping.expectedProviderGameId!==native))fail('DECLARED_NATIVE_MAPPING_CHANGED_OR_REUSED');
    nativeIds.set(native,target.gameId);
    if(prior){
      const current=candidate.nativeFinalObservation,old=prior.candidate.nativeFinalObservation;
      if(current.providerHomeTeamId!==old.providerHomeTeamId||current.providerAwayTeamId!==old.providerAwayTeamId)
        fail('NATIVE_TEAM_MAPPING_CHANGED');
      if(time(current.providerRecordUpdatedAt)<time(old.providerRecordUpdatedAt))fail('PROVIDER_RECORD_TIME_REGRESSED');
      if(!scoreEqual(candidate,prior.candidate)&&time(current.providerRecordUpdatedAt)<=time(old.providerRecordUpdatedAt))
        fail('CORRECTION_RECORD_TIME_NOT_ADVANCED');
    }
    const nativeObservation=candidate.nativeFinalObservation;
    for(const [code,nativeTeamId] of [[nativeObservation.home,nativeObservation.providerHomeTeamId],
      [nativeObservation.away,nativeObservation.providerAwayTeamId]]){
      if((nativeTeams.has(nativeTeamId)&&nativeTeams.get(nativeTeamId)!==code)||
        (canonicalTeams.has(code)&&canonicalTeams.get(code)!==nativeTeamId))fail('GLOBAL_NATIVE_TEAM_MAPPING_CONFLICT');
      nativeTeams.set(nativeTeamId,code);canonicalTeams.set(code,nativeTeamId);
    }
    revisionTimes(entry.receipt,entry.recordedAt,target,prior);
    if(!same(entry.comparison,comparisonFor(candidate,prior,state.latest.get(target.gameId))))fail('SCORE_COMPARISON_MISMATCH');
    games.set(target.gameId,entry);previous=entry;
  }
  if(used.size!==map.size)fail('UNREFERENCED_ARCHIVE');
  return {state,games,map};
}
/** Full historical replay uses each original recording time; age never invents a new observation. */
export function validateBdlReceiptLedger(ledger,journal,options){
  replay(ledger,journal,nowOf(options));return structuredClone(ledger);
}
function archiveFor(bytes,max){
  if(!(bytes instanceof Uint8Array)||![Uint8Array.prototype,Buffer.prototype].includes(Object.getPrototypeOf(bytes)))fail('INVALID_SOURCE_BYTES');
  // Reject custom properties/accessors before Buffer conversion can consult them.
  let length;
  try{length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get.call(bytes);}
  catch{fail('INVALID_SOURCE_BYTES');}
  if(length<1||length>max||['buffer','byteOffset','byteLength','length','constructor','valueOf','toString',
    Symbol.toPrimitive,Symbol.iterator].some(key=>Object.hasOwn(bytes,key)))fail('INVALID_SOURCE_BYTES');
  // The intrinsic typed-array copy does not consult caller methods or enumerate
  // millions of numeric own keys for a bounded multi-megabyte schedule file.
  const copy=Buffer.allocUnsafe(length);Uint8Array.prototype.set.call(copy,bytes);
  return {sha256:sha(copy),byteLength:copy.length,encoding:'base64',bodyBase64:copy.toString('base64')};
}
/** Exact repeated source receipts are idempotent; new observations append, never overwrite. */
export function appendBdlReceipt(ledger,journal,input,options){
  const now=nowOf(options),{state}=replay(ledger,journal,now);
  exact(input,['gameId','expectedProviderGameId','bdlBytes','nflverseBytes','bdlRetrievedAt','nflverseRetrievedAt','recordedAt']);
  const recorded=time(input.recordedAt);
  if(recorded>now||recorded<now-60000)fail('APPEND_TIME_NOT_CURRENT');
  const previous=ledger.entries.at(-1);
  if(previous&&recorded<time(previous.recordedAt))fail('BACKDATED_LEDGER_APPEND');
  const target=targetFor(journal,state,input.gameId),bdl=archiveFor(input.bdlBytes,262144),nfl=archiveFor(input.nflverseBytes,4000000);
  const receipt={mapping:{gameId:input.gameId,expectedProviderGameId:input.expectedProviderGameId,status:'DECLARED_UNAUTHENTICATED'},
    bdl:{source:'BALLDONTLIE_NFL_GAMES',sha256:bdl.sha256,byteLength:bdl.byteLength,retrievedAt:input.bdlRetrievedAt},
    nflverse:{source:'NFLVERSE_SCHEDULES',sha256:nfl.sha256,byteLength:nfl.byteLength,retrievedAt:input.nflverseRetrievedAt}};
  const receiptSha256=bdlReceiptDigest({target,receipt});
  const duplicate=ledger.entries.find(entry=>entry.receiptSha256===receiptSha256);
  if(duplicate)return {ledger:structuredClone(ledger),added:false,evidenceRevision:duplicate.evidenceRevision,scoringEligible:false};
  if(ledger.entries.length>=MAX_ENTRIES)fail('RECEIPT_LEDGER_LIMIT');
  const next=structuredClone(ledger);
  for(const archive of [bdl,nfl])if(!next.archives.some(a=>a.sha256===archive.sha256))next.archives.push(archive);
  const map=archiveMap(next.archives),candidate=assess(journal,receipt,input.recordedAt,map,new Set());
  const prior=ledger.entries.filter(entry=>entry.target.gameId===input.gameId).at(-1);
  revisionTimes(receipt,input.recordedAt,target,prior);
  const body={baselineSha256:ledger.baselineSha256,sequence:ledger.entries.length+1,evidenceRevision:(prior?.evidenceRevision??0)+1,
    previousEntrySha256:previous?.entrySha256??null,previousGameEntrySha256:prior?.entrySha256??null,
    recordedAt:input.recordedAt,target,receipt,receiptSha256,candidate,
    comparison:comparisonFor(candidate,prior,state.latest.get(input.gameId)),flags:flags()};
  next.entries.push({...body,entrySha256:bdlReceiptDigest(body)});
  replay(next,journal,now);
  return {ledger:next,added:true,evidenceRevision:body.evidenceRevision,scoringEligible:false};
}
/** No raw source bodies are returned by this summary. Its counts are not scored outcomes. */
export function summarizeBdlReceiptLedger(ledger,journal,options){
  const {games}=replay(ledger,journal,nowOf(options));
  return {policy:BDL_RECEIPT_LEDGER_POLICY,activation:'DISABLED',scoringPolicyUnchanged:OUTCOME_SCORING_POLICY,
    archiveMeaning:ARCHIVE_MEANING,...flags(),archiveIntegrityReplayed:true,archiveBlobs:ledger.archives.length,
    archivedBytes:ledger.archives.reduce((sum,a)=>sum+a.byteLength,0),evidenceRevisions:ledger.entries.length,
    distinctReviewedGames:games.size,ledgerSha256:bdlReceiptDigest(ledger),lastEntrySha256:ledger.entries.at(-1)?.entrySha256??null,
    quarantine:structuredClone(ledger.baseline.quarantine),
    rows:[...games].sort(([a],[b])=>a.localeCompare(b)).map(([gameId,e])=>({gameId,evidenceRevision:e.evidenceRevision,
      recordedAt:e.recordedAt,homeScore:e.candidate.homeScore,awayScore:e.candidate.awayScore,
      scoreRelation:e.comparison.scoreRelation,retainedResultRelation:e.comparison.retainedResultRelation,
      correctionEvidenceRevisions:ledger.entries.filter(r=>r.target.gameId===gameId&&r.comparison.scoreRelation==='SCORE_CORRECTION_REQUIRES_REVIEW').length,
      scoringEligible:false})),
    blockers:['DISABLED_NONQUALIFYING_POLICY','SUPPLIED_SOURCE_BYTES_AND_TIMESTAMPS_NOT_AUTHENTICATED',
      'NATIVE_GAME_MAPPING_DECLARED_NOT_AUTHENTICATED','UPSTREAM_INDEPENDENCE_NOT_VERIFIED',
      'SOURCE_USE_AND_PUBLICATION_RIGHTS_NOT_ESTABLISHED','NO_EXTERNAL_HISTORY_OR_ARCHIVE_WITNESS']};
}
/** A separately retained prior ledger is required to detect rollback/truncation or rewritten history. */
export function assertBdlReceiptLedgerExtension(previous,next,journal,options){
  const now=nowOf(options);replay(previous,journal,now);replay(next,journal,now);
  if(previous.baselineSha256!==next.baselineSha256||next.entries.length<previous.entries.length||
    next.archives.length<previous.archives.length||previous.entries.some((entry,i)=>!same(entry,next.entries[i]))||
    previous.archives.some((archive,i)=>!same(archive,next.archives[i])))fail('RECEIPT_HISTORY_CHANGED');
  return structuredClone(next);
}
