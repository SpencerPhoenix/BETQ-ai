/** Shared read/write evidence boundaries. Missing legacy provenance is not invented. */
import {validDay,isProbability} from './integrity.mjs';
export const MODEL_DELIVERY_IDENTITY_POLICY='NFL_ELO_CANONICAL_ARTIFACT_V1';
export const QUOTE_MAX_AGE_MS=600000;
export const MARKET_FRESHNESS_POLICY='ABSOLUTE_OLDEST_QUOTE_AT_CAPTURE_V1';
export const FINALITY_DELAY_MS=86400000;
export const FINAL_RECEIPT_BINDING_POLICY='FROZEN_RESULT_RECEIPT_V1';
export const canonicalTimestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;
  const time=Date.parse(value);
  return Number.isFinite(time)&&new Date(time).toISOString()===value?time:NaN;
};
const finite=Number.isFinite;
export function validFrozenIdentity(s){
  return Boolean(s&&typeof s.gameId==='string'&&s.gameId.length>0&&s.gameId.length<=140&&
    Number.isInteger(s.season)&&typeof s.home==='string'&&s.home.length>0&&
    typeof s.away==='string'&&s.away.length>0&&s.home!==s.away&&
    validDay(s.gameDate)&&finite(canonicalTimestamp(s.commenceTime)));
}
export function sameFrozenIdentity(a,b){
  return validFrozenIdentity(a)&&validFrozenIdentity(b)&&
    ['gameId','season','home','away','gameDate','commenceTime'].every(key=>a[key]===b[key]);
}
export const validProviderEventId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&
  value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
/** Missing legacy identity is unknown; it is never inferred from a new event. */
export function providerContinuityConflicts(snapshots){
  const byGame=new Map(),byProvider=new Map(),conflicts=new Map();
  const mark=(gameId,reason)=>{
    if(!conflicts.has(gameId))conflicts.set(gameId,new Set());
    conflicts.get(gameId).add(reason);
  };
  for(const shot of snapshots){
    if(!byGame.has(shot.gameId))byGame.set(shot.gameId,new Set());
    const provider=validProviderEventId(shot.providerEventId)?shot.providerEventId:null;
    byGame.get(shot.gameId).add(provider);
    if(provider!==null){
      if(!byProvider.has(provider))byProvider.set(provider,new Set());
      byProvider.get(provider).add(shot.gameId);
    }
  }
  for(const [gameId,providers] of byGame){
    if(providers.has(null))mark(gameId,'PROVIDER_EVENT_ID_UNVERIFIED');
    if([...providers].filter(id=>id!==null).length>1)mark(gameId,'PROVIDER_EVENT_ID_CHANGED');
  }
  for(const games of byProvider.values())if(games.size>1)
    for(const gameId of games)mark(gameId,'PROVIDER_EVENT_ID_REUSED');
  return conflicts;
}

/** Absolute constituent bounds, never an age inferred from a later fetch/build. */
export function validMarketQuoteWindow(s){
  const captured=canonicalTimestamp(s?.capturedAt),received=canonicalTimestamp(s?.sourceReceivedAt),
    oldest=canonicalTimestamp(s?.marketOldestQuoteAt),newest=canonicalTimestamp(s?.marketNewestQuoteAt);
  return [captured,received,oldest,newest].every(finite)&&
    oldest<=newest&&newest<=received&&received<=captured&&captured-oldest<=QUOTE_MAX_AGE_MS;
}
export function validSnapshotChronology(s,{requireProvenance=false,requireMarket=false}={}){
  if((s?.modelArtifactCanonicalSha256!=null||s?.modelDeliveryPolicy!=null)&&
    (typeof s.modelArtifactCanonicalSha256!=='string'||!/^[a-f0-9]{64}$/.test(s.modelArtifactCanonicalSha256)||s.modelDeliveryPolicy!==MODEL_DELIVERY_IDENTITY_POLICY))return false;
  const captured=canonicalTimestamp(s?.capturedAt),kick=canonicalTimestamp(s?.commenceTime);
  if(!finite(captured)||!finite(kick)||captured>=kick)return false;
  for(const field of ['sourceReceivedAt','modelBuiltAt','challengerBuiltAt','marketNewestQuoteAt','marketOldestQuoteAt']){
    if(s[field]==null)continue;
    const time=canonicalTimestamp(s[field]);
    if(!finite(time)||time>captured+60000||time>=kick)return false;
  }
  const received=canonicalTimestamp(s.sourceReceivedAt),built=canonicalTimestamp(s.modelBuiltAt),
    quote=canonicalTimestamp(s.marketNewestQuoteAt);
  if(finite(received)&&received<captured-QUOTE_MAX_AGE_MS)return false;
  if(finite(quote)&&(quote<captured-QUOTE_MAX_AGE_MS||
      (finite(received)&&quote>received+60000)))return false;
  if(s.modelLastResultDate!=null){
    if(!validDay(s.modelLastResultDate))return false;
    // A date-only result cutoff cannot certify any part of that same day.
    const end=Date.parse(s.modelLastResultDate+'T00:00:00.000Z')+86400000;
    if(end>captured||(finite(built)&&end>built))return false;
  }
  if(requireProvenance&&(!validFrozenIdentity(s)||!finite(received)||!finite(built)||
    !validDay(s.modelLastResultDate)||s.independentModel!==true||s.researchOnly!==true))return false;
  if(requireMarket&&(!validMarketQuoteWindow(s)||!finite(quote)||!finite(received)||!isProbability(s.marketHomeProbability)||
    s.marketBasis!=='NO_VIG_MULTI_BOOK_MEDIAN'||!Number.isInteger(s.marketBookCount)||s.marketBookCount<3))return false;
  return true;
}
export const isEligibleModelSnapshot=s=>isProbability(s?.modelHomeProbability)&&
  validSnapshotChronology(s,{requireProvenance:true});
export const isEligibleMarketSnapshot=s=>isEligibleModelSnapshot(s)&&
  validSnapshotChronology(s,{requireProvenance:true,requireMarket:true});
export const isEligibleChallengerSnapshot=s=>isEligibleModelSnapshot(s)&&
  isProbability(s.challengerHomeProbability)&&s.challengerResearchOnly===true&&
  finite(canonicalTimestamp(s.challengerBuiltAt));

/** New score records require an explicit terminal-state receipt, not scores alone. */
export function validNewFinalResult(result,snapshot,now){
  const receipt=result?.terminalStatusReceipt,observed=canonicalTimestamp(receipt?.observedAt),
    kick=canonicalTimestamp(snapshot?.commenceTime);
  return sameFrozenIdentity(result,snapshot)&&finite(now)&&now>=kick+FINALITY_DELAY_MS&&
    result.source==='NFLVERSE_SCHEDULES'&&receipt?.source==='NFLVERSE_SCHEDULES'&&
    receipt.bindingPolicy===FINAL_RECEIPT_BINDING_POLICY&&
    sameFrozenIdentity(receipt,snapshot)&&receipt.homeScore===result.homeScore&&receipt.awayScore===result.awayScore&&
    [result.homeScore,result.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=100)&&
    receipt.status==='FINAL'&&typeof receipt.sha256==='string'&&/^[a-f0-9]{64}$/.test(receipt.sha256)&&
    observed>=kick+FINALITY_DELAY_MS&&observed<=now+60000&&observed>=now-3600000;
}
