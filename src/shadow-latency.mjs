/**
 * BETQ prospective point-in-time shadow evidence — pure validation.
 *
 * NEVER treat bookmaker last_update as the time BETQ first saw an offer.
 * A cached Odds API response is not a new quote observation.
 * Records contain bookmaker-identifiable prices and MUST ONLY go to a private
 * durable source-approved store, NEVER public GitHub or an HTTP response.
 */
import {createHash} from 'node:crypto';
import {noVigPair,toDecimal} from './engine.mjs';

export const SHADOW_SCHEMA='betq-shadow-v1';
const finite=Number.isFinite;
const iso=(ms)=>new Date(ms).toISOString();
const parse=(v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(v)?
  Date.parse(v):NaN;
const safeText=(v,max=100)=>typeof v==='string'&&v.trim().length>0&&v.length<=max?v.trim():null;
const digest=(v)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const validPrice=(v)=>Number.isInteger(v)&&Math.abs(v)>=100&&Math.abs(v)<=50000;
const allowedQbState=new Set(['OUT','INACTIVE','STARTER_CHANGE','STARTER_CONFIRMED','QUESTIONABLE']);
const sourceKinds=new Set(['NFL_OFFICIAL','TEAM_OFFICIAL']);
const HTTPS=/^https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?$/i;
const trustedOfficialURL=(url)=>{
  try{
    const x=new URL(url);
    return x.protocol==='https:'&&x.username===''&&x.password===''&&
      (x.hostname==='nfl.com'||x.hostname==='www.nfl.com'||
       x.hostname==='operations.nfl.com'||x.hostname.endsWith('.nfl.com'));
  }catch{return false;}
};

export class ShadowValidationError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,msg)=>{throw new ShadowValidationError(code,msg);};

/**
 * Transform ONLY the actual provider getOdds() snapshot already returned to
 * an existing live slate query. No provider API requests occur here.
 *
 * snapshot.receivedAt is assigned by the trusted OddsSource after a completed
 * upstream response; never substitute the viewing clock.
 */
export function normalizeOwnedOddsSnapshot(snapshot,{
  sport='americanfootball_nfl',market='h2h',
  now=Date.now(),maxAgeMs=600000
}={}){
  if(sport!=='americanfootball_nfl'||market!=='h2h')
    return {records:[],scanned:0,rejected:0,reason:'UNSUPPORTED_STUDY_SCOPE'};
  if(!snapshot||snapshot.cacheHit===true)
    return {records:[],scanned:0,rejected:0,reason:'CACHED_OR_MISSING_SNAPSHOT'};
  if(!Array.isArray(snapshot.events)||snapshot.events.length>150||
     !finite(now)||!finite(maxAgeMs)||maxAgeMs<1000||maxAgeMs>3600000)
    fail('INVALID_SNAPSHOT','Invalid source snapshot or quota policy.');
  const received=parse(snapshot.receivedAt);
  if(!finite(received)||received>now+60000||now-received>maxAgeMs)
    return {records:[],scanned:0,rejected:0,reason:'RECEIPT_TIMESTAMP_STALE'};
  const records=[];let scanned=0,rejected=0;
  const seenEventIds=new Set();
  for(const event of snapshot.events){
    if(!event||typeof event!=='object'){rejected++;continue;}
    const eventId=safeText(event.id,160),home=safeText(event.home_team,120),
      away=safeText(event.away_team,120),kickoff=parse(event.commence_time);
    if(!eventId||seenEventIds.has(eventId)||!home||!away||home===away||
       !finite(kickoff)||kickoff-received<300000||kickoff-received>120*86400000||
       !Array.isArray(event.bookmakers)||event.bookmakers.length>80){
      rejected++;continue;
    }
    seenEventIds.add(eventId);
    const seenBookKeys=new Set();
    for(const bookmaker of event.bookmakers){
      scanned++;
      const book=safeText(bookmaker?.key,80);
      if(!book||seenBookKeys.has(book)){rejected++;continue;}
      seenBookKeys.add(book);
      const list=Array.isArray(bookmaker?.markets)?
        bookmaker.markets.filter(m=>m?.key==='h2h'):[];
      if(list.length!==1){rejected++;continue;}
      const m=list[0];
      if(!Array.isArray(m.outcomes)||m.outcomes.length!==2){rejected++;continue;}
      const pHome=m.outcomes.find(x=>x?.name===home);
      const pAway=m.outcomes.find(x=>x?.name===away);
      const providerAt=parse(m.last_update||'');
      if(!pHome||!pAway||!validPrice(pHome.price)||!validPrice(pAway.price)||
         !finite(providerAt)||providerAt>received+60000||
         received-providerAt>maxAgeMs||providerAt>=kickoff){rejected++;continue;}
      const pair=noVigPair(pHome.price,pAway.price);
      if(!pair||!pair.every(finite)){rejected++;continue;}
      const margin=1/toDecimal(pHome.price)+1/toDecimal(pAway.price)-1;
      if(margin<-.015||margin>.18){rejected++;continue;}
      const record={
        schema:SHADOW_SCHEMA,
        sport,eventId,homeTeam:home,awayTeam:away,
        market:'h2h',period:'FULL_GAME',exactLine:null,
        bookmakerKey:book,
        homeAmerican:pHome.price,awayAmerican:pAway.price,
        kickoffAt:iso(kickoff),
        sourceMarketUpdatedAt:iso(providerAt),
        firstObservedAt:iso(received),
        bookmakerAvailability:'UNKNOWN_NOT_ATTESTED',
        realWagerFillVerified:false,
        quoteProvenance:'ODDS_PROVIDER_MARKET_UPDATE_NOT_EXECUTABLE_OFFER',
        fairHomeProbability:Number(pair[0].toFixed(7)),
        fairAwayProbability:Number(pair[1].toFixed(7))
      };
      record.recordId=digest([
        record.sport,eventId,book,'h2h','FULL_GAME',
        record.sourceMarketUpdatedAt,pHome.price,pAway.price
      ]);
      record.payloadDigest=digest([
        eventId,home,away,record.kickoffAt,book,
        record.homeAmerican,record.awayAmerican,record.sourceMarketUpdatedAt
      ]);
      records.push(record);
    }
  }
  return {records,scanned,rejected,
    sourceReceivedAt:iso(received),
    reason:records.length?'PRIVATE_ONLY_RESEARCH_RECORDS':'NO_VALID_PRE_KICKOFF_QUOTES'};
}

/**
 * Candidate news event is *never* promoted to verified starter status by
 * model inference or untrusted client data. Must be collected by a separate
 * source-vetted private process and reviewed by an authorized human.
 */
export function makeQBCandidateNews(input,{observedAt=Date.now()}={}){
  if(!input||typeof input!=='object'||!finite(observedAt))
    fail('INVALID_NEWS','Invalid QB news observation.');
  const eventId=safeText(input.eventId,160),team=safeText(input.team,100),
    qb=safeText(input.qbName,120),state=input.status,
    sourceUrl=safeText(input.sourceUrl,1024),kind=input.sourceKind;
  const kickoff=parse(input.kickoffAt),published=input.sourcePublishedAt==null?
    null:parse(input.sourcePublishedAt);
  if(!eventId||!team||!qb||!allowedQbState.has(state)||
     !sourceUrl||!HTTPS.test(sourceUrl)||!sourceKinds.has(kind)||
     !trustedOfficialURL(sourceUrl)||!finite(kickoff)||kickoff-observedAt<300000||
     kickoff-observedAt>120*86400000||
     (published!==null&&(!finite(published)||published>observedAt+60000)))
    fail('INVALID_NEWS','QB candidate lacks valid scope, official source URL or chronology.');
  const record={
    schema:SHADOW_SCHEMA,eventId,team,qbName:qb,status:state,
    sourceUrl,sourceKind:kind,
    kickoffAt:iso(kickoff),
    firstObservedAt:iso(observedAt),
    sourcePublishedAt:published===null?null:iso(published),
    verificationStatus:'AWAITING_INDEPENDENT_SOURCE_REVIEW',
    firstPublicationVerified:false,
    startingQuarterbackConfirmed:false,
    notPreviouslyKnowable:false,
    marketEffectMeasured:false
  };
  record.recordId=digest([
    eventId,team,qb,state,sourceUrl,record.firstObservedAt
  ]);
  return record;
}

/** Only for offline/private code with separately audited review evidence. */
export function reviewQBCandidate(candidate,{
  reviewerId,reviewedAt=Date.now(),sourceEvidenceDigest
}={}){
  const id=safeText(reviewerId,100),evidence=safeText(sourceEvidenceDigest,100);
  const when=parse(candidate?.firstObservedAt);
  if(candidate?.schema!==SHADOW_SCHEMA||
     candidate?.verificationStatus!=='AWAITING_INDEPENDENT_SOURCE_REVIEW'||
     !id||!/^[a-f0-9]{64}$/i.test(evidence||'')||
     !finite(reviewedAt)||!finite(when)||reviewedAt<when)
    fail('UNVERIFIED_SOURCE','Official source review has not been independently attested.');
  return {
    recordId:candidate.recordId,reviewerId:id,
    reviewedAt:iso(reviewedAt),
    sourceEvidenceDigest:evidence.toLowerCase(),
    reviewStatus:'OFFICIAL_SOURCE_REVIEWED',
    determination:'SOURCE_REVIEW_ONLY_NOT_STARTER_CERTAINTY',
    genuineMarketEdgeEstablished:false
  };
}

export function isPublicSafeShadowSummary(s){
  return Boolean(s&&s.schema===1&&
    typeof s.available==='boolean'&&
    s.rawBookmakerQuotesExposed===false&&
    s.realMoneyROI===null&&s.verifiedCLV===null&&s.wageringAuthorized===false&&
    typeof s.captureEnabled==='boolean'&&
    typeof s.durableStorage==='boolean');
}
