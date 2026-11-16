/** Future capture diagnostics only. Never reconstruct, replace or qualify retained evidence. */
import {canonicalTimestamp,QUOTE_MAX_AGE_MS,validMarketQuoteWindow,isEligibleMarketSnapshot} from './evidence-integrity.mjs';

export const MARKET_CAPTURE_DIAGNOSTIC_POLICY='FUTURE_MARKET_CAPTURE_DIAGNOSTICS_V1';
const unavailableReasons=new Set(['NO_VALID_PREGAME_EVENT','INVALID_PROVIDER_RECEIPT_TIME',
  'INVALID_CONSENSUS_CONFIGURATION','INVALID_BOOKMAKER_COLLECTION','INSUFFICIENT_INDEPENDENT_BOOKS','EXCESSIVE_BOOK_DISAGREEMENT']);

export function assessFutureMarketCapture(consensus,{capturedAt,sourceReceivedAt,commenceTime}={}){
  if(consensus?.available!==true)return {eligible:false,reasons:[unavailableReasons.has(consensus?.reason)?consensus.reason:'CONSENSUS_UNAVAILABLE']};
  const reasons=[],mark=reason=>reasons.push(reason),finite=Number.isFinite;
  if(consensus.method!=='ALL_BOOKS_MEDIAN_DE_VIG')mark('UNSUPPORTED_CONSENSUS_METHOD');
  if(!Number.isInteger(consensus.books)||consensus.books<3)mark('INSUFFICIENT_OR_INVALID_BOOK_COUNT');
  if(!finite(consensus.homeProbability)||consensus.homeProbability<=0||consensus.homeProbability>=1)mark('INVALID_CONSENSUS_PROBABILITY');
  const capture=canonicalTimestamp(capturedAt),receipt=canonicalTimestamp(sourceReceivedAt),kick=canonicalTimestamp(commenceTime),
    oldest=canonicalTimestamp(consensus.oldestQuoteAt),newest=canonicalTimestamp(consensus.latestQuoteAt);
  if(!finite(capture))mark('INVALID_CAPTURE_TIMESTAMP');
  if(!finite(receipt))mark('INVALID_SOURCE_RECEIPT_TIMESTAMP');
  if(!finite(kick))mark('INVALID_KICKOFF_TIMESTAMP');
  if(!finite(oldest))mark('MISSING_OR_INVALID_OLDEST_QUOTE_TIMESTAMP');
  if(!finite(newest))mark('MISSING_OR_INVALID_NEWEST_QUOTE_TIMESTAMP');
  if(finite(oldest)&&finite(newest)&&oldest>newest)mark('QUOTE_BOUND_ORDER_INVALID');
  if(finite(newest)&&finite(receipt)&&newest>receipt)mark('QUOTE_AFTER_SOURCE_RECEIPT');
  if(finite(receipt)&&finite(capture)&&receipt>capture)mark('SOURCE_RECEIPT_AFTER_CAPTURE');
  if(finite(oldest)&&finite(capture)&&capture-oldest>QUOTE_MAX_AGE_MS)mark('OLDEST_QUOTE_EXPIRED_AT_CAPTURE');
  if(finite(newest)&&finite(kick)&&newest>=kick)mark('QUOTE_NOT_PREGAME');
  const eligible=reasons.length===0&&validMarketQuoteWindow({capturedAt,sourceReceivedAt,
    marketOldestQuoteAt:consensus.oldestQuoteAt,marketNewestQuoteAt:consensus.latestQuoteAt});
  if(!eligible&&!reasons.length)mark('INVALID_QUOTE_WINDOW');
  return {eligible,reasons};
}

export function summarizeDerivedMarketObservations(observations){
  const reasonCounts={};let paired=0;
  for(const row of observations){
    if(row.eligible)paired++;
    for(const reason of row.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
  }
  return {policy:MARKET_CAPTURE_DIAGNOSTIC_POLICY,
    scope:'MODEL_ELIGIBLE_OBSERVATIONS_BEFORE_IDENTITY_ADMISSION',
    modelObservations:observations.length,pairedMarketObservations:paired,
    modelOnlyObservations:observations.length-paired,reasonCounts,reasonCountsOverlap:true};
}

const firstByGame=snapshots=>{
  const first=new Map();
  for(const s of snapshots){const prior=first.get(s.gameId);
    if(!prior||s.capturedAt<prior.capturedAt||(s.capturedAt===prior.capturedAt&&s.id<prior.id))first.set(s.gameId,s);}
  return first;
};
/** Call only with already validated writer inputs/output. Counts never authorize a write. */
export function summarizeWrittenMarketCapture(original,admitted,updated){
  const previousIds=new Map(original.snapshots.map(s=>[s.id,s])),firstBefore=firstByGame(original.snapshots),
    added=updated.snapshots.filter(s=>!previousIds.has(s.id)),firstAfter=firstByGame(updated.snapshots),
    newFirst=[...firstAfter].filter(([gameId])=>!firstBefore.has(gameId)).map(([,s])=>s),
    paired=added.filter(isEligibleMarketSnapshot).length;
  const upgradedDuplicateIds=new Set(admitted.filter(s=>previousIds.has(s.id)&&
    isEligibleMarketSnapshot(s)&&!isEligibleMarketSnapshot(previousIds.get(s.id))).map(s=>s.id));
  return {policy:MARKET_CAPTURE_DIAGNOSTIC_POLICY,scope:'ACTUALLY_APPENDED_SNAPSHOTS_NOT_RECAPTURE_CANDIDATES',
    status:!added.length?'NO_NEW_MARKET_EVIDENCE':paired===added.length?'PAIRED_MARKET_PROVENANCE_APPENDED':
      paired?'PARTIAL_MARKET_PROVENANCE_APPENDED':'MODEL_ONLY_NO_USABLE_MARKET_PROVENANCE',
    appendedSnapshots:added.length,appendedPairedMarketSnapshots:paired,appendedModelOnlySnapshots:added.length-paired,
    newFirstForecastGames:newFirst.length,newFirstForecastGamesWithMarket:newFirst.filter(isEligibleMarketSnapshot).length,
    newFirstForecastGamesWithoutMarket:newFirst.filter(s=>!isEligibleMarketSnapshot(s)).length,
    unchangedLegacyFirstForecastsWithoutMarket:[...firstBefore.values()].filter(s=>!isEligibleMarketSnapshot(s)).length,
    duplicateMarketImprovementsNotWritten:upgradedDuplicateIds.size,
    historicalEvidenceReconstructed:false,baselineSelectionChanged:false,sourceAuthenticityVerified:false,
    resultCorroborationVerified:false,roiOrClvEstablished:false};
}
