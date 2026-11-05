/**
 * Read the existing public derived journal and apply this runtime's scoring
 * policy. No provider calls, credentials, uploads, disk writes or publication.
 */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {emptyJournal,validateJournal,summarizeEvidence} from './evidence.mjs';
import {isValidEvidenceSummary} from './evidence-feed.mjs';
import {readBoundedText} from './integrity.mjs';

export const PUBLIC_EVIDENCE_JOURNAL_URL=
  'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/evidence/nfl-2026.json';
const MAX_BYTES=5_000_000;
const canonicalUtc=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&
  new Date(Date.parse(value)).toISOString()===value;
const forbidden=new Set(['bookmakers','bookmakerkey','americanodds','decimalodds',
  'apikey','oddsapikey','balldontlieapikey','authorization','accesstoken','refreshtoken',
  'password','secret','clientsecret','token']);
function assertPublicDerived(value,depth=0){
  if(depth>40)throw Error('JOURNAL_NESTING_LIMIT');
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(forbidden.has(key.replace(/[_-]/g,'').toLowerCase()))throw Error('PRIVATE_OR_RAW_DATA');
    assertPublicDerived(child,depth+1);
  }
}
function validatePublicJournal(journal){
  assertPublicDerived(journal);
  validateJournal(journal);
  if(journal.season!==2026||!isDeepStrictEqual(journal.provenance,emptyJournal(2026).provenance)||
    journal.snapshots.some(s=>s.researchOnly!==true||s.independentModel!==true||!canonicalUtc(s.capturedAt)))
    throw Error('UNSUPPORTED_PUBLIC_JOURNAL');
  return journal;
}

/** Snapshot sorting is allowed; every existing record must remain identical. */
export function assertAppendOnlyEvidence(previous,next){
  validatePublicJournal(previous);validatePublicJournal(next);
  const snapshots=new Map(next.snapshots.map(s=>[s.id,s]));
  const oldIds=new Set(previous.snapshots.map(s=>s.id));
  const captureFloor=previous.snapshots.reduce((max,s)=>Math.max(max,Date.parse(s.capturedAt)),-Infinity);
  for(const shot of next.snapshots){
    if(oldIds.has(shot.id))continue;
    const captured=Date.parse(shot.capturedAt);
    if(captured<captureFloor||previous.snapshots.some(old=>old.gameId===shot.gameId&&
      Date.parse(old.capturedAt)===captured&&(shot.id<old.id||shot.id.localeCompare(old.id)<0)))
      throw Error('BACKDATED_FORECAST_ADDITION');
  }
  for(const old of previous.snapshots)
    if(!isDeepStrictEqual(old,snapshots.get(old.id)))throw Error('SNAPSHOT_HISTORY_CHANGED');
  if(next.settlements.length<previous.settlements.length||
    previous.settlements.some((r,i)=>!isDeepStrictEqual(r,next.settlements[i])))
    throw Error('SETTLEMENT_HISTORY_CHANGED');
  return next;
}
function assertNoFutureRecords(journal,now){
  if(!Number.isFinite(now)||journal.snapshots.some(s=>Date.parse(s.capturedAt)>now+60000)||
    journal.settlements.some(r=>r.verifiedAt!==undefined&&
      (!Number.isFinite(Date.parse(r.verifiedAt))||Date.parse(r.verifiedAt)>now+120000)))
    throw Error('FUTURE_OR_INVALID_OBSERVATION_TIME');
}
/** Same pure boundary for startup fallback and remotely read journals. */
export function recomputeJournalEvidence(journal,now=Date.now()){
  validatePublicJournal(journal);
  assertNoFutureRecords(journal,now);
  const summary=summarizeEvidence(journal,now);
  if(!isValidEvidenceSummary(summary))throw Error('UNSAFE_RECOMPUTED_SUMMARY');
  return summary;
}
const digest=text=>createHash('sha256').update(text).digest('hex');
const latestCapture=j=>j.snapshots.length?
  j.snapshots.reduce((latest,s)=>Date.parse(s.capturedAt)>Date.parse(latest)?s.capturedAt:latest,j.snapshots[0].capturedAt):null;

export function createJournalEvidenceFeed({fallbackJournal,fetchImpl=globalThis.fetch,
  clock=Date.now,ttlMs=300000}={}){
  let journal=structuredClone(validatePublicJournal(fallbackJournal));
  let data=recomputeJournalEvidence(journal,clock());
  let journalSha256=digest(JSON.stringify(journal)),origin='BUNDLED_JOURNAL';
  let lastAttemptAt=null,lastSuccessfulFetchAt=null,lastError=null,expires=0,pending=null;
  const metadata=()=>({source:origin,status:lastError?'REFRESH_FAILED_USING_RETAINED_EVIDENCE':
      origin==='BUNDLED_JOURNAL'?'BUNDLED_FALLBACK':'PUBLIC_JOURNAL_READ',
    sourcePublicationTimeVerified:false,lastAttemptAt,lastSuccessfulFetchAt,
    latestSnapshotAt:latestCapture(journal),journalSha256,lastError});
  // Callers cannot modify the retained baseline or its summary through a reply.
  const result=()=>({...structuredClone(data),publication:metadata()});
  async function get(){
    if(clock()<expires)return result();
    if(pending){await pending;return result();}
    pending=(async()=>{
      try{
        lastAttemptAt=new Date(clock()).toISOString();
        const response=await fetchImpl(PUBLIC_EVIDENCE_JOURNAL_URL,{
          method:'GET',headers:{Accept:'application/json'},credentials:'omit',
          redirect:'error',signal:AbortSignal.timeout(10000)
        });
        if(!response.ok)throw Error('JOURNAL_UNAVAILABLE');
        const raw=await readBoundedText(response,MAX_BYTES);
        const candidate=assertAppendOnlyEvidence(journal,JSON.parse(raw));
        const summary=recomputeJournalEvidence(candidate,clock());
        journal=candidate;data=summary;journalSha256=digest(raw);
        origin='PUBLIC_JOURNAL';lastSuccessfulFetchAt=new Date(clock()).toISOString();
        lastError=null;
      }catch{
        lastError='PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID';
      }finally{
        expires=clock()+Math.max(60000,ttlMs);
      }
    })();
    try{await pending;}finally{pending=null;}
    return result();
  }
  return {get,status:()=>({...metadata(),cacheSecondsRemaining:Math.max(0,Math.floor((expires-clock())/1000))})};
}
