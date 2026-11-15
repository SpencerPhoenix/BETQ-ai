/**
 * Offline, metadata-only official-page review ledger. Not an ingestion license,
 * source archive, settlement writer or scoring-policy activation path.
 */
import {createHash} from 'node:crypto';
import {validateJournal} from './evidence.mjs';
import {NFL_TEAMS,canonicalTeam} from './nfl-elo.mjs';
import {canonicalTimestamp,validFrozenIdentity,sameFrozenIdentity,providerContinuityConflicts} from './evidence-integrity.mjs';
import {latestSettlementsByRevision,unambiguousFrozenGameIds,OUTCOME_SCORING_POLICY} from './settlement-qualification.mjs';

export const OFFICIAL_SCORE_REVIEW_POLICY='OFFICIAL_PUBLIC_SCORE_REVIEW_V1_DRAFT';
export const OFFICIAL_SCORE_REVIEW_MAX_AGE_MS=3600000;
const FINALITY_DELAY=86400000,MAX_ENTRIES=1000;
const teamCodes=new Set(Object.values(NFL_TEAMS));
const digestValue=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hosts=new Map([
  ['www.nfl.com',null],['amp.nfl.com',null],['www.seahawks.com','SEA'],
  ['www.jaguars.com','JAX'],['www.commanders.com','WAS']
]);
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const time=value=>{const at=canonicalTimestamp(value);if(!Number.isFinite(at))fail('CANONICAL_UTC_REQUIRED');return at;};
const exact=(value,keys)=>{
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||
    Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('UNEXPECTED_OR_MISSING_FIELDS');
};
function canonical(value,depth=0){
  if(depth>30)fail('RECORD_NESTING_LIMIT');
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(value&&Object.getPrototypeOf(value)===Object.prototype)
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
  fail('UNSUPPORTED_RECORD_VALUE');
}
export const officialReviewDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const header=j=>Object.fromEntries(Object.entries(j).filter(([k])=>!['snapshots','settlements'].includes(k)));
const identity=s=>Object.fromEntries(['gameId','season','home','away','gameDate','commenceTime'].map(k=>[k,s[k]]));
const fixedFlags=()=>({scoringEligible:false,qualifiedOutcomes:0,sourceUpstreamIndependenceVerified:false,
  officialLeagueCertification:false,historicalAsOfVerified:false,sourcePublicationTimeVerified:false,
  originalSourceArchiveVerified:false,sourceContentSha256:null,timestampAuthorityVerified:false,completeHistoryVerified:false,
  automatedSourceUseAuthorized:false,commercialSourceUseAuthorized:false,publicRedistributionAuthorized:false});
const checkJournal=journal=>{validateJournal(journal);latestSettlementsByRevision(journal.settlements);return journal;};
function targetFor(journal,gameId,{latest=true,resultSha256=null}={}){
  checkJournal(journal);
  if(providerContinuityConflicts(journal.snapshots).has(gameId))fail('PROVIDER_IDENTITY_REQUIRES_REVIEW');
  if(!unambiguousFrozenGameIds(journal.snapshots).has(gameId))fail('MISSING_OR_AMBIGUOUS_FROZEN_GAME');
  const shots=journal.snapshots.filter(s=>s.gameId===gameId).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0));
  const first=shots[0];
  if(!validFrozenIdentity(first)||!shots.every(s=>sameFrozenIdentity(s,first))||
    !teamCodes.has(first.home)||!teamCodes.has(first.away))fail('INVALID_FROZEN_GAME');
  const encoded=/^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(gameId);
  const year=Number(first.gameDate.slice(0,4)),month=Number(first.gameDate.slice(5,7));
  if(!encoded||Number(encoded[1])!==first.season||Number(encoded[2])<1||Number(encoded[2])>22||
    encoded[3]!==first.away||encoded[4]!==first.home||first.season!==year-(month<=2?1:0))fail('INVALID_FROZEN_GAME_IDENTITY');
  if(journal.snapshots.some(s=>s.gameId!==gameId&&s.home===first.home&&s.away===first.away&&s.commenceTime===first.commenceTime))
    fail('AMBIGUOUS_EVENT_ALIAS');
  const r=latest?latestSettlementsByRevision(journal.settlements).get(gameId):
    journal.settlements.find(r=>r.gameId===gameId&&officialReviewDigest(r)===resultSha256);
  if(!r||!Number.isInteger(r.revision)||r.revision<1||r.source!=='NFLVERSE_SCHEDULES'||typeof r.resultHash!=='string'||!/^[a-f0-9]{24}$/.test(r.resultHash)||time(r.verifiedAt)<=time(first.commenceTime))fail('MISSING_OR_INVALID_RETAINED_RESULT');
  for(const key of ['season','home','away','gameDate','commenceTime'])if(r[key]!=null&&r[key]!==first[key])fail('RESULT_IDENTITY_CONFLICT');
  return {gameId,frozenIdentity:identity(first),frozenSnapshotId:first.id,frozenSnapshotSha256:officialReviewDigest(first),
    resultRevision:r.revision,resultSha256:officialReviewDigest(r),resultHash:r.resultHash,
    originalResultVerifiedAt:r.verifiedAt,homeScore:r.homeScore,awayScore:r.awayScore,outcome:r.outcome};
}
export function officialReviewTarget(journal,gameId){return targetFor(journal,gameId);}
export function emptyOfficialScoreReviewLedger(journal){
  checkJournal(journal);
  const baseline={headerSha256:officialReviewDigest(header(journal)),
    snapshots:journal.snapshots.map(s=>({id:s.id,sha256:officialReviewDigest(s)})),
    settlements:journal.settlements.map(r=>({gameId:r.gameId,sha256:officialReviewDigest(r)}))};
  return {schema:1,policy:OFFICIAL_SCORE_REVIEW_POLICY,activation:'DISABLED',
    scoringPolicyUnchanged:OUTCOME_SCORING_POLICY,
    baseline,baselineSha256:officialReviewDigest(baseline),entries:[]};
}
function validateBaseline(ledger,journal){
  exact(ledger,['schema','policy','activation','scoringPolicyUnchanged','baseline','baselineSha256','entries']);
  if(ledger.schema!==1||ledger.policy!==OFFICIAL_SCORE_REVIEW_POLICY||ledger.activation!=='DISABLED'||
    ledger.scoringPolicyUnchanged!==OUTCOME_SCORING_POLICY||!Array.isArray(ledger.entries)||ledger.entries.length>MAX_ENTRIES)fail('INVALID_LEDGER');
  exact(ledger.baseline,['headerSha256','snapshots','settlements']);
  const b=ledger.baseline;
  if(!digestValue(ledger.baselineSha256)||ledger.baselineSha256!==officialReviewDigest(b))fail('BASELINE_DIGEST_MISMATCH');
  if(!Array.isArray(b.snapshots)||!Array.isArray(b.settlements)||b.snapshots.length>10000||b.settlements.length>1000||
    b.headerSha256!==officialReviewDigest(header(journal)))fail('INVALID_BASELINE');
  const snapshotIds=new Set(),resultHashes=new Set();
  for(const s of b.snapshots){
    exact(s,['id','sha256']);
    if(typeof s.id!=='string'||!s.id||s.id.length>200||!digestValue(s.sha256)||snapshotIds.has(s.id))fail('INVALID_BASELINE_SNAPSHOT');
    snapshotIds.add(s.id);
  }
  for(const r of b.settlements){
    exact(r,['gameId','sha256']);
    if(typeof r.gameId!=='string'||!r.gameId||r.gameId.length>140||!digestValue(r.sha256)||resultHashes.has(r.sha256))fail('INVALID_BASELINE_RESULT');
    resultHashes.add(r.sha256);
  }
  // Snapshot reordering is harmless; every original payload must remain exact.
  const shots=new Map(journal.snapshots.map(s=>[s.id,s]));
  for(const s of b.snapshots)if(!shots.has(s.id)||officialReviewDigest(shots.get(s.id))!==s.sha256)fail('BASELINE_SNAPSHOT_CHANGED');
  if(journal.settlements.length<b.settlements.length)fail('BASELINE_RESULT_CHANGED');
  b.settlements.forEach((r,i)=>{if(journal.settlements[i].gameId!==r.gameId||officialReviewDigest(journal.settlements[i])!==r.sha256)fail('BASELINE_RESULT_CHANGED');});
}
function validateObservation(o,target){
  exact(o,['url','pageType','observedAt','season','gameDate','gameDateBasis','home','away','sourceHomeLabel','sourceAwayLabel','scoreClaim','finalStatus']);
  time(o.observedAt);
  if(typeof o.url!=='string'||o.url.length>2000||/[\u0000-\u0020\u007f]/.test(o.url))fail('INVALID_SOURCE_URL');
  let u;try{u=new URL(o.url);}catch{fail('INVALID_SOURCE_URL');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!hosts.has(u.hostname)||u.href!==o.url)
    fail('UNREVIEWED_SOURCE_URL');
  if(!['SCHEDULE','GAME_REPORT','RECAP','GAME_CENTER'].includes(o.pageType)||
      o.gameDateBasis!=='SOURCE_GAME_DATE_NOT_PUBLICATION_DATE')fail('UNREVIEWED_PAGE_OR_DATE_BASIS');
  const team=hosts.get(u.hostname);
  if(team!==null&&![target.frozenIdentity.home,target.frozenIdentity.away].includes(team))fail('SOURCE_TEAM_NOT_IN_GAME');
  for(const k of ['season','gameDate','home','away'])if(o[k]!==target.frozenIdentity[k])fail('OBSERVED_GAME_IDENTITY_MISMATCH');
  for(const [label,side] of [['sourceHomeLabel','home'],['sourceAwayLabel','away']]){
    if(typeof o[label]!=='string'||o[label].length>100||
        (NFL_TEAMS[o[label]]??canonicalTeam(o[label]))!==target.frozenIdentity[side])fail('UNVERIFIED_SOURCE_TEAM_MAPPING');
  }
  if(o.scoreClaim!==null){
    exact(o.scoreClaim,['homeScore','awayScore']);
    for(const k of ['homeScore','awayScore'])if(!Number.isInteger(o.scoreClaim[k])||o.scoreClaim[k]<0||o.scoreClaim[k]>100||o.scoreClaim[k]!==target[k])fail('OFFICIAL_SCORE_DISAGREEMENT');
  }
  if(o.finalStatus!==null&&o.finalStatus!=='FINAL')fail('EXPLICIT_FINAL_STATUS_REQUIRED');
  if(o.scoreClaim===null&&o.finalStatus===null)fail('EMPTY_SOURCE_OBSERVATION');
}
function validateReceipt(receipt,target,recordedAt){
  exact(receipt,['method','observations']);
  if(!['HUMAN_PAGE_INSPECTION','INTERACTIVE_AGENT_PAGE_INSPECTION'].includes(receipt.method)||!Array.isArray(receipt.observations)||receipt.observations.length<1||receipt.observations.length>4)fail('INVALID_REVIEW_RECEIPT');
  const urls=new Set();let scores=false,final=false;
  for(const o of receipt.observations){
    validateObservation(o,target);
    if(urls.has(o.url))fail('DUPLICATE_SOURCE_OBSERVATION');urls.add(o.url);
    const observed=time(o.observedAt),recorded=time(recordedAt);
    if(observed>recorded||observed<recorded-OFFICIAL_SCORE_REVIEW_MAX_AGE_MS)fail('STALE_OR_FUTURE_REVIEW');
    if(observed<time(target.frozenIdentity.commenceTime)+FINALITY_DELAY||observed<time(target.originalResultVerifiedAt))fail('PREMATURE_OR_BACKDATED_REVIEW');
    scores||=o.scoreClaim!==null;final||=o.finalStatus==='FINAL';
  }
  if(!scores||!final)fail('SCORE_AND_EXPLICIT_FINAL_OBSERVATIONS_REQUIRED');
}
function bodyOf(entry){const {entrySha256,...body}=entry;return body;}
/** Validates all metadata against retained history, never authenticates page access or rights. */
export function validateOfficialScoreReviewLedger(ledger,journal){
  checkJournal(journal);validateBaseline(ledger,journal);
  let previousHash=null,previousAt=-Infinity;const games=new Map(),receipts=new Set();
  for(let i=0;i<ledger.entries.length;i++){
    const e=ledger.entries[i];
    exact(e,['baselineSha256','sequence','evidenceRevision','previousEntrySha256','previousGameEntrySha256','recordedAt','target','receipt','receiptSha256','flags','entrySha256']);
    if(e.baselineSha256!==ledger.baselineSha256||e.sequence!==i+1||e.previousEntrySha256!==previousHash||time(e.recordedAt)<previousAt||
      officialReviewDigest(e.flags)!==officialReviewDigest(fixedFlags())||officialReviewDigest(bodyOf(e))!==e.entrySha256)fail('INVALID_REVIEW_CHAIN');
    const t=targetFor(journal,e.target?.gameId,{latest:false,resultSha256:e.target?.resultSha256});
    if(officialReviewDigest(t)!==officialReviewDigest(e.target))fail('REVIEW_TARGET_CHANGED');
    validateReceipt(e.receipt,t,e.recordedAt);
    if(e.receiptSha256!==officialReviewDigest(e.receipt))fail('RECEIPT_DIGEST_MISMATCH');
    const key=t.gameId+'|'+t.resultSha256+'|'+e.receiptSha256;
    if(receipts.has(key))fail('DUPLICATE_REVIEW_REVISION');receipts.add(key);
    const prior=games.get(t.gameId);
    if(e.evidenceRevision!==(prior?.evidenceRevision??0)+1||e.previousGameEntrySha256!==(prior?.entrySha256??null))fail('INVALID_GAME_REVIEW_CHAIN');
    if(prior&&e.receipt.observations.some(o=>time(o.observedAt)<time(prior.recordedAt)))fail('BACKDATED_EVIDENCE_REVISION');
    games.set(t.gameId,e);previousHash=e.entrySha256;previousAt=time(e.recordedAt);
  }
  return ledger;
}
/**
 * Evidence revisions are separate from settlement revisions. Same resultHash
 * can receive genuinely new review metadata; exact repeats are idempotent.
 * Returns only a detached ledger, never a changed journal.
 */
export function appendOfficialScoreReview(ledger,journal,{gameId,expectedResultSha256,receipt,recordedAt:claimedRecordedAt}={},
  {clock=Date.now}={}){
  validateOfficialScoreReviewLedger(ledger,journal);
  const now=clock();if(!Number.isFinite(now))fail('INVALID_APPEND_CLOCK');
  const recordedAt=claimedRecordedAt??new Date(now).toISOString(),recorded=time(recordedAt);
  if(recorded>now||recorded<now-60000)fail('APPEND_TIME_NOT_CURRENT');
  const target=targetFor(journal,gameId);
  if(target.resultSha256!==expectedResultSha256)fail('RESULT_CHANGED_REVIEW_AGAIN');
  if(ledger.entries.length&&time(recordedAt)<time(ledger.entries.at(-1).recordedAt))fail('BACKDATED_LEDGER_APPEND');
  const receiptSha256=officialReviewDigest(receipt);
  const duplicate=ledger.entries.find(e=>e.target.gameId===gameId&&e.target.resultSha256===target.resultSha256&&e.receiptSha256===receiptSha256);
  if(duplicate)return {ledger:structuredClone(ledger),added:false,evidenceRevision:duplicate.evidenceRevision,scoringEligible:false};
  validateReceipt(receipt,target,recordedAt);
  if(ledger.entries.length>=MAX_ENTRIES)fail('REVIEW_LEDGER_LIMIT');
  const previous=ledger.entries.at(-1),prior=ledger.entries.filter(e=>e.target.gameId===gameId).at(-1);
  if(prior&&receipt.observations.some(o=>time(o.observedAt)<time(prior.recordedAt)))fail('BACKDATED_EVIDENCE_REVISION');
  const body={baselineSha256:ledger.baselineSha256,sequence:ledger.entries.length+1,evidenceRevision:(prior?.evidenceRevision??0)+1,
    previousEntrySha256:previous?.entrySha256??null,previousGameEntrySha256:prior?.entrySha256??null,
    recordedAt,target,receipt:structuredClone(receipt),receiptSha256,flags:fixedFlags()};
  const next=structuredClone(ledger);next.entries.push({...body,entrySha256:officialReviewDigest(body)});
  validateOfficialScoreReviewLedger(next,journal);
  return {ledger:next,added:true,evidenceRevision:body.evidenceRevision,scoringEligible:false};
}
export function summarizeOfficialScoreReviews(ledger,journal){
  validateOfficialScoreReviewLedger(ledger,journal);
  const latestReviews=new Map(ledger.entries.map(e=>[e.target.gameId,e]));
  const results=latestSettlementsByRevision(journal.settlements),rows=[];
  for(const [gameId,r] of [...results].sort(([a],[b])=>a.localeCompare(b))){
    const review=latestReviews.get(gameId),matches=review?.target.resultSha256===officialReviewDigest(r);
    rows.push({gameId,settlementRevision:r.revision??null,evidenceRevision:review?.evidenceRevision??null,
      disposition:!review?'NO_OFFICIAL_REVIEW_RECEIPT':matches?'MANUAL_SCORE_AND_FINAL_AGREEMENT_NONQUALIFYING':'REVIEW_SUPERSEDED_BY_SETTLEMENT_REVISION',
      reviewedAt:review?.recordedAt??null,scoringEligible:false});
  }
  return {policy:OFFICIAL_SCORE_REVIEW_POLICY,activation:'DISABLED',scoringPolicyUnchanged:OUTCOME_SCORING_POLICY,
    sourceUseAuthorization:'NOT_ESTABLISHED',...fixedFlags(),rawResultGames:results.size,evidenceRevisions:ledger.entries.length,
    matchingManualReviews:rows.filter(r=>r.disposition==='MANUAL_SCORE_AND_FINAL_AGREEMENT_NONQUALIFYING').length,
    rows,blockers:['OFFICIAL_SOURCE_USE_RIGHTS_NOT_ESTABLISHED','REVIEW_METADATA_IS_NOT_AUTHENTICATED_SOURCE_CONTENT',
      'NO_NEW_SCORING_POLICY_APPROVED','LATER_OBSERVATION_DOES_NOT_ESTABLISH_HISTORICAL_SOURCE_VINTAGE']};
}

/** Caller must retain the prior ledger to detect rollback or truncation. No external anchor is invented. */
export function assertOfficialScoreReviewExtension(previous,next,journal){
  validateOfficialScoreReviewLedger(previous,journal);validateOfficialScoreReviewLedger(next,journal);
  if(officialReviewDigest(previous.baseline)!==officialReviewDigest(next.baseline)||next.entries.length<previous.entries.length||
    previous.entries.some((e,i)=>officialReviewDigest(e)!==officialReviewDigest(next.entries[i])))fail('REVIEW_HISTORY_CHANGED');
  return next;
}
