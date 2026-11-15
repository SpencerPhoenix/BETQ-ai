/** Descriptive grading of immutable first forecasts, never hindsight predictions. */
import {retainedJournalProjection} from './evidence-journal-feed.mjs';
import {sameFrozenIdentity,isEligibleModelSnapshot,isEligibleMarketSnapshot} from './evidence-integrity.mjs';
import {isSourceCorroboratedSettlement} from './settlement-qualification.mjs';

const fields=(record,names)=>Object.fromEntries(names.map(k=>[k,['string','number','boolean'].includes(typeof record?.[k])?record[k]:null]));
const loss=(p,y)=>({brier:(p-y)**2,logLoss:-(y*Math.log(Math.max(1e-6,Math.min(1-1e-6,p)))+(1-y)*Math.log(1-Math.max(1e-6,Math.min(1-1e-6,p)))),correct:p===.5?null:(p>.5)===(y===1)});
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
      const modelEligible=isEligibleModelSnapshot(s),marketEligible=isEligibleMarketSnapshot(s);
      const reasons=[];
      if(quarantined)reasons.push('SCHEDULE_CONFLICT_QUARANTINED');
      if(!r)reasons.push(quarantined?'RESULT_WITHHELD_FOR_SCHEDULE_CONFLICT':'NO_RETAINED_FINAL_RESULT');
      else if(!sourceCorroborated)reasons.push('RESULT_NOT_SOURCE_CORROBORATED');
      if(!modelEligible)reasons.push('MISSING_REQUIRED_MODEL_PROVENANCE');
      if(!marketEligible)reasons.push('MISSING_REQUIRED_MARKET_PROVENANCE');
      if(r?.outcome==='TIE')reasons.push('TIE_EXCLUDED_FROM_BINARY_SCORING');
      const eligible=!quarantined&&sourceCorroborated&&modelEligible&&r.outcome!=='TIE';
      let metrics=null;
      if(eligible){
        const y=r.outcome==='HOME'?1:0,m=loss(s.modelHomeProbability,y),market=marketEligible?loss(s.marketHomeProbability,y):null;
        metrics={modelBrier:m.brier,modelLogLoss:m.logLoss,modelCorrect:m.correct,
          marketBrier:market?.brier??null,marketLogLoss:market?.logLoss??null,marketCorrect:market?.correct??null,
          brierImprovement:market?market.brier-m.brier:null};
      }
      return {...fields(s,['gameId','home','away','gameDate','commenceTime','capturedAt','modelVersion','modelHomeProbability','marketHomeProbability']),
        baselineSnapshotId:s.id,status:quarantined?'SCHEDULE_CONFLICT_QUARANTINED':!r?'PENDING_RESULT':r.outcome==='TIE'?'TIE_EXCLUDED':eligible?'GRADED':'UNGRADED',
        reasons,hasRecordedResult:journal.settlements.some(r=>r.gameId===s.gameId),
        result:r?{...fields(r,['homeScore','awayScore','outcome','revision','verifiedAt']),sourceCorroborated}:null,metrics};
    }).sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId));
    return {schema:1,available:true,researchOnly:true,generatedAt:new Date(now).toISOString(),scope:'RETAINED_NFL_GAMES',
      coverage:{trackedGames:games.length,recordedResults:games.filter(g=>g.hasRecordedResult).length,
        gradedGames:games.filter(g=>g.status==='GRADED').length,ungradedGames:games.filter(g=>g.hasRecordedResult&&g.status!=='GRADED').length,
        pendingGames:games.filter(g=>!g.hasRecordedResult).length,leagueWideCompletenessVerified:false},games,
      limitations:{verifiedEdge:false,verifiedROI:false,wagerRecommendation:false,
        notice:'All retained games, not a complete league schedule. First frozen pregame forecast only; missing evidence is never reconstructed. Scores require source-corroborated results. Ties are excluded. Market consensus is not an executable price; ROI, spread/total grades and closing-line value are unavailable. Individual losses are descriptive, not proof of model improvement.'}};
  }catch{return {schema:1,available:false,researchOnly:true,reason:'INVALID_RETAINED_JOURNAL'};}
}
