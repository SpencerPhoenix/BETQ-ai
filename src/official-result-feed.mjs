/** Fixed public descriptive ledger reader. No provider credentials or write paths. */
import {createHash} from 'node:crypto';
import {readBoundedText} from './integrity.mjs';
import {validateOfficialResultLedger,assertOfficialResultLedgerAppend} from './official-result-ledger.mjs';
export const OFFICIAL_RESULT_LEDGER_URL='https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/evidence/official-results/ledger.json';
export function createOfficialResultFeed({fetchImpl=globalThis.fetch,clock=Date.now}={}){
 let accepted=null,until=0,pending=null,blocked=false;
 const validCache=()=>{if(!accepted)return null;try{validateOfficialResultLedger(accepted.ledger,clock());return accepted;}catch{blocked=true;return null;}};
 return {async get(){
  if(typeof fetchImpl!=='function')return {available:false,reason:'OFFICIAL_RESULT_LEDGER_DISABLED'};
  const cached=validCache();if(!blocked&&cached&&clock()<until)return structuredClone({...cached,cached:true});
  if(pending)return pending;
  pending=(async()=>{
   let response;
   try{if(typeof fetchImpl!=='function')throw Error('NO_FEED');response=await fetchImpl(OFFICIAL_RESULT_LEDGER_URL,{credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(response.status===404){if(!accepted&&!blocked)return {available:false,reason:'OFFICIAL_RESULT_LEDGER_NOT_PUBLISHED'};blocked=true;return {available:false,reason:'OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN'};}if(!response.ok)throw Error('HTTP_FAILURE');}
   catch{const prior=validCache();if(!blocked&&prior){accepted={...prior,refreshFailed:true};until=clock()+60000;return structuredClone({...accepted,cached:true});}return {available:false,reason:blocked?'OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN':'OFFICIAL_RESULT_LEDGER_UNAVAILABLE'};}
   try{
    const text=await readBoundedText(response,8000000),ledger=JSON.parse(text),now=clock();
    validateOfficialResultLedger(ledger,now);if(accepted)assertOfficialResultLedgerAppend(accepted.ledger,ledger,{now});
    blocked=false;accepted={available:true,ledger,sourceUrl:OFFICIAL_RESULT_LEDGER_URL,remoteObservedAt:new Date(now).toISOString(),bodySha256:createHash('sha256').update(text).digest('hex'),refreshFailed:false,cached:false};until=now+60000;
    return structuredClone(accepted);
   }catch{blocked=true;until=0;return {available:false,reason:'OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN'};}
  })().finally(()=>{pending=null;});return pending;
 }};
}
