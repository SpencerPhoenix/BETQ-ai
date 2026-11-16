/** Private offline feature freeze; no outcome-model coefficients or provider calls. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {makeQBCandidateNews,reviewQBCandidate} from './shadow-latency.mjs';
import {canonicalTimestamp} from './evidence-integrity.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const text=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=160;
const states=['OUT','INACTIVE','STARTER_CHANGE','STARTER_CONFIRMED','QUESTIONABLE'];
/** `now` belongs to a trusted collector clock; caller-supplied timestamps do not authenticate history. */
export function freezeReviewedQbFeatures({event,candidates=[],reviews=[]}={}, {now=Date.now()}={}){
  const kick=canonicalTimestamp(event?.kickoffAt);
  if(!Number.isFinite(now)||!Number.isFinite(kick)||now>=kick||
     ![event?.eventId,event?.homeTeam,event?.awayTeam].every(text)||event.homeTeam===event.awayTeam||
     !Array.isArray(candidates)||candidates.length>5000||!Array.isArray(reviews)||reviews.length>5000)
    throw Error('INVALID_LINEUP_FREEZE_SCOPE');
  const reviewed=new Map(),seen=new Map(),rejected={},players=new Map();
  const reject=reason=>{rejected[reason]=(rejected[reason]??0)+1;};
  for(const r of reviews){
    if(!text(r?.recordId))throw Error('INVALID_REVIEW_ID');
    if(reviewed.has(r.recordId)&&!isDeepStrictEqual(reviewed.get(r.recordId),r))throw Error('CONFLICTING_SOURCE_REVIEWS');
    reviewed.set(r.recordId,r);
  }
  for(const c of candidates){
    if(!text(c?.recordId))throw Error('INVALID_CANDIDATE_ID');
    if(seen.has(c.recordId)){
      if(!isDeepStrictEqual(seen.get(c.recordId),c))throw Error('MUTATED_CANDIDATE_HISTORY');
      continue;
    }
    seen.set(c.recordId,c);
    if(c.eventId!==event.eventId){reject('OTHER_EVENT');continue;}
    if(c.kickoffAt!==event.kickoffAt||![event.homeTeam,event.awayTeam].includes(c.team)){reject('EVENT_IDENTITY_CONFLICT');continue;}
    const observed=canonicalTimestamp(c.firstObservedAt),r=reviewed.get(c.recordId),at=canonicalTimestamp(r?.reviewedAt);
    if(!Number.isFinite(observed)||observed>now){reject('NOT_OBSERVED_AT_FREEZE');continue;}
    if(!r||!Number.isFinite(at)||at>now){reject('NOT_REVIEWED_AT_FREEZE');continue;}
    try{
      const expected=makeQBCandidateNews(c,{observedAt:observed});
      const expectedReview=reviewQBCandidate(expected,{reviewerId:r.reviewerId,reviewedAt:at,sourceEvidenceDigest:r.sourceEvidenceDigest});
      if(!isDeepStrictEqual(c,expected)||!isDeepStrictEqual(r,expectedReview))throw Error('mismatch');
    }catch{reject('INVALID_CANDIDATE_OR_REVIEW');continue;}
    const key=c.team+'\0'+c.qbName,old=players.get(key);
    if(!old||observed>old.observed)players.set(key,{observed,records:[{c,r}]});
    else if(observed===old.observed)old.records.push({c,r});
  }
  const sides={};
  for(const [side,team] of [['home',event.homeTeam],['away',event.awayTeam]]){
    const reported=[];let conflicts=0;
    for(const p of players.values()){
      if(p.records[0].c.team!==team)continue;
      if(new Set(p.records.map(x=>x.c.status)).size>1){conflicts++;continue;}
      const {c,r}=p.records.sort((a,b)=>a.c.recordId.localeCompare(b.c.recordId))[0];
      reported.push({player:c.qbName,reportedStatus:c.status,firstObservedAt:c.firstObservedAt,reviewedAt:r.reviewedAt,
        observationAgeSeconds:(now-p.observed)/1000,candidateId:c.recordId,sourceEvidenceDigest:r.sourceEvidenceDigest});
    }
    reported.sort((a,b)=>a.player.localeCompare(b.player));
    sides[side]={team,coverage:conflicts?'CONFLICTED':reported.length?'PARTIAL_REVIEWED_REPORTS':'UNKNOWN',
      rosterComplete:false,starterIdentityVerified:false,conflictingPlayers:conflicts,
      reportedCounts:Object.fromEntries(states.map(status=>[status,reported.filter(p=>p.reportedStatus===status).length])),reported};
  }
  const record={schema:1,protocol:'QB_REVIEWED_POINT_IN_TIME_FEATURES_V1',event:{eventId:event.eventId,homeTeam:event.homeTeam,awayTeam:event.awayTeam,kickoffAt:event.kickoffAt},frozenAt:new Date(now).toISOString(),
    privateOnly:true,researchOnly:true,sides,rejected,
    probabilityAdjustment:null,modelPromotionAllowed:false,
    warning:'Structural review receipts are not independent authenticity proof. No report does not mean healthy; no verified starter identity or complete lineup is inferred.'};
  record.freezeId=digest(record);return record;
}
