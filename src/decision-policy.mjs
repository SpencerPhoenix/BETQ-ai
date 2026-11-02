/**
 * Central source-of-truth decision authority.
 * The price scanner produces *market differences*, not validated wagering
 * edges. The risk agent has final veto over every displayed opportunity.
 *
 * No model in BETQ currently qualifies for a trusted betting recommendation,
 * a Kelly stake, an automatic paper position, or any actual wager.
 * Retain raw hypothetical calculations solely for source-audited research.
 */
const FORECAST_ONLY = 'UNVALIDATED_RESEARCH';
const validTime = s => typeof s === 'string' && Number.isFinite(Date.parse(s));

export function applyDecisionAuthority(analysis,agentRun,{asOf=Date.now()}={}){
  if(!analysis||!Array.isArray(analysis.events)||!analysis.summary||
     !agentRun||typeof agentRun.decision!=='string'||!Number.isFinite(asOf))
    throw Error('Decision authority requires complete market analysis, agent audit and clock');
  let rawWatches=0, blocked=0;
  const eligibleModel = agentRun.nestedCalibrationReady &&
    agentRun.allIndependentContributionsRejected===false &&
    agentRun.marketBenchmarkConsistentlyBetter===false;
  // No verified execution source, independent profitable pricing or
  // authenticated transaction ledger exists. Never promote WATCH to BET.
  const allowWager=false;
  for(const event of analysis.events){
    const kickoff=Date.parse(event.commenceTime);
    for(const o of event.opportunities||[]){
      const quoteAt=validTime(o.lastUpdated)?Date.parse(o.lastUpdated):NaN;
      const sourceFresh=Number.isFinite(quoteAt)&&quoteAt<=asOf+60000&&
        asOf-quoteAt<=600000&&Number.isFinite(kickoff)&&kickoff-asOf>300000;
      const watch=o.status==='WATCH';
      if(watch)rawWatches++;
      const marketMethod=o.basis==='MARKET_CONSENSUS_ONLY';
      const supported=watch&&sourceFresh&&marketMethod&&o.comparatorBooks>=2;
      const reasons=[];
      if(!watch)reasons.push('MARKET_SCREEN_DID_NOT_PASS');
      if(!sourceFresh)reasons.push('QUOTE_OR_KICKOFF_NOT_CURRENT');
      if(!marketMethod||o.independentModelValidated!==true)
        reasons.push('NO_INDEPENDENT_VALIDATED_EDGE');
      if(!agentRun.nestedCalibrationReady)reasons.push('PRIOR_SEASON_CALIBRATION_UNVERIFIED');
      if(agentRun.allIndependentContributionsRejected)
        reasons.push('INDEPENDENT_MODEL_FAILED_MARKET_BENCHMARK');
      if(agentRun.marketBenchmarkConsistentlyBetter)
        reasons.push('MARKET_REFERENCE_STRONGER_THAN_MODEL');
      if(!eligibleModel)reasons.push('MODEL_NOT_PROMOTED');
      reasons.push('NO_AUTHENTICATED_EXECUTION_AND_SETTLEMENT');
      if(agentRun.decision.startsWith('PASS'))reasons.push('AGENT_RISK_VETO');
      const originalUnits=Number.isFinite(o.theoreticalUnits)?o.theoreticalUnits:0;
      o.rawMarketScreenStatus=o.status;
      o.rawMarketScenarioUnits=originalUnits;
      o.researchClassification=supported?'PRICE_DIFFERENCE_ONLY':'NO_QUALIFIED_MARKET_DIFFERENCE';
      o.selectionAuthority=FORECAST_ONLY;
      o.executionStatus='NOT_AUTHORIZED';
      o.executionAuthorized=allowWager;
      o.paperStagingAuthorized=false;
      o.recommendedUnits=0;
      o.theoreticalUnits=0;
      o.independentEdgeVerified=false;
      o.priceMovementNotExpectedProfit=true;
      o.authorityReasons=[...new Set(reasons)];
      if(watch)blocked++;
    }
  }
  analysis.summary.marketPriceWatches=rawWatches;
  analysis.summary.actionableSelections=0;
  analysis.summary.researchOnlyCandidates=blocked;
  analysis.summary.executionPolicy='NO_VERIFIED_EDGE_NO_AUTOSTAKE';
  analysis.summary.modelPromotionAllowed=false;
  analysis.executionGate={
    verdict:agentRun.decision,
    bettingAuthorized:false,
    automaticPaperStagingAuthorized:false,
    allSuggestedUnitsSuppressed:true,
    researchOnly:true,
    reason:'Market price discrepancy is not evidence of reliable incremental expected value.'
  };
  return analysis;
}
