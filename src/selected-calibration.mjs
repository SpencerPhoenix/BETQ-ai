/**
 * Offline descriptive calibration of the first qualified Elo-selected side.
 * No model fitting, configurable selection, promotion or wagering path.
 */
import {selectQualifiedForwardObservations} from './market-sequential.mjs';
import {weekBlock} from './statistical-audit.mjs';

export const SELECTED_CALIBRATION_PROTOCOL=Object.freeze({
  version:'betq-selected-calibration-v1',
  selection:'ELO_MORE_LIKELY_SIDE_AT_FIRST_QUALIFIED_SNAPSHOT',
  probabilityBoundaries:Object.freeze([0.5,0.6,0.7,0.8,0.9,1]),
  exactlyEvenForecast:'EXCLUDE_WITHOUT_SELECTING_A_SIDE',
  minimumGamesPerDisplayedCohort:30,
  minimumCalendarWeeksForSensitivity:8,
  calendarWeek:'MONDAY_UTC_OF_SCHEDULED_KICKOFF',
  bootstrapRepeats:2000,
  bootstrapSeed:381771,
  intervalLevel:0.95,
  analysis:'DESCRIPTIVE_NOT_PREREGISTERED_CONFIRMATORY_EVIDENCE'
});
const protocol=SELECTED_CALIBRATION_PROTOCOL;
const round=x=>Number.isFinite(x)?Number(x.toFixed(6)):null;
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;

// Pointwise binomial reference only: NFL games need not be independent or
// identically distributed. This is not a confidence interval for each pick.
function wilson(wins,n){
  const z=1.959963984540054,p=wins/n,z2=z*z,d=1+z2/n;
  const center=(p+z2/(2*n))/d;
  const spread=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return {method:'WILSON_BINOMIAL_REFERENCE',level:protocol.intervalLevel,
    lower:round(Math.max(0,center-spread)),upper:round(Math.min(1,center+spread)),
    pointwise:true,correlationAdjusted:false};
}
function weekSensitivity(rows,blocks){
  const common={method:'CALENDAR_WEEK_BLOCK_BOOTSTRAP_SENSITIVITY',
    level:protocol.intervalLevel,repeats:protocol.bootstrapRepeats,
    weeks:blocks.size,available:false,observedRate:null,observedMinusPredicted:null,
    limitation:'Resamples whole calendar weeks; recurring teams, cross-week dependence and repeated inspection remain unadjusted.'};
  if(rows.length<protocol.minimumGamesPerDisplayedCohort||
     blocks.size<protocol.minimumCalendarWeeksForSensitivity)
    return {...common,reason:'INSUFFICIENT_GAMES_OR_WEEKS'};
  let state=protocol.bootstrapSeed;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const list=[...blocks.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,b])=>b);
  const rates=[],gaps=[];
  for(let draw=0;draw<protocol.bootstrapRepeats;draw++){
    let n=0,wins=0,predicted=0;
    for(let i=0;i<list.length;i++){
      const block=list[Math.floor(random()*list.length)];
      n+=block.n;wins+=block.wins;predicted+=block.predicted;
    }
    rates.push(wins/n);gaps.push((wins-predicted)/n);
  }
  const interval=values=>{
    values.sort((a,b)=>a-b);
    return {lower:round(values[Math.floor(values.length*.025)]),
      upper:round(values[Math.ceil(values.length*.975)-1])};
  };
  return {...common,available:true,reason:null,
    observedRate:interval(rates),observedMinusPredicted:interval(gaps)};
}
function cohort(rows){
  const blocks=new Map(),versions=new Map();
  for(const row of rows){
    if(!blocks.has(row.week))blocks.set(row.week,{n:0,wins:0,predicted:0});
    const block=blocks.get(row.week);block.n++;block.wins+=row.y;block.predicted+=row.p;
    const version=typeof row.modelVersion==='string'?row.modelVersion:'UNRECORDED';
    versions.set(version,(versions.get(version)||0)+1);
  }
  const n=rows.length,display=n>=protocol.minimumGamesPerDisplayedCohort;
  const wins=rows.reduce((sum,row)=>sum+row.y,0);
  return {
    n,calendarWeeks:blocks.size,
    modelVersions:[...versions.entries()].sort(([a],[b])=>a.localeCompare(b))
      .map(([version,count])=>({version,n:count})),
    status:display?'DESCRIPTIVE_RESEARCH_ONLY':'INSUFFICIENT_QUALIFIED_DATA',
    insufficientData:!display,
    gamesNeededForDisclosure:Math.max(0,protocol.minimumGamesPerDisplayedCohort-n),
    metrics:display?{
      wins,meanPredictedProbability:round(mean(rows.map(row=>row.p))),
      observedWinRate:round(wins/n),
      observedMinusPredicted:round(mean(rows.map(row=>row.y-row.p))),
      sameSideMarketMeanProbability:round(mean(rows.map(row=>row.market))),
      observedRateInterval95:wilson(wins,n)
    }:null,
    weekSensitivity:weekSensitivity(rows,blocks)
  };
}

export function summarizeSelectedCalibration(journal){
  const qualified=selectQualifiedForwardObservations(journal);
  const rows=qualified.observations.filter(row=>row.elo!==0.5).map(row=>{
    const home=row.elo>0.5;
    return {gameId:row.gameId,modelVersion:row.modelVersion,
      week:weekBlock(new Date(row.scheduledAt).toISOString().slice(0,10)),
      p:home?row.elo:1-row.elo,y:home?row.y:1-row.y,
      market:home?row.market:1-row.market};
  });
  const overall=cohort(rows);
  return {
    schema:1,version:protocol.version,protocol,
    source:'EXISTING_QUALIFIED_FORWARD_DERIVED_JOURNAL',season:journal.season,
    researchOnly:true,selectionChosenWithoutOutcomes:true,
    status:overall.status,
    allTrackedGames:qualified.allTrackedGames,
    firstQualifyingPregameGames:qualified.firstEligibleGames,
    eligibleSettledNonTieGames:qualified.observations.length,
    selectedSideGames:rows.length,
    exclusions:{...qualified.exclusions,
      exactlyEvenModel:qualified.observations.length-rows.length},
    overall,
    bands:protocol.probabilityBoundaries.slice(0,-1).map((from,i)=>{
      const to=protocol.probabilityBoundaries[i+1];
      // A valid tiny home p can round 1-p to exactly 1 in floating point.
      const upperInclusive=to===1;
      return {from,to,lowerInclusive:true,upperInclusive,
        ...cohort(rows.filter(row=>row.p>=from&&(row.p<to||(upperInclusive&&row.p===to))))};
    }),
    calibrationEstablished:false,marketBeatingEdgeEstablished:false,
    independentProfitabilityProven:false,modelPromoted:false,bettingAuthorized:false,
    verifiedROI:null,verifiedCLV:null,
    limitations:[
      'Thirty games is a disclosure floor per cohort, not adequate power, precision or proof of calibration.',
      'Bins and selection are fixed in this report version, but the existing journal has been inspected; this is not a new untouched holdout.',
      'Wilson intervals are pointwise binomial reference intervals, not simultaneous, sequentially valid or dependence-adjusted guarantees.',
      'A week-block interval is only sensitivity analysis, not a full correction for recurring-team or cross-week dependence.',
      'The selected-side sample conditions on the model, source availability and non-tie outcomes; it does not validate every forecast or future game.',
      'Pooled model versions are disclosed and may differ; no model or band is selected for promotion.',
      'Same-side no-vig market probability is a descriptive comparator, not an executable price, expected profit, fill, closing line or realized return.',
      'No confidence tier, betting recommendation, automatic promotion or execution authority is granted.'
    ]
  };
}
