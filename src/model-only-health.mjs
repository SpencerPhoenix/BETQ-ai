/** Bounded diagnostics only. Never persist response bodies, headers or exception text. */
import {readBoundedText} from './integrity.mjs';
import {compareModelHealth} from './model-delivery.mjs';
import {GAME_CARD_ORIGIN} from './model-only-receipt.mjs';
// Render Free can take 50+ seconds to wake. One bounded, odds-free health read
// tolerates startup without retrying capture or changing any eligibility gate.
export const MODEL_ONLY_HEALTH_TIMEOUT_MS=75000;
export async function inspectModelOnlyHealth(artifact,{fetchImpl=fetch,clock=Date.now}={}){
 let httpStatus=null;
 const result=(compatible,reason)=>({compatible,reason,httpStatus});
 try{
  const response=await fetchImpl(GAME_CARD_ORIGIN+'/api/health',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(MODEL_ONLY_HEALTH_TIMEOUT_MS)});
  httpStatus=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;
  if(!response.ok){await response.body?.cancel().catch(()=>{});return result(false,'HEALTH_HTTP_ERROR');}
  const health=JSON.parse(await readBoundedText(response,250000));
  if(health?.modelOnlyCaptureSchema!==2)return result(false,'HEALTH_CAPTURE_SCHEMA_UNSUPPORTED');
  const match=compareModelHealth(artifact,health,clock());
  const reasons=new Set(['MODEL_HEALTH_TIME_INVALID_OR_STALE','RUNTIME_MODEL_DELIVERY_UNAVAILABLE','RUNTIME_MODEL_ARTIFACT_MISMATCH']);
  return result(match.compatible,match.compatible?null:reasons.has(match.reason)?match.reason:'EXPECTED_MODEL_UNAVAILABLE');
 }catch(error){
  return result(false,error?.name==='TimeoutError'||error?.name==='AbortError'?'HEALTH_TIMEOUT':error?.message==='BODY_TOO_LARGE'?'HEALTH_BODY_TOO_LARGE':error instanceof SyntaxError?'HEALTH_INVALID_JSON':'HEALTH_FETCH_OR_BODY_ERROR');
 }
}
export function modelOnlyRunStatus(ledger,runKey){
 const start=ledger.events.findIndex(e=>e.type==='RUN'&&e.payload.runKey===runKey);
 const events=start<0?[]:ledger.events.slice(start),run=events.filter(e=>e.type==='RUN'&&e.payload.runKey===runKey).at(-1);
 const count=type=>events.filter(e=>e.type===type).length;
 const counts=Object.fromEntries(['RESERVED','CAPTURED','CUSTODY','FINAL','CAPTURE_FAILED','MISSED'].map(type=>[type,count(type)]));
 const reasons=[];
 if(!run)reasons.push('RUN_RECORD_MISSING');
 else{
  if(run.payload.productionCompatible!==true)reasons.push('PRODUCTION_HEALTH_GATE_FAILED');
  if(run.payload.failedWeeks.length)reasons.push('OFFICIAL_WEEKS_UNAVAILABLE');
  if(run.payload.finalSourceAvailable===false)reasons.push('FINAL_SOURCE_UNAVAILABLE');
  if(run.payload.resultConflicts?.length)reasons.push('RESULT_CONFLICT');
  if(run.payload.scopeLimited)reasons.push('DISCOVERY_SCOPE_LIMITED');
 }
 if(events.some(e=>e.type==='MISSED'&&['WINDOW_ELAPSED','RESERVATION_UNRESOLVED'].includes(e.payload?.reason)))reasons.push('CAPTURE_WINDOW_MISSED');
 if(counts.CAPTURE_FAILED)reasons.push('CAPTURE_FAILED');
 const reservations=events.filter(e=>e.type==='RESERVED'),captures=events.filter(e=>e.type==='CAPTURED');
 if(reservations.some(r=>!events.some(e=>e.gameId===r.gameId&&['CAPTURED','CAPTURE_FAILED'].includes(e.type)&&e.payload?.reservationId===r.id)))reasons.push('RESERVATION_UNRESOLVED');
 if(captures.some(c=>!events.some(e=>e.type==='CUSTODY'&&e.gameId===c.gameId&&e.payload?.captureId===c.id)))reasons.push('CAPTURE_CUSTODY_UNCONFIRMED');
 return {runKey,status:reasons.length?'DEGRADED':counts.CAPTURED?'CAPTURED_WITH_CUSTODY':counts.FINAL?'FINAL_RESULTS_RECORDED':'HEARTBEAT_NO_CAPTURE',reasons,counts,productionHealth:run?.payload.productionHealth??null,paidRequests:0};
}
