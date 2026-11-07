/**
 * Read-side scoring gate. No fetching, source activation or journal mutation.
 * Matches the existing draft settlement receipt contract; it does not infer
 * source independence, certify a league result or license archival activity.
 */
import {isDeepStrictEqual} from 'node:util';
import {validDay} from './integrity.mjs';
import {canonicalTimestamp,FINALITY_DELAY_MS,validFrozenIdentity,sameFrozenIdentity} from './evidence-integrity.mjs';

export const OUTCOME_SCORING_POLICY='SOURCE_CORROBORATED_SETTLEMENT_V1';
const canonicalTime=canonicalTimestamp;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const freshReceipt=(value,verifiedAt)=>{
  const at=canonicalTime(value);
  return Number.isFinite(at)&&at>=verifiedAt-3600000&&at<=verifiedAt+120000;
};

/** Legacy records remain visible, but cannot acquire missing provenance. */
export function isSourceCorroboratedSettlement(record,snapshot){
  const at=canonicalTime(record?.verifiedAt),v=record?.communitySourceVintage,
    a=record?.finalityAttestation,kick=Date.parse(snapshot?.commenceTime);
  return Boolean(record&&snapshot&&Number.isInteger(record.revision)&&record.revision>0&&
    sameFrozenIdentity(record,snapshot)&&validDay(record.gameDate)&&
    validFrozenIdentity(snapshot)&&Number.isFinite(at)&&Number.isFinite(kick)&&at>=kick+FINALITY_DELAY_MS&&
    record.source==='NFLVERSE_SCHEDULES'&&
    record.finalityBasis==='TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED'&&
    v&&digest(v.sha256)&&v.publicationTimeVerified===false&&
    canonicalTime(v.collectorObservedAt)>=kick+FINALITY_DELAY_MS&&freshReceipt(v.collectorObservedAt,at)&&
    a?.status==='CROSS_SOURCE_FINAL'&&a.corroborator==='ESPN_SITE_SCOREBOARD_UNOFFICIAL'&&
    a.officialLeagueCertification===false&&sameFrozenIdentity(a,snapshot)&&
    a.homeScore===record.homeScore&&a.awayScore===record.awayScore&&
    typeof a.eventId==='string'&&/^[0-9]{6,20}$/.test(a.eventId)&&digest(a.sourceSha256)&&
    canonicalTime(a.observedAt)>=kick+FINALITY_DELAY_MS&&freshReceipt(a.observedAt,at));
}

/** Never select an older qualified result after a later unqualified correction. */
export function latestSettlementsByRevision(records){
  const latest=new Map(),seen=new Map();
  for(const r of records){
    const revision=Number.isInteger(r.revision)&&r.revision>0?r.revision:0;
    if(r.revision!==undefined&&revision===0)throw Error('Invalid settlement revision');
    if(!seen.has(r.gameId))seen.set(r.gameId,new Map());
    const revisions=seen.get(r.gameId);
    if((revision===0&&revisions.size>0&&!revisions.has(0))||
      (revision>0&&revisions.has(0)))throw Error('Ambiguous settlement revision history');
    if(revisions.has(revision)&&!isDeepStrictEqual(revisions.get(revision),r))
      throw Error('Contradictory finalized results or provenance with same settlement revision');
    revisions.set(revision,r);
    const prior=latest.get(r.gameId);
    const priorRevision=Number.isInteger(prior?.revision)&&prior.revision>0?prior.revision:0;
    if(!prior||revision>priorRevision)latest.set(r.gameId,r);
  }
  return latest;
}

/** Conflicting frozen identities invalidate scoring, without deleting records. */
export function unambiguousFrozenGameIds(snapshots){
  const identities=new Map(),blocked=new Set();
  for(const s of snapshots){
    const identity={season:s.season,home:s.home,away:s.away,date:s.gameDate,kickoff:Date.parse(s.commenceTime)};
    if(!Number.isInteger(identity.season)||typeof identity.home!=='string'||!identity.home||
      typeof identity.away!=='string'||!identity.away||identity.home===identity.away||
      !validDay(identity.date)||!Number.isFinite(identity.kickoff)||
      (identities.has(s.gameId)&&!isDeepStrictEqual(identities.get(s.gameId),identity)))blocked.add(s.gameId);
    identities.set(s.gameId,identity);
  }
  return new Set([...identities.keys()].filter(id=>!blocked.has(id)));
}
