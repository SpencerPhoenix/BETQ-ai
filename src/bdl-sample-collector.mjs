/** Manual, bounded transport only. Private output must be encrypted before storage.
 * Transport observations do not establish upstream independence or scoring eligibility.
 * No ambient credentials, filesystem, logging, scheduler or production activation. */
import {createHash} from 'node:crypto';
import {validateJournal} from './evidence.mjs';
import {canonicalTimestamp,providerContinuityConflicts,FINALITY_DELAY_MS} from './evidence-integrity.mjs';
import {validateRetainedIdentityState} from './retained-schedule-quarantine.mjs';
import {canonicalTeam,NFL_TEAMS} from './nfl-elo.mjs';
import {nflGameDate} from './integrity.mjs';
import {assessBdlOutcomeCandidate} from './bdl-outcome-candidate.mjs';
import {emptyBdlReceiptLedger,appendBdlReceipt,summarizeBdlReceiptLedger} from './bdl-receipt-ledger.mjs';
export const BDL_PROVIDER_LIST_STATES=Object.freeze(['NOT_OBSERVED','INVALID_JSON','INVALID_SHAPE','INVALID_PAGE',
  'CONTINUATION_PRESENT','AMBIGUOUS_FULL_PAGE','COMPLETE_EXPLICIT_NULL','COMPLETE_SHORT_PAGE_CURSOR_OMITTED']);
const API='https://api.balldontlie.io/nfl/v1/games';
const CSV='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const PUBLIC_HOSTS=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
class SampleError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new SampleError(code);};
const team=t=>t==='LAR'?'LA':canonicalTeam(t);
const positive=n=>Number.isSafeInteger(n)&&n>0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const archive=(bytes,retrievedAt)=>({sha256:sha(bytes),byteLength:bytes.length,base64:Buffer.from(bytes).toString('base64'),retrievedAt});
// Parse first to validate grammar, then inspect original tokens (including escaped keys).
function strictJson(bytes){
  let text,payload;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);payload=JSON.parse(text);}catch{fail('INVALID_PROVIDER_JSON');}
  let at=0;const ws=()=>{while(at<text.length&&/\s/.test(text[at]))at++;};
  const string=()=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='\\')at++;else if(c==='"')break;}return JSON.parse(text.slice(start,at));};
  const value=depth=>{if(depth>32)fail('PROVIDER_JSON_DEPTH_LIMIT');ws();
    if(text[at]==='{'){at++;ws();const keys=new Set();if(text[at]==='}'){at++;return;}
      for(;;){ws();const key=string();if(keys.has(key))fail('DUPLICATE_PROVIDER_JSON_KEY');keys.add(key);ws();at++;value(depth+1);ws();if(text[at++]==='}')return;}}
    if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){value(depth+1);ws();if(text[at++]===']')return;}}
    if(text[at]==='"'){string();return;}while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
  };value(0);return payload;
}
function publicLocation(location,base){
  let url;try{url=new URL(location,base);}catch{fail('PUBLIC_REDIRECT_REJECTED');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!PUBLIC_HOSTS.has(url.hostname))fail('PUBLIC_REDIRECT_REJECTED');
  return url.href;
}
/** clock returns current epoch milliseconds, never a caller-selected historical receipt.
 * fetchImpl and clock are trusted dependencies. Success.privateBundle contains raw
 * licensed source material; it must never be logged or uploaded unencrypted. */
export async function collectBdlOutcomeSample(input,{fetchImpl,clock,timeoutMs=15000}={}){
  const diagnostics={bdlRequests:0,publicRequests:0,providerListState:'NOT_OBSERVED',scoringEligible:false,sourceIndependenceVerified:false};
  try{
    if(typeof fetchImpl!=='function'||typeof clock!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('INVALID_DEPENDENCIES');
    let previous=-1;
    const now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0||n>8640000000000000||n<previous)fail('INVALID_OBSERVATION_CLOCK');previous=n;return n;};
    const started=now();
    if(!input||typeof input.apiKey!=='string'||!/^[\x21-\x7e]{1,512}$/.test(input.apiKey)||typeof input.gameId!=='string'||!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(input.gameId))fail('INVALID_INPUT');
    const {apiKey,gameId}=input;let journal,state;
    try{journal=validateJournal(structuredClone(input.journal));state=validateRetainedIdentityState(journal,started);}catch{fail('INVALID_FROZEN_JOURNAL');}
    const snapshot=journal.snapshots.find(s=>s.gameId===gameId);
    if(!snapshot||state.schedules.blocked.has(gameId)||providerContinuityConflicts(journal.snapshots).has(gameId))fail('MISSING_OR_QUARANTINED_TARGET');
    const kick=canonicalTimestamp(snapshot.commenceTime);
    if(!Number.isFinite(kick)||started<kick+FINALITY_DELAY_MS)fail('FINALITY_DELAY_NOT_REACHED');
    // Verify full frozen identity and baseline before any network access.
    let ledger;try{ledger=emptyBdlReceiptLedger(journal);}catch{fail('INVALID_FROZEN_JOURNAL');}
    const parts=gameId.split('_'),teams=new Set(Object.values(NFL_TEAMS)),date=new Date(kick);
    if(!teams.has(team(snapshot.home))||!teams.has(team(snapshot.away))||team(snapshot.home)===team(snapshot.away)||
      team(parts[2])!==team(snapshot.away)||team(parts[3])!==team(snapshot.home)||Number(parts[0])!==snapshot.season||
      snapshot.season!==journal.season||snapshot.season!==date.getUTCFullYear()-(date.getUTCMonth()<2?1:0)||
      nflGameDate({commence_time:snapshot.commenceTime})!==snapshot.gameDate||
      journal.snapshots.some(s=>s.gameId!==gameId&&s.season===snapshot.season&&team(s.home)===team(snapshot.home)&&
        team(s.away)===team(snapshot.away)&&canonicalTimestamp(s.commenceTime)===kick))fail('INVALID_FROZEN_IDENTITY');
    if(snapshot.gameDate!==snapshot.commenceTime.slice(0,10))fail('UNSUPPORTED_CROSS_DATE_TARGET');
    const read=async(initial,authenticated,cap)=>{
      const controller=new AbortController();let timer,reader;
      const operation=(async()=>{let url=initial;
        for(let redirects=0;;redirects++){
          if(now()-started>3600000)fail('SAMPLE_WINDOW_EXCEEDED');
          if(authenticated)diagnostics.bdlRequests++;else diagnostics.publicRequests++;
          const response=await fetchImpl(url,{method:'GET',redirect:authenticated?'error':'manual',credentials:'omit',signal:controller.signal,
            headers:authenticated?{Accept:'application/json','Accept-Encoding':'identity',Authorization:apiKey}:{Accept:'text/csv,text/plain','Accept-Encoding':'identity'}});
          if(controller.signal.aborted)fail('SOURCE_TIMEOUT');
          if(now()-started>3600000)fail('SAMPLE_WINDOW_EXCEEDED');
          if(response.redirected||(response.url&&response.url!==url))fail('UNEXPECTED_REDIRECT');
          if([301,302,303,307,308].includes(response.status)){
            if(authenticated)fail('PROVIDER_REDIRECT_REJECTED');
            const location=response.headers?.get('location');
            if(!location||redirects>=2)fail('PUBLIC_REDIRECT_REJECTED');
            void response.body?.cancel().catch(()=>{});url=publicLocation(location,url);continue;
          }
          if(response.status!==200)fail(authenticated?'PROVIDER_HTTP_ERROR':'PUBLIC_HTTP_ERROR');
          const encoding=response.headers?.get('content-encoding');
          const length=(!encoding||encoding.toLowerCase()==='identity')?response.headers?.get('content-length'):null;
          if(length!=null&&(!/^\d+$/.test(length)||Number(length)>cap))fail('SOURCE_TOO_LARGE');
          if(!response.body||typeof response.body.getReader!=='function')fail('SOURCE_BODY_REQUIRED');
          reader=response.body.getReader();const storage=new Uint8Array(cap);let size=0,chunks=0;
          for(;;){const {done,value}=await reader.read();if(controller.signal.aborted)fail('SOURCE_TIMEOUT');if(done)break;
            if(!(value instanceof Uint8Array))fail('SOURCE_READ_FAILED');if(++chunks>65536)fail('SOURCE_CHUNK_LIMIT');
            if(size+value.byteLength>cap)fail('SOURCE_TOO_LARGE');storage.set(value,size);size+=value.byteLength;}
          if(!size||(length!=null&&Number(length)!==size))fail('INCOMPLETE_SOURCE');
          const bytes=storage.slice(0,size);
          if(Buffer.from(bytes).includes(Buffer.from(apiKey)))fail('CREDENTIAL_ECHO_REJECTED');
          const retrievedAt=new Date(now()).toISOString();
          return {bytes,retrievedAt};
        }
      })();
      try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SampleError('SOURCE_TIMEOUT'));},timeoutMs);})]);}
      finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
    };
    // Public source first: fail without spending provider calls if unavailable/oversized.
    const nfl=await read(CSV,false,4000000);
    const listUrl=`${API}?dates%5B%5D=${snapshot.gameDate}&per_page=100`;
    const list=await read(listUrl,true,262144);
    diagnostics.providerListState='INVALID_JSON';
    const payload=strictJson(list.bytes);
    const plain=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
    diagnostics.providerListState='INVALID_SHAPE';
    if(!plain(payload)||!Array.isArray(payload.data)||!plain(payload.meta))fail('INCOMPLETE_PROVIDER_LIST');
    diagnostics.providerListState='INVALID_PAGE';
    const pageSize=payload.meta.per_page;
    if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100||payload.data.length>pageSize)fail('INCOMPLETE_PROVIDER_LIST');
    const hasCursor=Object.hasOwn(payload.meta,'next_cursor');
    if(hasCursor&&payload.meta.next_cursor!==null){
      diagnostics.providerListState='CONTINUATION_PRESENT';fail('INCOMPLETE_PROVIDER_LIST');
    }
    if(!hasCursor&&payload.data.length===pageSize){
      diagnostics.providerListState='AMBIGUOUS_FULL_PAGE';fail('INCOMPLETE_PROVIDER_LIST');
    }
    // Optional cursor is safe only for a strictly short page. Never infer that a
    // full page with no cursor is complete, and never fetch continuation pages.
    diagnostics.providerListState=hasCursor?'COMPLETE_EXPLICIT_NULL':'COMPLETE_SHORT_PAGE_CURSOR_OMITTED';
    const ids=new Set();for(const event of payload.data){if(!event||!positive(event.id)||ids.has(event.id))fail('AMBIGUOUS_PROVIDER_MAPPING');ids.add(event.id);}
    const matches=payload.data.filter(e=>e.season===snapshot.season&&team(e.home_team?.abbreviation)===team(snapshot.home)&&team(e.visitor_team?.abbreviation)===team(snapshot.away));
    if(matches.length!==1||canonicalTimestamp(matches[0].date)!==kick)fail('PROVIDER_MAPPING_MISMATCH');
    const mapped=matches[0];
    const single=await read(`${API}/${mapped.id}`,true,262144),detail=strictJson(single.bytes);
    if(!detail?.data||Array.isArray(detail.data)||Object.hasOwn(detail,'meta'))fail('INVALID_SINGLE_RESPONSE');
    const fields=['id','date','season','postseason','status_state','status','updated_at','home_team_score','visitor_team_score'];
    if(fields.some(k=>detail.data[k]!==mapped[k])||['home_team','visitor_team'].some(k=>detail.data[k]?.id!==mapped[k]?.id||detail.data[k]?.abbreviation!==mapped[k]?.abbreviation))fail('PROVIDER_LIST_DETAIL_MISMATCH');
    const evaluated=now(),recordedAt=new Date(evaluated).toISOString();
    if(evaluated-started>3600000)fail('SAMPLE_WINDOW_EXCEEDED');
    const candidateInput={journal,gameId,expectedProviderGameId:mapped.id,bdlBytes:single.bytes,nflverseBytes:nfl.bytes,
      bdlRetrievedAt:single.retrievedAt,nflverseRetrievedAt:nfl.retrievedAt,evaluatedAt:recordedAt};
    const candidate=assessBdlOutcomeCandidate(candidateInput);
    if(candidate.status!=='MATCHED_NONQUALIFYING_CANDIDATE')fail('CANDIDATE_REJECTED');
    try{ledger=appendBdlReceipt(ledger,journal,{gameId,expectedProviderGameId:mapped.id,bdlBytes:single.bytes,nflverseBytes:nfl.bytes,
      bdlRetrievedAt:single.retrievedAt,nflverseRetrievedAt:nfl.retrievedAt,recordedAt},{now:evaluated}).ledger;}catch{fail('RECEIPT_VALIDATION_FAILED');}
    return {ok:true,diagnostics:{...diagnostics,status:'PRIVATE_NONQUALIFYING_SAMPLE_CAPTURED'},privateBundle:{
      schemaVersion:1,meaning:'PRIVATE_TRANSPORT_OBSERVATIONS_NOT_INDEPENDENCE_OR_SCORING_PROOF',journal,ledger,
      mappingList:{source:'BALLDONTLIE_NFL_GAMES_DATE_LIST',gameId,providerGameId:mapped.id,...archive(list.bytes,list.retrievedAt)},
      summary:summarizeBdlReceiptLedger(ledger,journal,{now:evaluated})}};
  }catch(error){return {ok:false,error:error instanceof SampleError?error.code:'SAMPLE_FAILED',diagnostics};}
}
