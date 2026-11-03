/** Offline pre-publication guard. Never mutates a journal or requests a source. */
import {isDeepStrictEqual} from 'node:util';
import {validateJournal} from './evidence.mjs';
import {isCorroboratedSettlement} from './settlement-only.mjs';

export function verifyAppendOnlyEvidence(previous,current,{allowNewSnapshots=true}={}){
  if(typeof allowNewSnapshots!=='boolean')throw Error('INVALID_TRANSITION_MODE');
  validateJournal(previous);validateJournal(current);
  const {snapshots:oldSnapshots,settlements:oldSettlements,...oldMetadata}=previous;
  const {snapshots,settlements,...metadata}=current;
  if(!isDeepStrictEqual(oldMetadata,metadata))throw Error('JOURNAL_METADATA_CHANGED');
  if(snapshots.length<oldSnapshots.length||
    !isDeepStrictEqual(snapshots.slice(0,oldSnapshots.length),oldSnapshots))
    throw Error('FROZEN_FORECAST_REWRITTEN_REMOVED_OR_REORDERED');
  if(!allowNewSnapshots&&snapshots.length!==oldSnapshots.length)
    throw Error('SETTLEMENT_ONLY_FORECAST_APPEND_FORBIDDEN');
  if(settlements.length<oldSettlements.length||
    !isDeepStrictEqual(settlements.slice(0,oldSettlements.length),oldSettlements))
    throw Error('HISTORIC_SETTLEMENT_REWRITTEN_REMOVED_OR_REORDERED');
  const tracked=new Map();
  for(const shot of snapshots){
    const identity={season:shot.season,gameDate:shot.gameDate,home:shot.home,away:shot.away,
      kickoff:Date.parse(shot.commenceTime)};
    const previous=tracked.get(shot.gameId);
    if(previous&&!isDeepStrictEqual(previous,identity))throw Error('CONFLICTING_FROZEN_GAME_IDENTITY');
    tracked.set(shot.gameId,identity);
  }
  const revisions=new Map();
  for(const record of oldSettlements){
    if(!Number.isInteger(record.revision)||record.revision<1)
      throw Error('INVALID_EXISTING_SETTLEMENT_REVISION');
    revisions.set(record.gameId,Math.max(revisions.get(record.gameId)??0,record.revision));
  }
  for(const record of settlements.slice(oldSettlements.length)){
    if(!tracked.has(record.gameId))throw Error('NEW_SETTLEMENT_WITHOUT_FROZEN_FORECAST');
    if(record.gameDate!==tracked.get(record.gameId).gameDate)
      throw Error('NEW_SETTLEMENT_GAME_DATE_MISMATCH');
    if(record.revision!==(revisions.get(record.gameId)??0)+1)
      throw Error('NEW_SETTLEMENT_REVISION_NOT_CONSECUTIVE');
    if(!isCorroboratedSettlement(record))throw Error('NEW_SETTLEMENT_NOT_SOURCE_CORROBORATED');
    revisions.set(record.gameId,record.revision);
  }
  return {immutableRecordsVerified:true,originalSnapshots:oldSnapshots.length,
    appendedSnapshots:snapshots.length-oldSnapshots.length,
    originalSettlements:oldSettlements.length,
    appendedSettlementRevisions:settlements.length-oldSettlements.length};
}
