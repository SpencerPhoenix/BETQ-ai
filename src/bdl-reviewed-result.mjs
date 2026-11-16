/** Public derived result review. No transport, private archives, or aggregate-policy activation. */
import {createHash} from 'node:crypto';
import {canonicalTimestamp,sameFrozenIdentity,validFrozenIdentity,FINALITY_DELAY_MS,providerContinuityConflicts} from './evidence-integrity.mjs';
import {nflGameDate} from './integrity.mjs';
import {NFL_TEAMS} from './nfl-elo.mjs';
import {isSourceCorroboratedSettlement,OUTCOME_SCORING_POLICY,latestSettlementsByRevision} from './settlement-qualification.mjs';

export const BDL_REVIEWED_RESULT_POLICY='BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1';
const SOURCE='BALLDONTLIE_NFLVERSE_REVIEWED';
const identity=['gameId','season','gameDate','home','away','commenceTime'];
const plain=v=>Boolean(v&&Object.getPrototypeOf(v)===Object.prototype);
const exact=(v,keys)=>plain(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');
});
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>Number.isSafeInteger(v)&&v>0;
const score=v=>Number.isInteger(v)&&v>=0&&v<=100;
const teams=new Set(Object.values(NFL_TEAMS));
/** Sorted-key JSON digest compatible with the private ledger, without importing it. */
export function reviewedResultDigest(value){
  let nodes=0,chars=0;
  function canonical(v,depth=0){
    if(++nodes>10000||depth>20)throw Error('REVIEW_DIGEST_LIMIT');
    let text;
    if(v===null||typeof v==='boolean'||typeof v==='string'||(typeof v==='number'&&Number.isFinite(v)))text=JSON.stringify(v);
    else if(Array.isArray(v)){
      if(Object.getPrototypeOf(v)!==Array.prototype||v.length>10000||Reflect.ownKeys(v).length!==v.length+1)throw Error('INVALID_REVIEW_DATA');
      const items=[];
      for(let i=0;i<v.length;i++){
        const d=Object.getOwnPropertyDescriptor(v,String(i));
        if(!d?.enumerable||!Object.hasOwn(d,'value'))throw Error('INVALID_REVIEW_DATA');
        items.push(canonical(d.value,depth+1));
      }
      text='['+items.join(',')+']';
    }
    else if(plain(v)){
      const keys=Reflect.ownKeys(v);
      if(keys.some(k=>typeof k!=='string'||!Object.getOwnPropertyDescriptor(v,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value')))throw Error('INVALID_REVIEW_DATA');
      text='{'+keys.sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
    }else throw Error('INVALID_REVIEW_DATA');
    chars+=text.length;if(chars>1000000)throw Error('REVIEW_DIGEST_LIMIT');return text;
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function isReviewedBdlSettlement(r,s){
  try{
    if(!exact(r,[...identity,'source','policyId','homeScore','awayScore','outcome','verifiedAt','revision','resultHash',
      'nativeFinalObservation','communityScoreObservation','review','researchOnly','qualifiesForAggregateScoring',
      'sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified','sourceAuthenticityIndependentlyVerified','providerPublicationTimeVerified']))return false;
    if(r.source!==SOURCE||r.policyId!==BDL_REVIEWED_RESULT_POLICY||r.researchOnly!==true||
      ['qualifiesForAggregateScoring','sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified','sourceAuthenticityIndependentlyVerified','providerPublicationTimeVerified'].some(k=>r[k]!==false)||
      !Number.isSafeInteger(r.revision)||r.revision<1||typeof s?.id!=='string'||!s.id||s.id.length>200||!sameFrozenIdentity(r,s)||!validFrozenIdentity(s))return false;
    if(!score(r.homeScore)||!score(r.awayScore)||r.outcome!==(r.homeScore===r.awayScore?'TIE':r.homeScore>r.awayScore?'HOME':'AWAY'))return false;
    const scoreHash=createHash('sha256').update(r.gameId+'|'+r.homeScore+'|'+r.awayScore).digest('hex').slice(0,24);
    if(r.resultHash!==scoreHash)return false;
    const at=canonicalTimestamp(r.verifiedAt),kick=canonicalTimestamp(s.commenceTime),captured=canonicalTimestamp(s.capturedAt);
    const parts=/^(\d{4})_(\d{2})_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(r.gameId);
    if(!parts||Number(parts[1])!==s.season||Number(parts[2])<1||Number(parts[2])>22||parts[3]!==s.away||parts[4]!==s.home||
      !teams.has(s.home)||!teams.has(s.away)||!Number.isFinite(at)||!Number.isFinite(captured)||captured>=kick||at<kick+FINALITY_DELAY_MS||
      nflGameDate({commence_time:s.commenceTime})!==s.gameDate)return false;
    const year=new Date(kick).getUTCFullYear(),month=new Date(kick).getUTCMonth();
    if(s.season!==year-(month<2?1:0))return false;
    const n=r.nativeFinalObservation,c=r.communityScoreObservation,v=r.review;
    if(!exact(n,['source','providerGameId','providerHomeTeamId','providerAwayTeamId','home','away','season','postseason',
      'providerScheduledKickoff','statusState','status','homeScore','awayScore','providerRecordUpdatedAt','collectorRetrievedAt',
      'providerPublicationTimeVerified','providerStatusChangedAt','sourceFreshnessVerified','bodySha256'])||
      !exact(c,['source','gameId','season','gameDate','home','away','gameType','homeScore','awayScore','collectorRetrievedAt',
        'bodySha256','providerPublicationTimeVerified','explicitFinalStatusObserved','exactKickoffObserved'])||
      !exact(v,['firstFrozenSnapshotId','firstFrozenSnapshotSha256','receiptSha256','ledgerEntrySha256','ledgerSha256',
        'encryptedArtifactSha256','retainedResultSha256','allFrozenSnapshotsSha256','recordedAt','githubRepository','githubRunId','githubCommitSha','githubRunUrl']))return false;
    if(n.source!=='BALLDONTLIE_NFL_GAMES'||c.source!=='NFLVERSE_SCHEDULES'||
      ![n.providerGameId,n.providerHomeTeamId,n.providerAwayTeamId].every(id)||n.providerHomeTeamId===n.providerAwayTeamId||
      ['home','away','season'].some(k=>n[k]!==s[k])||['gameId','season','gameDate','home','away'].some(k=>c[k]!==s[k])||
      n.providerScheduledKickoff!==s.commenceTime||n.statusState!=='final'||typeof n.status!=='string'||!/^Final(?:\/(?:[1-9]\d?)?OT)?$/.test(n.status)||
      !['REG','WC','DIV','CON','SB'].includes(c.gameType)||n.postseason!==(c.gameType!=='REG')||
      [n,c].some(o=>o.homeScore!==r.homeScore||o.awayScore!==r.awayScore)||
      (n.postseason&&r.outcome==='TIE'))return false;
    if(n.providerPublicationTimeVerified!==false||n.providerStatusChangedAt!==null||n.sourceFreshnessVerified!==false||
      c.providerPublicationTimeVerified!==false||c.explicitFinalStatusObserved!==false||c.exactKickoffObserved!==false)return false;
    for(const o of [n,c]){
      const observed=canonicalTimestamp(o.collectorRetrievedAt);
      if(!digest(o.bodySha256)||!Number.isFinite(observed)||observed<kick+FINALITY_DELAY_MS||observed>at||observed<at-3600000)return false;
    }
    const updated=canonicalTimestamp(n.providerRecordUpdatedAt);
    if(!Number.isFinite(updated)||updated<kick||updated>canonicalTimestamp(n.collectorRetrievedAt))return false;
    if(v.firstFrozenSnapshotId!==s.id||v.firstFrozenSnapshotSha256!==reviewedResultDigest(s)||v.recordedAt!==r.verifiedAt||
      !['receiptSha256','ledgerEntrySha256','ledgerSha256','encryptedArtifactSha256','allFrozenSnapshotsSha256'].every(k=>digest(v[k]))||
      !(v.retainedResultSha256===null||digest(v.retainedResultSha256))||
      v.githubRepository!=='SpencerPhoenix/BETQ-ai'||typeof v.githubRunId!=='string'||!/^\d{1,20}$/.test(v.githubRunId)||v.githubRunId[0]==='0'||
      typeof v.githubCommitSha!=='string'||!/^[a-f0-9]{40}$/.test(v.githubCommitSha)||
      v.githubRunUrl!=='https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/'+v.githubRunId)return false;
    return true;
  }catch{return false;}
}
export const isDescriptivelyQualifiedSettlement=(record,snapshot)=>isSourceCorroboratedSettlement(record,snapshot)||isReviewedBdlSettlement(record,snapshot);
export function describeReviewedSettlement(record,snapshot){
  const legacy=isSourceCorroboratedSettlement(record,snapshot),bdl=isReviewedBdlSettlement(record,snapshot);
  if(!legacy&&!bdl)return null;
  return {policyId:bdl?BDL_REVIEWED_RESULT_POLICY:OUTCOME_SCORING_POLICY,source:record.source,
    label:bdl?'BDL native final + nflverse score agreement':'Source-corroborated final result',
    descriptivelyQualified:true,aggregateScoringEligible:legacy,sourceIndependenceVerified:false,
    officialLeagueCertification:false,historicalAsOfVerified:false,sourceAuthenticityIndependentlyVerified:false,
    providerPublicationTimeVerified:false,verifiedAt:record.verifiedAt,
    githubRunUrl:bdl?record.review.githubRunUrl:null};
}


/** A new wrapper cannot make observations older than a retained correction current. */
export function assertReviewedBdlRevisionTimes(record,prior,priorReview){
  const at=canonicalTimestamp(record.verifiedAt),times=[record.nativeFinalObservation.collectorRetrievedAt,
    record.communityScoreObservation.collectorRetrievedAt].map(canonicalTimestamp);
  if(prior&&times.some(t=>t<canonicalTimestamp(prior.verifiedAt)))throw Error('REVIEWED_BDL_RECEIPT_PREDATES_RETAINED_RESULT');
  if(priorReview&&(at<=canonicalTimestamp(priorReview.verifiedAt)||
    times.some(t=>t<canonicalTimestamp(priorReview.verifiedAt))||
    times[0]<=canonicalTimestamp(priorReview.nativeFinalObservation.collectorRetrievedAt)||
    times[1]<=canonicalTimestamp(priorReview.communityScoreObservation.collectorRetrievedAt)))
    throw Error('REVIEWED_BDL_BACKDATED_OR_REUSED_SOURCE_RECEIPT');
}

/** Verify the published assertion against its retained context, not just its shape. */
export function assertReviewedBdlJournalContext(journal,now){
  const reviews=journal.settlements.filter(r=>r.source==='BALLDONTLIE_NFLVERSE_REVIEWED'||r.policyId===BDL_REVIEWED_RESULT_POLICY||r.review!==undefined);
  if(!reviews.length)return;
  const conflicts=providerContinuityConflicts(journal.snapshots),seenReceipts=new Set(),nativeGames=new Map(),nativeTeams=new Map(),teamIds=new Map();
  for(const r of reviews){
    const shots=journal.snapshots.filter(s=>s.gameId===r.gameId)
      .sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0));
    const first=shots[0];
    if(!isReviewedBdlSettlement(r,first)||!Number.isFinite(now)||canonicalTimestamp(r.verifiedAt)>now||
      conflicts.has(r.gameId)||shots.some(s=>!sameFrozenIdentity(s,first))||journal.snapshots.some(s=>
        s.gameId!==r.gameId&&s.season===first.season&&s.home===first.home&&s.away===first.away&&s.commenceTime===first.commenceTime))
      throw Error('INVALID_REVIEWED_BDL_CONTEXT');
    const prior=latestSettlementsByRevision(journal.settlements.filter(p=>p.gameId===r.gameId&&p.revision<r.revision)).get(r.gameId);
    if(r.revision!==(prior?.revision||0)+1||r.review.retainedResultSha256!==(prior?reviewedResultDigest(prior):null)||
      r.review.allFrozenSnapshotsSha256!==reviewedResultDigest(shots)||
      (prior&&canonicalTimestamp(r.verifiedAt)<canonicalTimestamp(prior.verifiedAt)))
      throw Error('REVIEWED_BDL_HISTORY_BINDING_MISMATCH');
    if(seenReceipts.has(r.review.receiptSha256))throw Error('DUPLICATE_REVIEWED_BDL_RECEIPT');
    seenReceipts.add(r.review.receiptSha256);
    const n=r.nativeFinalObservation,old=nativeGames.get(n.providerGameId);
    if(old&&old!==r.gameId)throw Error('REVIEWED_BDL_NATIVE_MAPPING_CONFLICT');
    for(const previous of reviews)if(previous.gameId===r.gameId&&previous.nativeFinalObservation?.providerGameId!==n.providerGameId)
      throw Error('REVIEWED_BDL_NATIVE_MAPPING_CONFLICT');
    nativeGames.set(n.providerGameId,r.gameId);
    for(const [id,team] of [[n.providerHomeTeamId,n.home],[n.providerAwayTeamId,n.away]]){
      if((nativeTeams.has(id)&&nativeTeams.get(id)!==team)||(teamIds.has(team)&&teamIds.get(team)!==id))
        throw Error('REVIEWED_BDL_NATIVE_MAPPING_CONFLICT');
      nativeTeams.set(id,team);teamIds.set(team,id);
    }
    const priorReview=reviews.filter(p=>p.gameId===r.gameId&&p.revision<r.revision).sort((a,b)=>b.revision-a.revision)[0];
    assertReviewedBdlRevisionTimes(r,prior,priorReview);
  }
}
