/** One explicitly approved read. No journal writes, artifacts, retries or promotion. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readLiveBallDontLieFinal} from './lib/balldontlie-live-reader.mjs';
import {validateJournal} from './lib/evidence.mjs';
import {NFLVERSE_SCHEDULES_URL} from './lib/settlement-only.mjs';

export const BASE_SHA='3dcd5a49948246248026f44f57f39d1e37fa9303';
export const JOURNAL_SHA256='94625a292147c8806fe9a66af2df58cc6b081f1b2f04d8387887d4e39d4d5441';
export const BRANCH='refs/heads/feat/one-shot-balldontlie-refresh-20261104';
export const GAME_ID='2026_08_PHI_WAS';
const digest=s=>createHash('sha256').update(s).digest('hex');
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const statuses=new Set(['CROSS_CHECKED_INDEPENDENCE_UNVERIFIED','NO_CROSS_CHECK_MATCH',
  'CREDENTIAL_REQUIRED','INVALID_CREDENTIAL_FORMAT','INVALID_LOCAL_INPUT','NO_ELIGIBLE_FINAL_CANDIDATE',
  'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED','RATE_LIMITED','PROVIDER_UNAVAILABLE',
  'UNEXPECTED_RESPONSE_ORIGIN','INVALID_PROVIDER_RESPONSE','REQUEST_FAILED','REQUEST_TIMEOUT']);
const reasons=new Set(['NFLVERSE_CANDIDATE_UNAVAILABLE_OR_TOO_EARLY','AMBIGUOUS_NFLVERSE_GAME',
  'AMBIGUOUS_PROVIDER_GAME','NO_PROVIDER_GAME_MATCH','KICKOFF_OR_RECEIPT_MISMATCH',
  'SEASON_PHASE_MISMATCH','EXPLICIT_CONSISTENT_FINAL_REQUIRED','FINAL_SCORE_MISMATCH','INVALID_PROVIDER_RECORD_TIME']);
const result=(status,extra={})=>({status,mode:'ONE_APPROVED_READ_ONLY_COMPARISON',gameId:GAME_ID,
  sourceIndependenceVerified:false,qualifiesForExistingCorroborationGate:false,
  publicationAuthorized:false,qualifiedOutcomes:0,journalWrites:0,retries:0,
  publicScheduleRequests:0,providerRequests:0,...extra});

export function approvedContext(context,now){
  const expiry=Date.parse(context?.expiresAt);
  return context?.approved==='true'&&context.repositorySecretConfirmed==='true'&&
    context.repository==='SpencerPhoenix/BETQ-ai'&&context.event==='workflow_dispatch'&&
    context.ref===BRANCH&&context.runAttempt==='1'&&context.runnerDebug!=='1'&&
    sha(context.expectedSha)&&context.expectedSha===context.actualSha&&
    context.currentMainSha===BASE_SHA&&Number.isFinite(now)&&Number.isFinite(expiry)&&
    new Date(expiry).toISOString()===context.expiresAt&&expiry>now&&expiry<=now+15*60_000;
}

/** Public source transport never receives the BALLDONTLIE credential. */
async function readPublicSchedule(fetchImpl,onRequest){
  const controller=new AbortController(),deadlineAt=performance.now()+15_000;
  let reader,timer;
  const cancel=()=>{controller.abort();try{Promise.resolve(reader?.cancel()).catch(()=>{});}catch{}};
  const check=()=>{if(controller.signal.aborted||performance.now()>=deadlineAt)throw Error('PUBLIC_TIMEOUT');};
  const operation=(async()=>{
    let url=NFLVERSE_SCHEDULES_URL;
    for(let attempt=0;attempt<2;attempt++){
      onRequest();const response=await fetchImpl(url,{method:'GET',redirect:'manual',
        headers:{Accept:'text/csv'},signal:controller.signal});check();
      if(response.redirected||(response.url&&response.url!==url))throw Error('PUBLIC_ORIGIN');
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers?.get('location');
        const next=new URL(location);
        if(attempt!==0||next.protocol!=='https:'||next.hostname!=='release-assets.githubusercontent.com'||
          next.port||next.username||next.password||next.hash)throw Error('PUBLIC_REDIRECT');
        try{Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}
        url=next.href;continue;
      }
      if(response.status!==200||!response.body?.getReader)throw Error('PUBLIC_RESPONSE');
      const length=Number(response.headers?.get('content-length'));
      if(Number.isFinite(length)&&length>12_000_000)throw Error('PUBLIC_LIMIT');
      reader=response.body.getReader();let size=0;const chunks=[];
      while(true){
        const {done,value}=await reader.read();check();if(done)break;
        if(!(value instanceof Uint8Array)||!value.byteLength||chunks.length>=30_000)throw Error('PUBLIC_CHUNK');
        size+=value.byteLength;if(size>12_000_000)throw Error('PUBLIC_LIMIT');
        chunks.push(Buffer.from(value));
      }
      return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.concat(chunks,size));
    }
    throw Error('PUBLIC_REDIRECT_LIMIT');
  })();
  try{return await Promise.race([operation,new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{cancel();reject(Error('PUBLIC_TIMEOUT'));},15_000);
  })]);}finally{clearTimeout(timer);cancel();try{reader?.releaseLock();}catch{}}
}

export async function runOneShot({context,apiKey,journalText,fetchImpl=globalThis.fetch,clock=Date.now}={}){
  let journal,now;
  try{
    now=clock();if(!approvedContext(context,now))return result('NOT_APPROVED');
    if(typeof apiKey!=='string'||!apiKey)return result('CREDENTIAL_REQUIRED');
    if(!/^[\x21-\x7e]{1,512}$/.test(apiKey))return result('INVALID_CREDENTIAL_FORMAT');
    if(typeof journalText!=='string'||digest(journalText)!==JOURNAL_SHA256)throw Error('JOURNAL_HASH');
    journal=validateJournal(JSON.parse(journalText));
    if(!journal.snapshots.some(s=>s.gameId===GAME_ID))throw Error('GAME_MISSING');
  }catch{return result('INVALID_PINNED_INPUT');}
  let publicScheduleRequests=0;
  const receipt={evidenceBaseSha:BASE_SHA,evidenceJournalSha256:JOURNAL_SHA256,codeSha:context.expectedSha};
  try{
    const nflverseCsv=await readPublicSchedule(fetchImpl,()=>{publicScheduleRequests++;});
    const received=clock();
    // Expiration or clock anomalies must stop before the secret-bearing request.
    if(received<now||!approvedContext(context,received))return result('APPROVAL_EXPIRED',{...receipt,publicScheduleRequests});
    const nflverseObservedAt=new Date(received).toISOString();
    const report=await readLiveBallDontLieFinal({enabled:true,apiKey,gameId:GAME_ID,journal,
      nflverseCsv,nflverseObservedAt,fetchImpl,clock});
    const status=statuses.has(report.status)?report.status:'INVALID_PROVIDER_RESPONSE';
    const match=report.crossChecks?.find(x=>x.gameId===GAME_ID);
    // Log only typed, bounded, allowlisted derived fields, never bodies, keys,
    // headers, URLs, provider errors or arbitrary provider strings.
    const clean=result(status,{...receipt,publicScheduleRequests,
      providerRequests:report.providerRequests===1?1:0,matched:status==='CROSS_CHECKED_INDEPENDENCE_UNVERIFIED'});
    if(match&&Number.isInteger(match.homeScore)&&Number.isInteger(match.awayScore)&&
      match.homeScore>=0&&match.homeScore<=100&&match.awayScore>=0&&match.awayScore<=100){
      clean.homeScore=match.homeScore;clean.awayScore=match.awayScore;
      for(const source of ['nflverse','balldontlie']){
        const hash=match.sourceReceipts?.[source]?.sha256;
        if(typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash))clean[source+'Sha256']=hash;
      }
    }
    const reason=report.rejected?.find(x=>x.gameId===GAME_ID)?.reason;
    if(reasons.has(reason))clean.reason=reason;
    if(JSON.stringify(clean).includes(apiKey))return result('REDACTED_RESULT',{publicScheduleRequests,providerRequests:clean.providerRequests});
    return clean;
  }catch{return result('PUBLIC_SOURCE_UNAVAILABLE',{...receipt,publicScheduleRequests});}
}

async function main(){
  let apiKey=process.env.BDL_ONE_SHOT_API_KEY;
  delete process.env.BDL_ONE_SHOT_API_KEY;
  try{
    if(process.argv.length!==2)throw Error('NO_ARGUMENTS');
    const context={approved:process.env.BDL_APPROVED,repositorySecretConfirmed:process.env.BDL_REPOSITORY_SECRET_CONFIRMED,
      repository:process.env.GITHUB_REPOSITORY,event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,
      runAttempt:process.env.GITHUB_RUN_ATTEMPT,runnerDebug:process.env.RUNNER_DEBUG,
      expectedSha:process.env.BDL_EXPECTED_SHA,actualSha:process.env.GITHUB_SHA,
      currentMainSha:process.env.BDL_CURRENT_MAIN_SHA,expiresAt:process.env.BDL_EXPIRES_AT};
    const journalText=await readFile(new URL('../../data/evidence/nfl-2026.json',import.meta.url),'utf8');
    const output=await runOneShot({context,apiKey,journalText});
    process.stdout.write(JSON.stringify(output)+'\n');
    if(!['CROSS_CHECKED_INDEPENDENCE_UNVERIFIED','NO_CROSS_CHECK_MATCH'].includes(output.status))process.exitCode=1;
  }catch{process.stdout.write(JSON.stringify(result('LOCAL_PREFLIGHT_FAILED'))+'\n');process.exitCode=1;}
  finally{apiKey=undefined;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
