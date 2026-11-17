import {createHash} from 'node:crypto';
import {readBoundedText} from './integrity.mjs';
import {modelLedgerSummary} from './scheduled-model-ledger.mjs';
export const MODEL_LEDGER_URL='https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/evidence/model-only-scheduled/ledger.json';
export function createScheduledModelFeed({fetchImpl=globalThis.fetch,clock=Date.now}={}){
 let cache=null,until=0,pending=null;
 return {async get(){
  if(cache&&clock()<until)return {...cache,schedulerStale:!cache.lastRunAt||clock()-Date.parse(cache.lastRunAt)>1800000};
  if(pending)return pending;
  pending=(async()=>{
   try{
    if(typeof fetchImpl!=='function')throw Error('NO_FEED');
    const response=await fetchImpl(MODEL_LEDGER_URL,{credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('UNAVAILABLE');const text=await readBoundedText(response,8000000),ledger=JSON.parse(text),now=clock();
    if(ledger.events?.some(e=>Date.parse(e.at)>now+1500))throw Error('FUTURE_LEDGER');
    const summary=modelLedgerSummary(ledger,now);
    cache={...summary,available:true,sourceUrl:MODEL_LEDGER_URL,remoteLedgerObservedAt:new Date(now).toISOString(),ledgerBodySha256:createHash('sha256').update(text).digest('hex'),
     custodyAssurance:'OPERATOR_OBSERVED_REMOTE_READBACK_NOT_INDEPENDENT_TIMESTAMP',publicationReadbackVerified:true};until=now+60000;return cache;
   }catch{cache=null;return {available:false,reason:'SCHEDULED_LEDGER_NOT_PUBLISHED_OR_UNVERIFIED',publicationReadbackVerified:false,marketEvidenceEligible:false,qualifiedScoringEligible:false,verifiedROI:null,verifiedCLV:null};}
   finally{pending=null;}
  })();return pending;
 }};
}
