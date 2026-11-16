import {assertReviewedBdlJournalContext} from './bdl-reviewed-result.mjs';
/** Narrow classification only: never reconcile, rewrite or authorize a frozen schedule. */
import {canonicalTimestamp,validFrozenIdentity,validProviderEventId,providerContinuityConflicts} from './evidence-integrity.mjs';
import {latestSettlementsByRevision} from './settlement-qualification.mjs';

export const SCHEDULE_QUARANTINE_POLICY='FROZEN_SCHEDULE_CONFLICT_QUARANTINE_V1';
const chronological=(a,b)=>canonicalTimestamp(a.capturedAt)-canonicalTimestamp(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0);

export function assertRetainedObservationTimes(journal,now){
  if(!Number.isFinite(now))throw Error('FUTURE_OR_INVALID_OBSERVATION_TIME');
  const observed=value=>value==null||(Number.isFinite(canonicalTimestamp(value))&&canonicalTimestamp(value)<=now);
  for(const snapshot of journal.snapshots){
    if(!['capturedAt','sourceReceivedAt','modelBuiltAt','challengerBuiltAt',
      'marketNewestQuoteAt','marketOldestQuoteAt'].every(key=>observed(snapshot[key])))
      throw Error('FUTURE_OR_INVALID_OBSERVATION_TIME');
  }
  for(const record of journal.settlements){
    if(![record.verifiedAt,record.communitySourceVintage?.collectorObservedAt,
      record.terminalStatusReceipt?.observedAt,record.finalityAttestation?.observedAt,
      record.nativeFinalObservation?.collectorRetrievedAt,record.nativeFinalObservation?.providerRecordUpdatedAt,
      record.communityScoreObservation?.collectorRetrievedAt,record.review?.recordedAt].every(observed))
      throw Error('FUTURE_OR_INVALID_OBSERVATION_TIME');
  }
}

/** Shared read/write identity gate, after the caller validates journal structure. */
export function validateRetainedIdentityState(journal,now){
  assertRetainedObservationTimes(journal,now);
  const schedules=classifyFrozenSchedules(journal.snapshots);
  for(const shot of journal.snapshots){
    if(!shot.id||shot.id.length>200)throw Error('INVALID_RETAINED_GAME_IDENTITY');
    if(shot.providerEventId!=null&&(typeof shot.providerEventId!=='string'||!shot.providerEventId||shot.providerEventId.length>200))
      throw Error('INVALID_RETAINED_PROVIDER_ID');
  }
  const latest=latestSettlementsByRevision(journal.settlements);
  for(const record of journal.settlements){
    const shot=journal.snapshots.find(s=>s.gameId===record.gameId);
    if(!shot)throw Error('ORPHAN_RETAINED_RESULT');
    const conflict=schedules.games.find(g=>g.gameId===record.gameId);
    const times=conflict?.observedCommenceTimes??[shot.commenceTime];
    const kickoff=Math.max(...times.map(canonicalTimestamp));
    if(now<=kickoff)throw Error('RESULT_BEFORE_KICKOFF');
    const identities=[record,record.communitySourceVintage,record.terminalStatusReceipt,record.finalityAttestation,
      record.nativeFinalObservation,record.communityScoreObservation];
    const receiptKickoffs=new Set();
    for(const identity of identities){
      if(identity==null)continue;
      if(typeof identity!=='object'||Array.isArray(identity))throw Error('CONFLICTING_RESULT_IDENTITY');
      for(const key of ['gameId','season','home','away','gameDate'])
        if(identity[key]!=null&&identity[key]!==shot[key])throw Error('CONFLICTING_RESULT_IDENTITY');
      if(identity.commenceTime!=null&&!times.includes(identity.commenceTime))throw Error('CONFLICTING_RESULT_IDENTITY');
      if(identity.providerScheduledKickoff!=null&&!times.includes(identity.providerScheduledKickoff))throw Error('CONFLICTING_RESULT_IDENTITY');
      if(identity.commenceTime!=null)receiptKickoffs.add(identity.commenceTime);
      for(const key of ['homeScore','awayScore'])
        if(identity[key]!=null&&identity[key]!==record[key])throw Error('CONFLICTING_RESULT_IDENTITY');
    }
    if(receiptKickoffs.size>1)throw Error('CONFLICTING_RESULT_IDENTITY');
    for(const value of [record.verifiedAt,record.communitySourceVintage?.collectorObservedAt,
      record.terminalStatusReceipt?.observedAt,record.finalityAttestation?.observedAt,
      record.nativeFinalObservation?.collectorRetrievedAt,
      record.communityScoreObservation?.collectorRetrievedAt,record.review?.recordedAt])
      if(value!=null&&canonicalTimestamp(value)<=kickoff)throw Error('RESULT_RECEIPT_BEFORE_KICKOFF');
  }
  assertReviewedBdlJournalContext(journal,now);
  return {latest,schedules};
}

/** Caller must first validate the complete journal, including chronology and results. */
export function classifyFrozenSchedules(snapshots){
  const groups=new Map(),blocked=new Set(),games=[];
  for(const shot of snapshots){
    if(!validFrozenIdentity(shot))throw Error('INVALID_RETAINED_GAME_IDENTITY');
    if(!groups.has(shot.gameId))groups.set(shot.gameId,[]);
    groups.get(shot.gameId).push(shot);
  }
  const providers=providerContinuityConflicts(snapshots);
  for(const [gameId,records] of groups){
    const shots=[...records].sort(chronological),first=shots[0];
    if(shots.some(s=>['season','home','away','gameDate'].some(k=>s[k]!==first[k])))
      throw Error('INVALID_RETAINED_GAME_IDENTITY');
    const observedCommenceTimes=[...new Set(shots.map(s=>s.commenceTime))].sort();
    if(observedCommenceTimes.length===1)continue;
    // Missing, changed or cross-game provider identity is not a schedule-only conflict.
    if(providers.has(gameId)||shots.some(s=>!validProviderEventId(s.providerEventId)))
      throw Error('INVALID_RETAINED_GAME_IDENTITY');
    blocked.add(gameId);
    games.push({gameId,season:first.season,home:first.home,away:first.away,gameDate:first.gameDate,
      reason:'CONFLICTING_RETAINED_KICKOFFS',firstFrozenSnapshotId:first.id,
      firstFrozenCommenceTime:first.commenceTime,observedCommenceTimes,snapshotCount:shots.length,
      scoringEligible:false,collectionEligible:false});
  }
  games.sort((a,b)=>a.gameId<b.gameId?-1:a.gameId>b.gameId?1:0);
  return {blocked,games};
}

export function scheduleQuarantineMetadata(journal,state=classifyFrozenSchedules(journal.snapshots)){
  const games=state.games.map(g=>({...g,resultCount:journal.settlements.filter(r=>r.gameId===g.gameId).length}));
  return {policy:SCHEDULE_QUARANTINE_POLICY,historyPreserved:true,
    rawGameCount:new Set(journal.snapshots.map(s=>s.gameId)).size,
    rawSnapshotCount:journal.snapshots.length,rawResultCount:journal.settlements.length,
    excludedGameCount:games.length,excludedSnapshotCount:games.reduce((n,g)=>n+g.snapshotCount,0),
    excludedResultCount:games.reduce((n,g)=>n+g.resultCount,0),games};
}
