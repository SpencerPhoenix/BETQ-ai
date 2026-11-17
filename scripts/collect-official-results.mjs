/** Free source collection only. Publisher credentials must not reach this process. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {PUBLIC_EVIDENCE_JOURNAL_URL,validateRetainedJournal} from '../src/evidence-journal-feed.mjs';
import {officialWeeklyUrl,parseOfficialWeeklyPage} from '../src/nfl-official-finality.mjs';
import {validateOfficialResultLedger,appendOfficialResultObservations} from '../src/official-result-ledger.mjs';
const fail=code=>{throw Error(code);};
/** Preserve BOM and reject invalid UTF-8: receipt hashes must identify original bytes. */
export async function readExactText(response,limit){
 const length=Number(response.headers?.get('content-length'));
 if(Number.isFinite(length)&&length>limit)fail('OFFICIAL_COLLECTION_SOURCE_TOO_LARGE');
 const chunks=[];let size=0;
 if(!response.body?.getReader)fail('OFFICIAL_COLLECTION_STREAM_REQUIRED');
 const reader=response.body.getReader();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)fail('OFFICIAL_COLLECTION_SOURCE_TOO_LARGE');chunks.push(Buffer.from(value));}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 if(!Buffer.from(text,'utf8').equals(bytes))fail('OFFICIAL_COLLECTION_SOURCE_ENCODING_INVALID');
 return text;
}

export function assertCredentialFree(env){
 if(['GITHUB_TOKEN','GH_TOKEN','ODDS_API_KEY','BALLDONTLIE_API_KEY','Balldontlie_api_key'].some(k=>env[k]))fail('OFFICIAL_COLLECTION_CREDENTIALS_PRESENT');
}
export async function collectOfficialResults(ledger,{fetchImpl=fetch,clock=Date.now}={}){
 validateOfficialResultLedger(ledger,clock());
 const response=await fetchImpl(PUBLIC_EVIDENCE_JOURNAL_URL,{credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail('OFFICIAL_COLLECTION_JOURNAL_UNAVAILABLE');
 const journalText=await readExactText(response,5000000),journal=JSON.parse(journalText);
 validateRetainedJournal(journal,clock());
 const weeks=new Map();
 for(const s of journal.snapshots){
  const m=/^(20\d{2})_(0[1-9]|1[0-8])_/.exec(s.gameId);
  if(m&&Date.parse(s.commenceTime)<clock())weeks.set(m[1]+':'+m[2],{season:+m[1],week:+m[2]});
 }
 const scopes=[...weeks.values()].sort((a,b)=>a.season-b.season||a.week-b.week).slice(-18),receipts=[],failedWeeks=[];
 for(let i=0;i<scopes.length;i+=3){
  const batch=await Promise.all(scopes.slice(i,i+3).map(async scope=>{
   try{
    const sourceUrl=officialWeeklyUrl(scope.season,scope.week);
    const response=await fetchImpl(sourceUrl,{credentials:'omit',redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.timeout(15000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('SOURCE_HTTP');
    const html=await readExactText(response,8000000),observedAt=new Date(clock()).toISOString();
    return {receipt:parseOfficialWeeklyPage(html,{...scope,sourceUrl,observedAt})};
   }catch{return {failure:{...scope,reason:'OFFICIAL_WEEK_UNAVAILABLE_OR_INVALID'}};}
  }));
  for(const result of batch){if(result.receipt)receipts.push(result.receipt);else failedWeeks.push(result.failure);}
 }
 const now=clock(),next=appendOfficialResultObservations(ledger,journal,receipts,{now});
 const report={schema:1,collectedAt:new Date(now).toISOString(),journalSourceUrl:PUBLIC_EVIDENCE_JOURNAL_URL,
  journalBodySha256:createHash('sha256').update(journalText).digest('hex'),requestedWeeks:scopes,observedWeeks:receipts.map(r=>({season:r.season,week:r.week,observedAt:r.observedAt,sourceBodySha256:r.sourceBodySha256})),
  failedWeeks,degraded:failedWeeks.length>0,completeLeagueCoverageVerified:false,aggregateScoringEligible:false,providerCreditsUsed:0};
 return {ledger:next,report};
}
async function main(){
 assertCredentialFree(process.env);
 const [input,...extra]=process.argv.slice(2);if(!input||extra.length)fail('OFFICIAL_COLLECTION_ARGUMENTS_INVALID');
 const path=resolve(input),prior=JSON.parse(await readFile(path,'utf8'));
 const {ledger,report}=await collectOfficialResults(prior);
 await writeFile(path,JSON.stringify(ledger,null,2)+'\n');
 await writeFile(path+'.collection.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^OFFICIAL_COLLECTION_[A-Z0-9_]+$/.test(error.message)?error.message:'OFFICIAL_COLLECTION_FAILED');process.exitCode=1;});
