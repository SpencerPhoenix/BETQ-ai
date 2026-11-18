/** Manual-only zero-credit quota observation. Never authorizes spending or seeds a ledger. */
import {pathToFileURL} from 'node:url';
const ENDPOINT='https://api.the-odds-api.com/v4/sports/';
function counter(headers,name){
  const value=headers.get(name);
  return typeof value==='string' && /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
export async function probeOddsQuota({apiKey=process.env.ODDS_API_KEY,fetchImpl=globalThis.fetch,clock=Date.now}={}){
  // Reject control characters rather than normalizing an invalid credential.
  if(typeof apiKey!=='string'||!apiKey||apiKey.length>512||/[^\x21-\x7e]/.test(apiKey))
    return {ok:false,code:'MISSING_OR_INVALID_CREDENTIAL',requestSent:false};
  let response;
  try{
    response=await fetchImpl(ENDPOINT,{method:'GET',redirect:'error',
      headers:{Accept:'application/json','x-api-key':apiKey},signal:AbortSignal.timeout(10000)});
    // Do not consume, log, or persist provider bodies, including error bodies.
    const status=response.status;
    const remaining=counter(response.headers,'x-requests-remaining');
    const used=counter(response.headers,'x-requests-used');
    const last=counter(response.headers,'x-requests-last');
    if(status!==200)return {ok:false,code:'PROVIDER_REJECTED',httpStatus:status,requestSent:true};
    if(remaining===null||used===null||last===null)return {ok:false,code:'QUOTA_HEADERS_UNAVAILABLE',requestSent:true};
    return {ok:true,code:'QUOTA_OBSERVED',observedAt:new Date(clock()).toISOString(),
      remaining,used,last,documentedEndpointCost:0,plan:'NOT_REPORTED',
      requestSent:true,ledgerUpdated:false,spendingAuthorized:false};
  }catch{return {ok:false,code:'QUOTA_PROBE_FAILED',requestSent:true};}
  finally{try{await response?.body?.cancel();}catch{/* No response details may escape. */}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await probeOddsQuota();
  console.log(JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
}
