/** Read-only subgroup diagnostics. Never choose a historical winner after its result. */
import {gradeRetainedGames} from './game-grading.mjs';
import {pairedWeekBootstrap} from './statistical-audit.mjs';
const MIN_SAMPLE=30;
const average=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const round=x=>Number(x.toFixed(6));
const side=p=>p===.5?'NO_DIRECTION':p>.5?'HOME':'AWAY';
function summarize(rows){
  const n=rows.length,ready=n>=MIN_SAMPLE;
  return {n,status:ready?'DESCRIPTIVE_ONLY':'UNDER_MINIMUM_SAMPLE',metrics:ready?{
    modelBrier:round(average(rows.map(g=>g.metrics.modelBrier))),
    marketBrier:round(average(rows.map(g=>g.metrics.marketBrier))),
    modelLogLoss:round(average(rows.map(g=>g.metrics.modelLogLoss))),
    marketLogLoss:round(average(rows.map(g=>g.metrics.marketLogLoss))),
    marketMinusModelBrier:round(average(rows.map(g=>g.metrics.brierImprovement))),
    weekSensitivity:pairedWeekBootstrap(rows.map(g=>({id:g.gameId,date:g.gameDate,
      baseline:g.marketHomeProbability,challenger:g.modelHomeProbability,outcome:g.result.outcome==='HOME'?1:0})))
  }:null};
}
export function auditProspectiveCohorts(journal,{now=Date.now()}={}){
  const grades=gradeRetainedGames(journal,{now});
  if(!grades.available)return {schema:1,available:false,reason:grades.reason};
  // Use the strict V2 paired cohort only. Reviewed BDL remains a separate descriptive policy.
  const paired=grades.games.filter(g=>g.status==='GRADED'&&g.result.sourceCorroborated&&g.metrics.marketBrier!==null);
  const groups={MODEL_FAVORS_MARKET_UNDERDOG:[],MODEL_FAVORS_MARKET_FAVORITE:[],MODEL_NO_DIRECTION:[],MARKET_EVEN:[]};
  const versions=new Map();
  for(const g of paired){
    const model=side(g.modelHomeProbability),market=side(g.marketHomeProbability);
    const key=model==='NO_DIRECTION'?'MODEL_NO_DIRECTION':market==='NO_DIRECTION'?'MARKET_EVEN':model===market?'MODEL_FAVORS_MARKET_FAVORITE':'MODEL_FAVORS_MARKET_UNDERDOG';
    groups[key].push(g);
    // Version strings are labels, not proof of equal training artifacts.
    const version=g.modelVersion??'UNSPECIFIED';
    if(!versions.has(version))versions.set(version,[]);
    versions.get(version).push(g);
  }
  return {schema:1,available:true,researchOnly:true,minimumPerCohort:MIN_SAMPLE,
    selectionPolicy:'FIRST_FROZEN_FORECAST_V2_QUALIFIED_SAME_CAPTURE_MARKET',
    coverage:{trackedGames:grades.games.length,strictPairedGames:paired.length,
      reviewedBdlExcluded:grades.coverage.reviewedBdlGradedGames,
      otherGamesExcluded:grades.games.length-paired.length-grades.coverage.reviewedBdlGradedGames},
    overall:summarize(paired),
    directionCohorts:Object.fromEntries(Object.entries(groups).map(([key,rows])=>[key,summarize(rows)])),
    modelVersionCohorts:[...versions].sort(([a],[b])=>a.localeCompare(b)).map(([modelVersion,rows])=>({modelVersion,...summarize(rows)})),
    verifiedEdge:false,verifiedROI:false,modelPromotionAllowed:false,
    limitations:[
      'An underdog is defined by qualified same-capture market probability, not team reputation or later results.',
      'First frozen predictions are never replaced with later more accurate forecasts.',
      'Each reported subgroup needs 30 qualified games; that threshold is descriptive, not proof of skill.',
      'Subgroups are exploratory and multiple comparisons are not corrected. Do not promote a winning subgroup.',
      'Version labels may pool different training artifacts. Changing model inputs requires a new preregistered prospective test.',
      'Missing market provenance prevents underdog classification; no historical quote timestamps are reconstructed.'
    ]};
}
