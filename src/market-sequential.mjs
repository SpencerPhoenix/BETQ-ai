/**
 * Prospective market-relative prequential evidence for BETQ.ai.
 *
 * Read only the existing append-only 2026 PREKICKOFF source journal.
 * Exactly one first qualifying snapshot and one final settlement per game.
 * NO public/book-specific odds, staking, winner picks, ROI or CLV.
 *
 * Protocol: docs/PREREGISTERED_SEQUENTIAL_EVIDENCE.md
 * Version v1 is frozen; neither thresholds nor selection rules auto-adapt.
 */
import {validateJournal} from './evidence.mjs';
import {isCorroboratedSettlement} from './settlement-only.mjs';

export const SEQUENTIAL_PROTOCOL=Object.freeze({
  version:'betq-market-sequential-v1',
  minDistinctFinalGames:30,
  evidenceLikelihoodRatioThreshold:20,
  mixtureWeights:Object.freeze({elo:0.5,efficiency:0.5}),
  marketSource:'SAME_CAPTURE_NO_VIG_3PLUS_BOOK_MEDIAN',
  previsibleModel:'FIRST_SOURCE_VALID_PREGAME_SNAPSHOT',
  interpretation:'CONDITIONAL_MARKET_EFFICIENT_NULL_NOT_PROVEN_TRUE'
});
const time=s=>typeof s==='string'&&s.trim().length>0?Date.parse(s):NaN;
const probability=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1;
const round=(x,d=5)=>Number.isFinite(x)?Number(x.toFixed(d)):null;
const score=(p,y)=>({
  brier:(p-y)**2,
  logLoss:-(y*Math.log(p)+(1-y)*Math.log1p(-p))
});
const logRatio=(p,q,y)=>y===1?Math.log(q/p):Math.log((1-q)/(1-p));
const expSafe=x=>Math.exp(Math.min(700,x));
function logMixture(a,b){
  const max=Math.max(a,b);
  return max+Math.log((Math.exp(a-max)+Math.exp(b-max))/2);
}
export function isEligibleFirstSnapshot(s){
  if(!s||s.researchOnly!==true||s.independentModel!==true||
    s.marketBasis!=='NO_VIG_MULTI_BOOK_MEDIAN'||
    !probability(s.marketHomeProbability)||!probability(s.modelHomeProbability)||
    !Number.isInteger(s.marketBookCount)||s.marketBookCount<3||
    typeof s.gameId!=='string'||s.gameId.length>140)return false;
  const captured=time(s.capturedAt),kick=time(s.commenceTime),
    received=time(s.sourceReceivedAt),built=time(s.modelBuiltAt),
    quote=time(s.marketNewestQuoteAt);
  return [captured,kick,received,built,quote].every(Number.isFinite)&&
    captured<kick&&received<=captured+60000&&
    received>=captured-600000&&
    built<=captured+60000&&built<kick&&
    quote<=received+60000&&quote<=captured+60000&&quote<kick;
}
function challengerAtSameFirstSnapshot(s){
  const built=time(s.challengerBuiltAt),captured=time(s.capturedAt),kick=time(s.commenceTime);
  return s.challengerResearchOnly===true&&
    probability(s.challengerHomeProbability)&&Number.isFinite(built)&&
    built<=captured+60000&&built<kick? s.challengerHomeProbability:s.marketHomeProbability;
}
function latestSettlements(j){
  const latest=new Map();
  for(const r of j.settlements){
    const revision=Number.isInteger(r.revision)&&r.revision>0?r.revision:0;
    const previous=latest.get(r.gameId);
    if(!previous||revision>previous.revision){
      latest.set(r.gameId,{...r,revision});
    }else if(revision===previous.revision&&
      (r.homeScore!==previous.homeScore||r.awayScore!==previous.awayScore)){
      throw Error('Contradictory finalized results with same settlement revision');
    }
  }
  return latest;
}
function eligible(j){
  const first=new Map();
  const exclusions={noEligiblePregameQuote:0,noSettlement:0,
    uncorroboratedSettlement:0,tie:0};
  const games=new Set(j.snapshots.map(x=>x.gameId));
  for(const s of j.snapshots){
    if(!isEligibleFirstSnapshot(s))continue;
    const current=first.get(s.gameId);
    if(!current||s.capturedAt<current.capturedAt||
      (s.capturedAt===current.capturedAt&&s.id<current.id))first.set(s.gameId,s);
  }
  exclusions.noEligiblePregameQuote=games.size-first.size;
  const final=latestSettlements(j);
  const observations=[];
  for(const [id,s] of first){
    const r=final.get(id);
    if(!r){exclusions.noSettlement++;continue;}
    if(!isCorroboratedSettlement(r)){
      exclusions.uncorroboratedSettlement++;continue;
    }
    if(r.outcome==='TIE'){exclusions.tie++;continue;}
    const y=r.outcome==='HOME'?1:0,p=s.marketHomeProbability;
    observations.push({
      gameId:id,gameDate:s.gameDate,scheduledAt:s.commenceTime,
      market:p,elo:s.modelHomeProbability,
      efficiency:challengerAtSameFirstSnapshot(s),
      challengerPresent:challengerAtSameFirstSnapshot(s)!==p,
      y
    });
  }
  observations.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)||
    a.gameId.localeCompare(b.gameId));
  return {observations,exclusions,firstEligibleGames:first.size,allTrackedGames:games.size};
}

/**
 * Return the conditional log-evidence for a strictly previsible, frozen
 * candidate q. E_n is an e-process ONLY if the market p is the actual
 * conditional outcome probability for each game, an unverified premise.
 */
export function calculateSequentialEvidence(journal){
  validateJournal(journal);
  const {observations,exclusions,firstEligibleGames,allTrackedGames}=eligible(journal);
  let logElo=0,logEfficiency=0,marketBrier=0,eloBrier=0,
    efficiencyBrier=0,marketLoss=0,eloLoss=0,efficiencyLoss=0,
    maxMixture=0,everCrossed=false,challengerGames=0;
  for(const r of observations){
    logElo+=logRatio(r.market,r.elo,r.y);
    logEfficiency+=logRatio(r.market,r.efficiency,r.y);
    if(r.challengerPresent)challengerGames++;
    const m=score(r.market,r.y),a=score(r.elo,r.y),b=score(r.efficiency,r.y);
    marketBrier+=m.brier;eloBrier+=a.brier;efficiencyBrier+=b.brier;
    marketLoss+=m.logLoss;eloLoss+=a.logLoss;efficiencyLoss+=b.logLoss;
    const mixture=logMixture(logElo,logEfficiency);
    maxMixture=Math.max(maxMixture,mixture);
    if(mixture>=Math.log(SEQUENTIAL_PROTOCOL.evidenceLikelihoodRatioThreshold))everCrossed=true;
  }
  const n=observations.length;
  const publish=n>=SEQUENTIAL_PROTOCOL.minDistinctFinalGames;
  return {
    schema:1,version:SEQUENTIAL_PROTOCOL.version,protocol:SEQUENTIAL_PROTOCOL,
    study:'PROSPECTIVE_CONDITIONAL_MARKET_LIKELIHOOD_COMPARISON',
    source:'BETQ_IMMUTABLE_FORWARD_DERIVED_JOURNAL',
    predictionsFrozenBeforeLaterPrice:true,
    season:journal.season,
    allTrackedGames,firstQualifyingPregameGames:firstEligibleGames,
    eligibleSettledNonTieGames:n,eligibleChallengerGames:challengerGames,
    gamesNeededForDescriptiveScore:Math.max(0,SEQUENTIAL_PROTOCOL.minDistinctFinalGames-n),
    exclusions,
    publicationStatus:publish?'DESCRIPTIVE_EVIDENCE_ONLY_NO_BETTING_EDGE':'UNDER_MINIMUM_PROSPECTIVE_SAMPLE',
    evidenceConditionalOnTrueMarketProbabilities:true,
    sequentialNullProvenCorrect:false,
    correlationAdjusted:false,
    candidateEvidence:{
      eloLogLikelihoodRatio:publish?round(logElo,5):null,
      efficiencyLogLikelihoodRatio:publish?round(logEfficiency,5):null,
      fixedMixtureEvidence:publish?round(expSafe(logMixture(logElo,logEfficiency)),4):null,
      historicalMaxMixtureEvidence:publish?round(expSafe(maxMixture),4):null,
      crossedIllustrativeThreshold:publish?everCrossed:null
    },
    properScores:publish?{
      n,marketBrier:round(marketBrier/n,6),
      eloBrier:round(eloBrier/n,6),
      efficiencyBrierOnNeutralMissing:round(efficiencyBrier/n,6),
      marketLogLoss:round(marketLoss/n,6),
      eloLogLoss:round(eloLoss/n,6),
      efficiencyLogLossOnNeutralMissing:round(efficiencyLoss/n,6),
      marketMinusEloBrier:round((marketBrier-eloBrier)/n,6),
      marketMinusEloLogLoss:round((marketLoss-eloLoss)/n,6)
    }:null,
    economicViability:null,bookmakerEntryPriceVerified:false,
    bookmakerFillVerified:false,verifiedROI:null,verifiedCLV:null,
    independentProfitabilityProven:false,bettingAuthorized:false,
    modelPromoted:false,
    warning:'The derived sportsbook consensus is NOT proven the true sequential conditional probability; e-values are diagnostic, not exact real-world p-values, verified CLV or profitable bets.',
    limitations:[
      'One first eligible frozen forecast per game; never best historical model or price by hindsight.',
      'The financial market-derived probability may not be the true conditional outcome probability assumed by the likelihood-ratio null.',
      'Shared NFL teams, injuries and week shocks violate the simple conditional-null model unless captured in true p_i.',
      'The challenger contributes neutral market p when unavailable at the first qualified prediction; no later backfill.',
      'Every settlement is evaluated only once using its highest unambiguous revision.',
      'No live bet, accepted bookmaker price, actual CLV, realized ROI or financially executable edge is measured.'
    ]
  };
}

/**
 * Synthetic mathematical integrity test helper: previsible p, q only. No NFL
 * features, user data, real betting returns or sportsbook calls.
 */
export function evidencePath(p,q,y){
  if(!probability(p)||!probability(q)||![0,1].includes(y))
    throw Error('Invalid synthetic e-process probability/outcome');
  return logRatio(p,q,y);
}
