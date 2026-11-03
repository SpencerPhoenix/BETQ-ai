/**
 * OFF-by-default, synthetic-only evidence archive/replay proof.
 * No network, database, live-source adapter, environment activation or eval.
 * Hashes detect changes against a separately retained manifest digest; they
 * do not authenticate a publisher, wall clock, or real model performance.
 */
import {createHash} from 'node:crypto';

export const ARCHIVE_SCHEMA='betq-synthetic-evidence-archive-v1';
const MAX_BLOB_BYTES=65536,MAX_BLOBS=16,MAX_RECEIPTS=32,MAX_BUNDLE_BYTES=1200000;
const ROLES=new Set(['SYNTHETIC_FEATURES','SYNTHETIC_MODEL','SYNTHETIC_CODE',
  'SYNTHETIC_PRIMARY_FINAL','SYNTHETIC_SECONDARY_FINAL']);
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=code=>{throw Error(code);};
const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))fail('ARCHIVE_SCHEMA_INVALID');
};
const stamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    fail('ARCHIVE_TIMESTAMP_INVALID');
  const time=Date.parse(value);
  if(!Number.isFinite(time)||new Date(time).toISOString()!==value)fail('ARCHIVE_TIMESTAMP_INVALID');
  return time;
};
const game=value=>typeof value==='string'&&/^SYNTHETIC_[A-Z0-9_]{1,70}$/.test(value);
const number=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  fail('ARCHIVE_NON_JSON_VALUE');
}

/** The archived bytes identify this exact synthetic scorer, never loaded code. */
export function fixtureProbability(signal,intercept,slope){
  const z=intercept+slope*signal;
  if(!Number.isFinite(z)||Math.abs(z)>20)throw Error('SYNTHETIC_MODEL_RANGE');
  return Number((1/(1+Math.exp(-z))).toFixed(12));
}
export const syntheticCodePayload=()=>JSON.stringify({synthetic:true,source:fixtureProbability.toString()});

function parseSource(sourceKind,content){
  if(!ROLES.has(sourceKind))fail('SYNTHETIC_SOURCE_REQUIRED');
  if(typeof content!=='string'||Buffer.byteLength(content,'utf8')>MAX_BLOB_BYTES)
    fail('ARCHIVE_BLOB_SIZE_INVALID');
  if(Buffer.from(content,'utf8').toString('utf8')!==content)fail('ARCHIVE_UTF8_INVALID');
  let data;try{data=JSON.parse(content);}catch{fail('ARCHIVE_PAYLOAD_INVALID');}
  if(data?.synthetic!==true)fail('SYNTHETIC_PAYLOAD_REQUIRED');
  if(sourceKind==='SYNTHETIC_FEATURES'){
    exact(data,['synthetic','gameId','signal']);
    if(!game(data.gameId)||!number(data.signal,-10,10))fail('SYNTHETIC_FEATURES_INVALID');
  }else if(sourceKind==='SYNTHETIC_MODEL'){
    exact(data,['synthetic','modelId','intercept','slope','trainedThrough']);
    if(data.modelId!=='fixture-logit-v1'||!number(data.intercept,-10,10)||
      !number(data.slope,-5,5))fail('SYNTHETIC_MODEL_INVALID');
    stamp(data.trainedThrough);
  }else if(sourceKind==='SYNTHETIC_CODE'){
    exact(data,['synthetic','source']);
    if(data.source!==fixtureProbability.toString())fail('UNSUPPORTED_ARCHIVED_CODE');
  }else{
    exact(data,['synthetic','gameId','kickoffAt','completed','homeScore','awayScore']);
    if(!game(data.gameId)||data.completed!==true||
      ![data.homeScore,data.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=100))
      fail('SYNTHETIC_FINAL_INVALID');
    stamp(data.kickoffAt);
  }
  return data;
}

const receiptKeys=['receiptId','sourceKind','blobSha256','collectorReceivedAt',
  'publisherPublishedAt','publicationTimeVerified'];
function validateReceipt(receipt,blobs){
  exact(receipt,receiptKeys);
  const {receiptId,...identity}=receipt;
  if(!digest(receiptId)||hash(canonical(identity))!==receiptId)fail('RECEIPT_HASH_MISMATCH');
  if(receipt.publisherPublishedAt!==null||receipt.publicationTimeVerified!==false)
    fail('UNVERIFIED_PUBLICATION_TIME');
  stamp(receipt.collectorReceivedAt);
  const blob=blobs.get(receipt.blobSha256);
  if(!blob)fail('MISSING_ARCHIVE_BLOB');
  return parseSource(receipt.sourceKind,blob.content);
}
function resolveReceipt(id,role,receipts,blobs){
  const receipt=receipts.get(id);
  if(!receipt||receipt.sourceKind!==role)fail('MISSING_OR_WRONG_SOURCE_RECEIPT');
  return {receipt,data:validateReceipt(receipt,blobs)};
}
const forecastKeys=['forecastId','gameId','frozenAt','kickoffAt','inputReceiptId',
  'modelReceiptId','codeReceiptId','homeProbability'];
function forecastRecord(input,receipts,blobs){
  exact(input,['gameId','frozenAt','kickoffAt','inputReceiptId','modelReceiptId','codeReceiptId']);
  if(!game(input.gameId)||stamp(input.frozenAt)>=stamp(input.kickoffAt))fail('FORECAST_NOT_PREGAME');
  const features=resolveReceipt(input.inputReceiptId,'SYNTHETIC_FEATURES',receipts,blobs);
  const model=resolveReceipt(input.modelReceiptId,'SYNTHETIC_MODEL',receipts,blobs);
  const code=resolveReceipt(input.codeReceiptId,'SYNTHETIC_CODE',receipts,blobs);
  if(features.data.gameId!==input.gameId)fail('FORECAST_GAME_MISMATCH');
  for(const item of [features,model,code])
    if(stamp(item.receipt.collectorReceivedAt)>stamp(input.frozenAt))fail('FUTURE_FORECAST_INPUT');
  if(stamp(model.data.trainedThrough)>stamp(model.receipt.collectorReceivedAt))fail('FUTURE_MODEL_CUTOFF');
  const identity={...input,homeProbability:fixtureProbability(features.data.signal,
    model.data.intercept,model.data.slope)};
  return {forecastId:hash(canonical(identity)),...identity};
}
const settlementKeys=['settlementId','forecastId','verifiedAt','primaryReceiptId',
  'secondaryReceiptId','homeScore','awayScore','outcome'];
function settlementRecord(input,forecast,receipts,blobs){
  exact(input,['forecastId','verifiedAt','primaryReceiptId','secondaryReceiptId']);
  if(!forecast||input.forecastId!==forecast.forecastId)fail('SETTLEMENT_FORECAST_MISMATCH');
  if(input.primaryReceiptId===input.secondaryReceiptId)fail('DISTINCT_RECEIPTS_REQUIRED');
  const primary=resolveReceipt(input.primaryReceiptId,'SYNTHETIC_PRIMARY_FINAL',receipts,blobs);
  const secondary=resolveReceipt(input.secondaryReceiptId,'SYNTHETIC_SECONDARY_FINAL',receipts,blobs);
  for(const item of [primary,secondary]){
    if(item.data.gameId!==forecast.gameId||item.data.kickoffAt!==forecast.kickoffAt)
      fail('SETTLEMENT_GAME_MISMATCH');
    const received=stamp(item.receipt.collectorReceivedAt);
    if(received<stamp(forecast.kickoffAt)||received>stamp(input.verifiedAt))fail('SETTLEMENT_CHRONOLOGY_INVALID');
  }
  const {homeScore,awayScore}=primary.data;
  if(homeScore!==secondary.data.homeScore||awayScore!==secondary.data.awayScore)
    fail('FINAL_SOURCE_DISAGREEMENT');
  const identity={...input,homeScore,awayScore,
    outcome:homeScore===awayScore?'TIE':homeScore>awayScore?'HOME':'AWAY'};
  return {settlementId:hash(canonical(identity)),...identity};
}

export function createSyntheticEvidenceArchive({enabled=false}={}){
  if(typeof enabled!=='boolean')fail('EXPLICIT_BOOLEAN_ENABLE_REQUIRED');
  const blobs=new Map(),receipts=new Map();
  let forecast=null,settlement=null;
  const requireEnabled=()=>{if(!enabled)fail('EVIDENCE_ARCHIVE_DISABLED');};
  return {
    status:()=>({enabled,syntheticOnly:true,liveCaptureEnabled:false,durableStorageConfigured:false}),
    appendReceipt(input){
      requireEnabled();
      exact(input,['sourceKind','content','collectorReceivedAt']);
      const {sourceKind,content,collectorReceivedAt}=input;
      parseSource(sourceKind,content);stamp(collectorReceivedAt);
      const blobSha256=hash(content);
      const identity={sourceKind,blobSha256,collectorReceivedAt,
        publisherPublishedAt:null,publicationTimeVerified:false};
      const receipt={receiptId:hash(canonical(identity)),...identity};
      if((!blobs.has(blobSha256)&&blobs.size>=MAX_BLOBS)||
        (!receipts.has(receipt.receiptId)&&receipts.size>=MAX_RECEIPTS))fail('ARCHIVE_CAPACITY_EXCEEDED');
      // Mutate only after all checks pass; identical retries are idempotent.
      if(!blobs.has(blobSha256))blobs.set(blobSha256,{sha256:blobSha256,
        byteLength:Buffer.byteLength(content,'utf8'),content});
      if(!receipts.has(receipt.receiptId))receipts.set(receipt.receiptId,receipt);
      return structuredClone(receipt);
    },
    freezeForecast(input){
      requireEnabled();
      const next=forecastRecord(input,receipts,blobs);
      if(forecast&&forecast.forecastId!==next.forecastId)fail('FORECAST_ALREADY_FROZEN');
      forecast=next;return structuredClone(forecast);
    },
    freezeSettlement(input){
      requireEnabled();
      const next=settlementRecord(input,forecast,receipts,blobs);
      if(settlement&&settlement.settlementId!==next.settlementId)fail('SETTLEMENT_ALREADY_FROZEN');
      settlement=next;return structuredClone(settlement);
    },
    exportBundle(){
      requireEnabled();
      if(!forecast||!settlement)fail('ARCHIVE_BUNDLE_INCOMPLETE');
      const body={schema:ARCHIVE_SCHEMA,syntheticOnly:true,
        blobs:[...blobs.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256)),
        receipts:[...receipts.values()].sort((a,b)=>a.receiptId.localeCompare(b.receiptId)),
        forecast,settlement};
      const bundle={...body,manifestSha256:hash(canonical(body))};
      if(Buffer.byteLength(JSON.stringify(bundle),'utf8')>MAX_BUNDLE_BYTES)fail('ARCHIVE_BUNDLE_TOO_LARGE');
      return structuredClone(bundle);
    }
  };
}

/** Verify bytes and references before replay. Never execute archived code. */
export function replaySyntheticEvidence(bundle,{expectedManifestSha256}={}){
  if(!digest(expectedManifestSha256))fail('EXPECTED_MANIFEST_REQUIRED');
  exact(bundle,['schema','syntheticOnly','blobs','receipts','forecast','settlement','manifestSha256']);
  if(bundle.schema!==ARCHIVE_SCHEMA||bundle.syntheticOnly!==true||
    !Array.isArray(bundle.blobs)||!Array.isArray(bundle.receipts)||
    bundle.blobs.length>MAX_BLOBS||bundle.receipts.length>MAX_RECEIPTS)fail('ARCHIVE_SCHEMA_INVALID');
  if(Buffer.byteLength(JSON.stringify(bundle),'utf8')>MAX_BUNDLE_BYTES)fail('ARCHIVE_BUNDLE_TOO_LARGE');
  const {manifestSha256,...body}=bundle;
  if(manifestSha256!==expectedManifestSha256||hash(canonical(body))!==expectedManifestSha256)
    fail('MANIFEST_HASH_MISMATCH');
  const blobs=new Map(),receipts=new Map();
  for(const blob of bundle.blobs){
    exact(blob,['sha256','byteLength','content']);
    if(typeof blob.content!=='string'||Buffer.byteLength(blob.content,'utf8')>MAX_BLOB_BYTES||
      Buffer.byteLength(blob.content,'utf8')!==blob.byteLength||hash(blob.content)!==blob.sha256)
      fail('BLOB_HASH_MISMATCH');
    if(blobs.has(blob.sha256))fail('DUPLICATE_ARCHIVE_BLOB');
    blobs.set(blob.sha256,blob);
  }
  for(const receipt of bundle.receipts){
    validateReceipt(receipt,blobs);
    if(receipts.has(receipt.receiptId))fail('DUPLICATE_ARCHIVE_RECEIPT');
    receipts.set(receipt.receiptId,receipt);
  }
  const referencedBlobs=new Set(bundle.receipts.map(r=>r.blobSha256));
  if([...blobs.keys()].some(id=>!referencedBlobs.has(id)))fail('UNREFERENCED_ARCHIVE_BLOB');
  exact(bundle.forecast,forecastKeys);
  const {forecastId,homeProbability,...input}=bundle.forecast;
  const forecast=forecastRecord(input,receipts,blobs);
  if(forecast.forecastId!==forecastId||forecast.homeProbability!==homeProbability)
    fail('FROZEN_FORECAST_REPLAY_MISMATCH');
  exact(bundle.settlement,settlementKeys);
  const {settlementId,homeScore,awayScore,outcome,...resultInput}=bundle.settlement;
  const settlement=settlementRecord(resultInput,forecast,receipts,blobs);
  if(settlement.settlementId!==settlementId||settlement.homeScore!==homeScore||
    settlement.awayScore!==awayScore||settlement.outcome!==outcome)fail('SETTLEMENT_REPLAY_MISMATCH');
  return {schema:ARCHIVE_SCHEMA,verified:true,syntheticOnly:true,manifestSha256,
    archivedBlobs:blobs.size,distinctReceipts:receipts.size,
    forecastId,homeProbability,settlementId,outcome,
    publisherAuthenticityVerified:false,collectorClockAttested:false,
    productionModelValidated:false,liveCaptureEnabled:false,paidRequests:0,
    wageringAuthorized:false,verifiedROI:null,verifiedCLV:null};
}
