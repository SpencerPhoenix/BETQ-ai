/**
 * Contract-based evidence collector compatibility.
 * Release 0.4.x is no longer a meaningful requirement; inspect source
 * features so the scheduled forecast journal survives newer BETQ releases.
 *
 * This check must only use /api/health and must not invoke /api/slate.
 */
export function compatibleEvidenceHealth(j){
  if(!j||typeof j!=='object'||j.status!=='ok'||j.app!=='BETQ.ai')
    return {compatible:false,reason:'NOT_BETQ_HEALTH'};
  if(typeof j.version!=='string'||!/^\d+\.\d+\.\d+$/.test(j.version))
    return {compatible:false,reason:'INVALID_VERSION_METADATA'};
  if(j.odds?.configured!==true)
    return {compatible:false,reason:'LIVE_ODDS_SOURCE_NOT_CONFIGURED'};
  if(j.nflModel?.available!==true)
    return {compatible:false,reason:'NO_NFL_MODEL_SOURCE'};
  if(!j.forwardEvidence||typeof j.forwardEvidence.status!=='string')
    return {compatible:false,reason:'NO_FORWARD_EVIDENCE_CONTRACT'};
  if(j.forwardEvidence.prospectiveGames!=null&&
     (!Number.isInteger(j.forwardEvidence.prospectiveGames)||
      j.forwardEvidence.prospectiveGames<0))
    return {compatible:false,reason:'INVALID_FORWARD_EVIDENCE_COUNT'};
  return {
    compatible:true,reason:'EXPECTED_SOURCE_CONTRACT_AVAILABLE',
    app:j.app,version:j.version,
    sourceConfigured:true,noOddsCreditsUsedByThisCheck:true
  };
}
