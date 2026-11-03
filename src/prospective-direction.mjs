/**
 * BETQ.ai Prospective Market-Movement Direction Evidence (research only).
 *
 * The only input is the existing append-only 2026 forward journal containing
 * PRE-KICKOFF independent forecasts and derived NO-VIG median market prices.
 * This does NOT claim independent sportsbook quote history, a fill, CLV,
 * cash returns, profit, or source-verified news timing.
 *
 * Rule frozen before results:
 *  - take first valid pregame quote/model snapshot per game;
 *  - take latest *later* quote at least 15 minutes after first;
 *  - study only first-model market disagreements >=3 probability points;
 *  - directional grading only if observed market moved >=0.5 points;
 *  - report rate only after >=30 individually distinct qualifying games;
 *  - no threshold optimization, book prices, stake, or trading advice.
 */
import {validateJournal} from './evidence.mjs';
const isP=n=>Number.isFinite(n)&&n>0&&n<1;
const at=s=>typeof s==='string'&&s.trim()?Date.parse(s):NaN;
const round=(n,d=3)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
export const MOVEMENT_PROTOCOL=Object.freeze({
  version:'betq-prospective-direction-v1',
  minimumGapProbabilityPoints:3,
  minimumMovementProbabilityPoints:0.5,
  minimumMinutesBetweenObservations:15,
  minimumQualifyingGamesToReport:30,
  minimumBooks:3,
  predictionSource:'FIRST_IMMUTABLE_PREGAME_ELO',
  marketSource:'NO_VIG_MULTI_BOOK_MEDIAN_NOT_BOOK_SPECIFIC_ENTRY'
});

function admissible(s){
  if(!s||s.marketBasis!=='NO_VIG_MULTI_BOOK_MEDIAN'||
     !isP(s.marketHomeProbability)||!isP(s.modelHomeProbability)||
     !Number.isInteger(s.marketBookCount)||s.marketBookCount<3||
     !Number.isFinite(at(s.capturedAt))||
     !Number.isFinite(at(s.sourceReceivedAt))||
     !Number.isFinite(at(s.marketNewestQuoteAt))||
     !Number.isFinite(at(s.modelBuiltAt))||
     !Number.isFinite(at(s.commenceTime)))return false;
  const capture=at(s.capturedAt),received=at(s.sourceReceivedAt),
    provider=at(s.marketNewestQuoteAt),model=at(s.modelBuiltAt),kick=at(s.commenceTime);
  return capture<kick&&received<=capture+60000&&received>=capture-600000&&
    provider<=received+60000&&provider<=capture+60000&&
    provider<kick&&model<=capture+60000&&model<kick&&
    s.independentModel===true&&s.researchOnly===true;
}
function wilson(w,n){
  if(!n)return null;
  const z=1.96,p=w/n,d=1+z*z/n;
  const center=(p+z*z/(2*n))/d;
  const spread=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [round(100*Math.max(0,center-spread),2),
    round(100*Math.min(1,center+spread),2)];
}
export function summarizeProspectiveDirection(journal,{
  minGapPoints=MOVEMENT_PROTOCOL.minimumGapProbabilityPoints,
  minMovePoints=MOVEMENT_PROTOCOL.minimumMovementProbabilityPoints,
  minDelayMinutes=MOVEMENT_PROTOCOL.minimumMinutesBetweenObservations,
  reportAt=MOVEMENT_PROTOCOL.minimumQualifyingGamesToReport
}={}){
  validateJournal(journal);
  if(![minGapPoints,minMovePoints,minDelayMinutes,reportAt].every(Number.isFinite)||
     minGapPoints<0||minGapPoints>20||minMovePoints<=0||minMovePoints>10||
     minDelayMinutes<10||minDelayMinutes>240||
     !Number.isInteger(reportAt)||reportAt<30)
    throw Error('Invalid pre-registered market-movement evaluation');
  const byGame=new Map(),ignored={
    invalidSource:0,missingQuotes:0,notSeparated:0,
    modelNotStable:0,disagreementTooSmall:0,moveTooSmall:0
  };
  for(const shot of journal.snapshots){
    if(!byGame.has(shot.gameId))byGame.set(shot.gameId,[]);
    byGame.get(shot.gameId).push(shot);
  }
  const rows=[];
  for(const [id,shots] of byGame){
    const sorted=[...shots].sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
    const safe=sorted.filter(admissible);
    if(!safe.length){ignored.invalidSource++;continue;}
    if(safe.length<2){ignored.missingQuotes++;continue;}
    const initial=safe[0],firstAt=at(initial.capturedAt),
      kickoffAt=at(initial.commenceTime);
    // A different game schedule or changed pregame model is not a paired trial.
    const later=safe.filter(s=>s.id!==initial.id&&
      s.home===initial.home&&s.away===initial.away&&
      s.providerEventId===initial.providerEventId&&
      s.commenceTime===initial.commenceTime&&
      s.modelVersion===initial.modelVersion&&
      s.modelBuiltAt===initial.modelBuiltAt&&
      at(s.capturedAt)-firstAt>=minDelayMinutes*60000&&
      at(s.capturedAt)<kickoffAt &&
      at(s.marketNewestQuoteAt)>at(initial.marketNewestQuoteAt)
    ).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt));
    if(!later.length){
      const separated=safe.some(s=>at(s.capturedAt)-firstAt>=minDelayMinutes*60000);
      if(separated)ignored.modelNotStable++;else ignored.notSeparated++;
      continue;
    }
    const end=later.at(-1);
    const gap=(initial.modelHomeProbability-initial.marketHomeProbability)*100;
    if(Math.abs(gap)<minGapPoints){ignored.disagreementTooSmall++;continue;}
    const change=(end.marketHomeProbability-initial.marketHomeProbability)*100;
    const matched=Math.sign(gap)===Math.sign(change);
    const isMove=Math.abs(change)>=minMovePoints;
    if(!isMove)ignored.moveTooSmall++;
    rows.push({
      gameId:id,gameDate:initial.gameDate,
      initialCapturedAt:initial.capturedAt,laterCapturedAt:end.capturedAt,
      initialMarketP:round(initial.marketHomeProbability,6),
      laterMarketP:round(end.marketHomeProbability,6),
      modelHomeProbability:round(initial.modelHomeProbability,6),
      firstModelMarketGapPoints:round(gap),
      observedMarketShiftPoints:round(change),
      signedMovementTowardModelPoints:round(Math.sign(gap)*change),
      separatedMinutes:round((at(end.capturedAt)-firstAt)/60000,1),
      directionTestable:isMove,
      directionMatched:isMove?matched:null,
      priceIsBookSpecific:false,actualWagerFillVerified:false,
      qbPublicationLinked:false,marketImpactCausal:false
    });
  }
  const testable=rows.filter(x=>x.directionTestable);
  const matched=testable.filter(x=>x.directionMatched).length;
  const n=testable.length,qualified=n>=reportAt;
  const directionAccuracy=qualified?round(100*matched/n,2):null;
  const meanSigned=qualified?round(testable.reduce((a,x)=>a+x.signedMovementTowardModelPoints,0)/n,3):null;
  return {
    schema:1,version:MOVEMENT_PROTOCOL.version,
    provenance:'FORWARD_JOURNAL_DERIVED_MARKET_CONSENSUS_ONLY',
    season:journal.season,sourceBasedOnPrivateBookmakerQuotes:false,
    realMoneyROI:null,verifiedCLV:null,bettingAuthorized:false,
    modelPromoted:false,marketBeatingEdgeEstablished:false,
    predictionsFrozenBeforeLaterPrice:true,
    studyStatus:qualified?'RESEARCH_SAMPLE_OBSERVED_NOT_AN_EDGE':'INSUFFICIENT_PROSPECTIVE_DIRECTION_SAMPLE',
    protocol:MOVEMENT_PROTOCOL,
    gamesWithSnapshots:byGame.size,gamesWithEligiblePairedObservations:rows.length,
    candidateMarketMovements:n,
    qualifyingDirectionMatches:matched,qualifyingDirectionMisses:n-matched,
    noMaterialMovement:rows.filter(x=>!x.directionTestable).length,
    excluded:ignored,
    reportThreshold:reportAt,missingToReport:Math.max(0,reportAt-n),
    directionMatchPercent:directionAccuracy,
    descriptiveWilson95Percent:qualified?wilson(matched,n):null,
    meanSignedMovementTowardModelPoints:meanSigned,
    headlineMetric:null, // No known executable edge or profitability can be inferred.
    preview:rows.slice(0,12).map(x=>({
      matchup:x.gameId,date:x.gameDate,firstGapPoints:x.firstModelMarketGapPoints,
      laterObservedMovePoints:x.observedMarketShiftPoints,
      direction:x.directionTestable?(x.directionMatched?'MATCH':'OPPOSITE'):'BELOW_MINIMUM_MOVE',
      minutesSeparated:x.separatedMinutes
    })),
    limitations:[
      'Each game is graded once using only its first recorded pregame projection and a later independently captured market consensus.',
      'A derived no-vig market probability is not a book-specific entry price; no fill or authentic CLV exists.',
      'This is correlation with later market consensus, not proof the market copied BETQ or BETQ caused a movement.',
      'The same forecast and kickoff context are required at both timestamps to prevent invalid contract pairing.',
      'Samples may share NFL teams and weeks; Wilson interval is purely descriptive, not week-clustered causal inference.',
      'The 30-game reporting threshold permits descriptive rates only; a much larger prospective cohort is needed before model validation.'
    ]
  };
}
