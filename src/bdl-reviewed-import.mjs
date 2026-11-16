/** Offline operator review boundary. Never fetches, decrypts, logs or writes files.
 * Caller must first verify the encrypted artifact and GitHub run externally.
 * Supplied run/hash metadata is an operator assertion, not provider authentication. */
import {createHash} from 'node:crypto';
import {bdlReceiptDigest,validateBdlReceiptLedger,summarizeBdlReceiptLedger} from './bdl-receipt-ledger.mjs';
import {BDL_REVIEWED_RESULT_POLICY} from './bdl-reviewed-result.mjs';
import {canonicalTimestamp} from './evidence-integrity.mjs';
import {updateJournal} from './evidence.mjs';
import {assertAppendOnlyEvidence} from './evidence-journal-feed.mjs';
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const plain=v=>Boolean(v&&Object.getPrototypeOf(v)===Object.prototype);
const exact=(v,keys)=>{if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||keys.some(k=>{
 const d=Object.getOwnPropertyDescriptor(v,k);return !d?.enumerable||!Object.hasOwn(d,'value');}))fail('UNEXPECTED_REVIEW_FIELDS');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// Retain duplicate-key rejection while replaying original mapping bytes.
function parseList(bytes){
 let text,payload;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);payload=JSON.parse(text);}catch{fail('INVALID_MAPPING_JSON');}
 let at=0;const ws=()=>{while(at<text.length&&/\s/.test(text[at]))at++;};
 const string=()=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='\\')at++;else if(c==='"')break;}return JSON.parse(text.slice(start,at));};
 const value=depth=>{if(depth>32)fail('MAPPING_DEPTH_LIMIT');ws();
  if(text[at]==='{'){at++;ws();const keys=new Set();if(text[at]==='}'){at++;return;}
   for(;;){ws();const key=string();if(keys.has(key))fail('DUPLICATE_MAPPING_KEY');keys.add(key);ws();at++;value(depth+1);ws();if(text[at++]==='}')return;}}
  if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){value(depth+1);ws();if(text[at++]===']')return;}}
  if(text[at]==='"'){string();return;}while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
 };value(0);return payload;
}
/** One original sample only. No rebasing, inferred history, renewed receipt times or batch activation. */
export function importReviewedBdlBundle({bundle,journal,provenance,now}){
 if(!Number.isSafeInteger(now)||now<0||now>8640000000000000)fail('INVALID_REVIEW_CLOCK');
 bdlReceiptDigest(bundle);bdlReceiptDigest(journal);
 exact(bundle,['schemaVersion','meaning','journal','ledger','mappingList','summary']);
 if(bundle.schemaVersion!==1||bundle.meaning!=='PRIVATE_TRANSPORT_OBSERVATIONS_NOT_INDEPENDENCE_OR_SCORING_PROOF')fail('INVALID_PRIVATE_BUNDLE');
 if(bdlReceiptDigest(bundle.journal)!==bdlReceiptDigest(journal))fail('REVIEW_BASELINE_CHANGED');
 exact(provenance,['githubRepository','githubRunId','githubCommitSha','githubRunUrl','encryptedArtifactSha256']);
 if(provenance.githubRepository!=='SpencerPhoenix/BETQ-ai'||typeof provenance.githubRunId!=='string'||
  !/^[1-9]\d{0,19}$/.test(provenance.githubRunId)||!/^[a-f0-9]{40}$/.test(provenance.githubCommitSha)||
  provenance.githubRunUrl!=='https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/'+provenance.githubRunId||!digest(provenance.encryptedArtifactSha256))fail('INVALID_REVIEW_PROVENANCE');
 validateBdlReceiptLedger(bundle.ledger,journal,{now});
 const replay=summarizeBdlReceiptLedger(bundle.ledger,journal,{now});
 if(bdlReceiptDigest(replay)!==bdlReceiptDigest(bundle.summary)||replay.evidenceRevisions!==1||replay.distinctReviewedGames!==1)fail('SINGLE_REPLAYED_SAMPLE_REQUIRED');
 const entry=bundle.ledger.entries[0],m=bundle.mappingList;
 if(!['NO_RETAINED_RESULT','MATCHES_RETAINED_SCORE'].includes(entry.comparison.retainedResultRelation))fail('SCORE_CORRECTION_REQUIRES_SEPARATE_REVIEW');
 exact(m,['source','gameId','providerGameId','sha256','byteLength','base64','retrievedAt']);
 if(m.source!=='BALLDONTLIE_NFL_GAMES_DATE_LIST'||m.gameId!==entry.target.gameId||m.providerGameId!==entry.receipt.mapping.expectedProviderGameId||
  !digest(m.sha256)||!Number.isInteger(m.byteLength)||m.byteLength<1||m.byteLength>262144||typeof m.base64!=='string'||m.base64.length!==4*Math.ceil(m.byteLength/3))fail('INVALID_MAPPING_ARCHIVE');
 const bytes=Buffer.from(m.base64,'base64');
 if(bytes.length!==m.byteLength||bytes.toString('base64')!==m.base64||hash(bytes)!==m.sha256)fail('MAPPING_ARCHIVE_MISMATCH');
 const mappedAt=canonicalTimestamp(m.retrievedAt),nflAt=canonicalTimestamp(entry.receipt.nflverse.retrievedAt),bdlAt=canonicalTimestamp(entry.receipt.bdl.retrievedAt);
 if(!Number.isFinite(mappedAt)||mappedAt<nflAt||mappedAt>bdlAt)fail('MAPPING_OBSERVATION_TIME_INVALID');
 const list=parseList(bytes);
 if(!plain(list)||!Array.isArray(list.data)||!plain(list.meta)||!Number.isInteger(list.meta.per_page)||list.meta.per_page<1||list.meta.per_page>100||
  list.data.length>list.meta.per_page||(Object.hasOwn(list.meta,'next_cursor')?list.meta.next_cursor!==null:list.data.length===list.meta.per_page))fail('INCOMPLETE_MAPPING_LIST');
 const ids=new Set();for(const e of list.data){if(!plain(e)||!Number.isSafeInteger(e.id)||e.id<1||ids.has(e.id))fail('AMBIGUOUS_MAPPING_LIST');ids.add(e.id);}
 const detail=JSON.parse(Buffer.from(bundle.ledger.archives.find(a=>a.sha256===entry.receipt.bdl.sha256).bodyBase64,'base64')).data;
 const canonical=t=>t==='LAR'?'LA':t;
 const matches=list.data.filter(e=>e.season===detail.season&&canonical(e.home_team?.abbreviation)===canonical(detail.home_team.abbreviation)&&canonical(e.visitor_team?.abbreviation)===canonical(detail.visitor_team.abbreviation));
 if(matches.length!==1||matches[0].id!==m.providerGameId)fail('AMBIGUOUS_MAPPING_LIST');
 for(const k of ['id','date','season','postseason','status_state','status','updated_at','home_team_score','visitor_team_score'])if(matches[0][k]!==detail[k])fail('MAPPING_DETAIL_MISMATCH');
 for(const k of ['home_team','visitor_team'])for(const f of ['id','abbreviation'])if(matches[0][k]?.[f]!==detail[k][f])fail('MAPPING_DETAIL_MISMATCH');
 const c=entry.candidate;
 const record={...entry.target.frozenIdentity,source:'BALLDONTLIE_NFLVERSE_REVIEWED',policyId:BDL_REVIEWED_RESULT_POLICY,
  homeScore:c.homeScore,awayScore:c.awayScore,outcome:c.outcome,verifiedAt:entry.recordedAt,
  nativeFinalObservation:structuredClone(c.nativeFinalObservation),communityScoreObservation:structuredClone(c.communityScoreObservation),
  review:{firstFrozenSnapshotId:entry.target.firstFrozenSnapshotId,firstFrozenSnapshotSha256:entry.target.firstFrozenSnapshotSha256,
   receiptSha256:entry.receiptSha256,ledgerEntrySha256:entry.entrySha256,ledgerSha256:replay.ledgerSha256,
   retainedResultSha256:entry.target.retainedResultSha256,allFrozenSnapshotsSha256:entry.target.allFrozenSnapshotsSha256,
   recordedAt:entry.recordedAt,...provenance},
  researchOnly:true,qualifiesForAggregateScoring:false,sourceIndependenceVerified:false,officialLeagueCertification:false,
  historicalAsOfVerified:false,sourceAuthenticityIndependentlyVerified:false,providerPublicationTimeVerified:false};
 const imported=updateJournal(journal,[],[record],now);assertAppendOnlyEvidence(journal,imported.journal);
 if(imported.settlementRevisions!==1)fail('REVIEW_DID_NOT_APPEND_ONE_REVISION');
 return {journal:imported.journal,review:{policyId:BDL_REVIEWED_RESULT_POLICY,gameId:record.gameId,
  source:'BALLDONTLIE_NFLVERSE_REVIEWED',originalRecordedAt:entry.recordedAt,reviewedAt:new Date(now).toISOString(),
  appendedRevisions:1,providerRequests:0,publicRawSourceBytes:false,aggregateScoringEligible:false,
  sourceIndependenceVerified:false,sourceAuthenticityIndependentlyVerified:false}};
}
