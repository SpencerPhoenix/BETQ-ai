/** Descriptive grading of immutable first forecasts, never hindsight predictions. */
import {retainedJournalProjection} from './evidence-journal-feed.mjs';
import {sameFrozenIdentity,isEligibleModelSnapshot,isEligibleMarketSnapshot} from './evidence-integrity.mjs';
import {isSourceCorroboratedSettlement} from './settlement-qualification.mjs';
import {BDL_REVIEWED_RESULT_POLICY,isDescriptivelyQualifiedSettlement,describeReviewedSettlement} from './bdl-reviewed-result.mjs';

const fields=(record,names)=>Object.fromEntries(names.map(k=>[k,['string','number','boolean'].includes(typeof record?.[k])?record[k]:null]));
const loss=(p,y)=>({brier:(p-y)**2,logLoss:-(y*Math.log(Math.max(1e-6,Math.min(1-1e-6,p)))+(1-y)*Math.log(1-Math.max(1e-6,Math.min(1-1e-6,p)))),correct:p===.5?null:(p>.5)===(y===1)});
/** Caller has validated the complete journal and excluded ambiguous frozen identities. */
export function descriptiveForecastMetrics(snapshot,result,{scoringEligible=false}={}){
  if(!scoringEligible)return null;
  const y=result.outcome==='HOME'?1:0,model=loss(snapshot.modelHomeProbability,y),
    market=isEligibleMarketSnapshot(snapshot)?loss(snapshot.marketHomeProbability,y):null;
  return {modelBrier:model.brier,modelLogLoss:model.logLoss,modelCorrect:model.correct,
    marketBrier:market?.brier??null,marketLogLoss:market?.logLoss??null,marketCorrect:market?.correct??null,
    brierImprovement:market?market.brier-model.brier:null};
}
export function gradeRetainedGames(journal,{now=Date.now()}={}){
  try {
    const retained=retainedJournalProjection(journal,now),first=new Map();
    // Include quarantined games in coverage, but never choose an arbitrary result for them.
    for(const s of journal.snapshots){
      const old=first.get(s.gameId);
      if(!old||s.capturedAt<old.capturedAt||(s.capturedAt===old.capturedAt&&s.id<old.id))first.set(s.gameId,s);
    }
    const blocked=new Set(retained.quarantine.games.map(g=>g.gameId));
    const games=[...first.values()].map(s=>{
      const quarantined=blocked.has(s.gameId),r=retained.latest.get(s.gameId);
      const sourceCorroborated=!!r&&sameFrozenIdentity(r,s)&&isSourceCorroboratedSettlement(r,s);
      const descriptivelyQualified=!!r&&sameFrozenIdentity(r,s)&&isDescriptivelyQualifiedSettlement(r,s);
      const qualificationDetails=r?describeReviewedSettlement(r,s):null;
      const reviewedBdl=qualificationDetails?.policyId===BDL_REVIEWED_RESULT_POLICY;
      const modelEligible=isEligibleModelSnapshot(s),marketEligible=isEligibleMarketSnapshot(s);
      const reasons=[];
      if(quarantined)reasons.push('SCHEDULE_CONFLICT_QUARANTINED');
      if(!r)reasons.push(quarantined?'RESULT_WITHHELD_FOR_SCHEDULE_CONFLICT':'NO_RETAINED_FINAL_RESULT');
      else if(!descriptivelyQualified)reasons.push('RESULT_NOT_SOURCE_CORROBORATED');
      if(reviewedBdl)reasons.push('REVIEWED_BDL_SEPARATE_DESCRIPTIVE_COHORT');
      if(!modelEligible)reasons.push('MISSING_REQUIRED_MODEL_PROVENANCE');
      if(!marketEligible)reasons.push('MISSING_REQUIRED_MARKET_PROVENANCE');
      if(r?.outcome==='TIE')reasons.push('TIE_EXCLUDED_FROM_BINARY_SCORING');
      const eligible=!quarantined&&descriptivelyQualified&&modelEligible&&r.outcome!=='TIE';
      const metrics=descriptiveForecastMetrics(s,r,{scoringEligible:eligible});
      return {...fields(s,['gameId','home','away','gameDate','commenceTime','capturedAt','modelVersion','modelHomeProbability','marketHomeProbability']),
        baselineSnapshotId:s.id,status:quarantined?'SCHEDULE_CONFLICT_QUARANTINED':!r?'PENDING_RESULT':r.outcome==='TIE'?'TIE_EXCLUDED':eligible?'GRADED':'UNGRADED',
        reasons,hasRecordedResult:journal.settlements.some(r=>r.gameId===s.gameId),
        result:r?{...fields(r,['homeScore','awayScore','outcome','revision','verifiedAt','source']),sourceCorroborated,
          descriptivelyQualified,aggregateScoringEligible:sourceCorroborated,qualificationDetails}:null,metrics};
    }).sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId));
    return {schema:1,available:true,researchOnly:true,generatedAt:new Date(now).toISOString(),scope:'RETAINED_NFL_GAMES',
      coverage:{trackedGames:games.length,recordedResults:games.filter(g=>g.hasRecordedResult).length,
        gradedGames:games.filter(g=>g.status==='GRADED').length,ungradedGames:games.filter(g=>g.hasRecordedResult&&g.status!=='GRADED').length,
        sourceCorroboratedV2GradedGames:games.filter(g=>g.status==='GRADED'&&g.result.sourceCorroborated).length,
        reviewedBdlGradedGames:games.filter(g=>g.status==='GRADED'&&g.result.qualificationDetails?.policyId===BDL_REVIEWED_RESULT_POLICY).length,
        pendingGames:games.filter(g=>!g.hasRecordedResult).length,leagueWideCompletenessVerified:false},games,
      limitations:{verifiedEdge:false,verifiedROI:false,wagerRecommendation:false,
        notice:'All retained games, not a complete league schedule. First frozen pregame forecast only; missing evidence is never reconstructed. Per-game scores use qualified V2 receipts or a separate reviewed BDL native-final/nflverse-score agreement. Reviewed BDL results do not enter V2 aggregate reports; upstream independence is unverified. Ties are excluded. Market consensus is not an executable price; ROI, spread/total grades and closing-line value are unavailable. Individual losses are descriptive, not proof of model improvement.'}};
  }catch{return {schema:1,available:false,researchOnly:true,reason:'INVALID_RETAINED_JOURNAL'};}
}
