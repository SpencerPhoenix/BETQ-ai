/** Exact artifact identity, not a signature, model promotion or historical-vintage proof. */
import {createHash} from 'node:crypto';
import {validDay} from './integrity.mjs';
import {predictNflEvent,MODEL_VERSION} from './nfl-elo.mjs';
import {canonicalTimestamp,MODEL_DELIVERY_IDENTITY_POLICY} from './evidence-integrity.mjs';
export const MODEL_DELIVERY_POLICY=MODEL_DELIVERY_IDENTITY_POLICY;
function canonical(v){
  if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('MODEL_ARTIFACT_VALUE_INVALID');
}
export function describeModelDelivery(artifact,now=Date.now()){
  try{
    const built=canonicalTimestamp(artifact?.generatedAt),cutoff=Date.parse(artifact?.lastGameDate+'T00:00:00.000Z')+86400000;
    if(!Number.isFinite(now)||!Number.isFinite(built)||built>now||!validDay(artifact?.lastGameDate)||!Number.isFinite(cutoff)||cutoff>built||
      artifact?.schema!==1||artifact.version!==MODEL_VERSION||artifact.source?.project!=='nflverse/nflverse-data')throw Error('invalid');
    const sample=predictNflEvent({home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders'},artifact,now);
    if(!sample.available)return {available:false,reason:sample.reason||'MODEL_UNAVAILABLE'};
    const encoded=canonical(artifact);if(encoded.length>2000000)throw Error('oversized');
    return {available:true,policy:MODEL_DELIVERY_POLICY,artifactCanonicalSha256:createHash('sha256').update(encoded).digest('hex'),
      modelVersion:artifact.version,modelBuiltAt:artifact.generatedAt,modelLastResultDate:artifact.lastGameDate,
      delivery:'DEPLOYMENT_BUNDLED',authentication:'RUNTIME_HTTPS_ASSERTION_NOT_INDEPENDENT_ATTESTATION',
      automaticPromotion:false};
  }catch{return {available:false,reason:'MODEL_DELIVERY_ARTIFACT_INVALID'};}
}
const identityKeys=['policy','artifactCanonicalSha256','modelVersion','modelBuiltAt','modelLastResultDate','delivery','authentication','automaticPromotion'];
export function compareModelDelivery(expectedArtifact,reported,now=Date.now()){
  const expected=describeModelDelivery(expectedArtifact,now);
  if(!expected.available)return {compatible:false,reason:'EXPECTED_'+expected.reason};
  if(reported?.available!==true)return {compatible:false,reason:'RUNTIME_MODEL_DELIVERY_UNAVAILABLE'};
  if(!identityKeys.every(k=>reported[k]===expected[k]))return {compatible:false,reason:'RUNTIME_MODEL_ARTIFACT_MISMATCH'};
  return {compatible:true,reason:null,identity:expected};
}
export function compareModelHealth(expectedArtifact,health,now=Date.now()){
  const at=canonicalTimestamp(health?.serverTime);
  if(!Number.isFinite(at)||at>now||at<now-60000)return {compatible:false,reason:'MODEL_HEALTH_TIME_INVALID_OR_STALE'};
  return compareModelDelivery(expectedArtifact,health?.nflModel?.deliveryIdentity,now);
}
/** Structural binding only. Does not independently authenticate the remote artifact. */
export function validProjectionDelivery(model,aggregate){
  const id=model?.deliveryIdentity;
  return id?.available===true&&aggregate?.available===true&&id.policy===MODEL_DELIVERY_POLICY&&
    typeof id.artifactCanonicalSha256==='string'&&/^[a-f0-9]{64}$/.test(id.artifactCanonicalSha256)&&
    identityKeys.every(k=>id[k]===aggregate[k])&&id.modelVersion===model.modelVersion&&
    id.modelBuiltAt===model.modelBuiltAt&&id.modelLastResultDate===model.throughGameDate&&
    id.delivery==='DEPLOYMENT_BUNDLED'&&id.automaticPromotion===false&&
    id.authentication==='RUNTIME_HTTPS_ASSERTION_NOT_INDEPENDENT_ATTESTATION';
}
export function assertSlateModelDelivery(slate,expectedArtifact,now=Date.now()){
  const match=compareModelDelivery(expectedArtifact,slate?.nflModelDelivery,now);
  if(!match.compatible)throw Error(match.reason);
  if(!Array.isArray(slate.events))throw Error('MODEL_SLATE_EVENTS_INVALID');
  for(const event of slate.events){
    const m=event?.independentModel;
    if(m?.available!==true){
      if(m?.available!==false&&m?.available!==undefined)throw Error('MODEL_AVAILABILITY_TYPE_INVALID');
      continue;
    }
    const paired=compareModelDelivery(expectedArtifact,m.deliveryIdentity,now);
    if(!paired.compatible||m.modelVersion!==match.identity.modelVersion||m.modelBuiltAt!==match.identity.modelBuiltAt||
      m.throughGameDate!==match.identity.modelLastResultDate)throw Error('MODEL_CHANGED_DURING_CAPTURE');
  }
  return match.identity;
}
