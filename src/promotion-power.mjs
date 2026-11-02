/**
 * BETQ promotion-gate power laboratory.
 * Pre-registered in docs/RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md.
 *
 * Uses the EXACT pre-existing residual research gate (fit + year rule + week
 * paired bootstrap) on synthetic worlds. The only performance shortcut is
 * omitting presentation-only per-year bootstrap/bin computation and using
 * 300 rather than 2000 POOLED bootstrap draws per world. No historical actual
 * final outcomes are used: game frames provide only market/time covariates.
 */
import {evaluateNestedResidualGate} from './residual-research.mjs';

const finite=Number.isFinite;
const clamp=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const logit=p=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const round=(n,d=5)=>finite(n)?Number(n.toFixed(d)):null;
const normalRandom=(uniform)=>Math.sqrt(-2*Math.log(Math.max(1e-12,uniform())))*
  Math.cos(2*Math.PI*uniform());
const seedRandom=(seed)=>{
  let state=(seed>>>0)||1;
  return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
};
const quantile=(sorted,p)=>{
  if(!sorted.length)return null;
  const t=(sorted.length-1)*p,lo=Math.floor(t),hi=Math.ceil(t);
  return lo===hi?sorted[lo]:sorted[lo]*(hi-t)+sorted[hi]*(t-lo);
};
const wilson95=(successes,n)=>{
  if(!n)return null;
  const z=1.96,p=successes/n,d=1+z*z/n;
  const center=(p+z*z/(2*n))/d;
  const spread=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [round(Math.max(0,100*(center-spread)),2),
    round(Math.min(100,100*(center+spread)),2)];
};

export const POWER_CELLS=Object.freeze([
  {id:'NULL_MARKET_IS_TRUE',s:0,rho:0.8,weekShockSd:0,coverage:1},
  {id:'WEAK_SIGNAL',s:.05,rho:0.8,weekShockSd:0,coverage:1},
  {id:'MODERATE_SIGNAL',s:.10,rho:0.8,weekShockSd:0,coverage:1},
  {id:'STRONGER_SIGNAL',s:.20,rho:0.8,weekShockSd:0,coverage:1},
  {id:'STRONGER_NOISY_SIGNAL',s:.20,rho:0.5,weekShockSd:0,coverage:1},
  {id:'STRONGER_WITH_WEEK_DEPENDENCE',s:.20,rho:0.8,weekShockSd:.15,coverage:1},
  {id:'CONTEXT_SPARSE_20_PERCENT',s:.20,rho:0.8,weekShockSd:0,coverage:.20}
]);

export const POWER_PROTOCOL=Object.freeze({
  version:'betq-promotion-power-v1',
  worldsPerCell:2000,seed:20261102,pairedBootstrapDraws:300,
  testSeasons:[2022,2023,2024,2025],
  trainPriorSeasons:2,
  model:'TWO_YEAR_RIDGE_LOGISTIC_MARKET_PLUS_RESIDUAL',
  gate:'ORIGINAL_3_OF_4_POSITIVE_YEARS_AND_POOLED_WEEK_CI_FOR_BOTH_PROPER_SCORES',
  limitation:'Bootstrap 300 draws per simulated world approximates 2000-draw source gate.'
});

function validateFrames(byYear) {
  if(!(byYear instanceof Map))throw Error('Required year-indexed covariate frames');
  for(let season=2020;season<=2025;season++){
    const rows=byYear.get(season);
    if(!Array.isArray(rows)||rows.length<200||rows.length>500)throw Error('Invalid season covariate frame '+season);
    const ids=new Set();
    for(const r of rows){
      if(r.year!==season||typeof r.gameId!=='string'||ids.has(r.gameId)||
        !Number.isInteger(r.week)||r.week<1||r.week>25||
        !finite(r.market)||r.market<=0||r.market>=1)
        throw Error('Invalid frame record '+season);
      ids.add(r.gameId);
    }
  }
  return true;
}

/** A fixed seed and cell index define all random draws for an entire world. */
export function simulatePowerWorld(frames,cell,{seed=20261102,bootstrapDraws=300}={}){
  if(!cell||![cell.s,cell.rho,cell.weekShockSd,cell.coverage].every(finite)||
    cell.s<0||cell.s>1||cell.rho<0||cell.rho>1||
    cell.weekShockSd<0||cell.weekShockSd>.5||
    cell.coverage<=0||cell.coverage>1)
    throw Error('Invalid synthetic power cell');
  const uniform=seedRandom(seed),normal=()=>normalRandom(uniform);
  const byYear=new Map();
  let oracleGain=0,count=0,activeCount=0;
  for(let year=2020;year<=2025;year++){
    const converted=[],shocks=new Map();
    for(const r of frames.get(year)){
      const group=year+':'+r.week;
      if(!shocks.has(group))shocks.set(group,cell.weekShockSd*normal());
      const active=uniform()<cell.coverage;
      const z=normal(),noise=normal();
      const observed=active?(cell.rho*z+Math.sqrt(1-cell.rho**2)*noise):0;
      const trueLogit=logit(r.market)+(active?cell.s*z:0)+shocks.get(group);
      const trueP=sigmoid(trueLogit);
      const candidate=sigmoid(logit(r.market)+observed);
      const y=uniform()<trueP?1:0;
      oracleGain+=trueP*Math.log(trueP/r.market)+
        (1-trueP)*Math.log((1-trueP)/(1-r.market));
      count++;if(active)activeCount++;
      converted.push({
        ...r,actual:y,elo:candidate
      });
    }
    byYear.set(year,converted);
  }
  const out=evaluateNestedResidualGate(byYear,{
    sampleCI:bootstrapDraws,seed:seed^0x9e3779b9,analysisMode:'POWER'
  });
  const pc=out.pooled;
  const simple=pc.improvementLogLoss>0&&pc.improvementBrier>0&&
    (pc.pairedWeek95?.logLoss.lower??-1)>0;
  return {
    currentGatePassed:out.evidenceFlagPassed,
    pooledWeekLogLossGatePassed:simple,
    meanExpectedOracleLogLossGain:oracleGain/count,
    observedCoverage:activeCount/count,
    residualPooledLogLossGain:pc.improvementLogLoss,
    residualPooledBrierGain:pc.improvementBrier,
    positiveSeasons:pc.positiveSeasonCount
  };
}

/** World loops do not adapt based on observed performance. */
export function runPromotionPowerStudy(frames,{
  cells=POWER_CELLS,
  worldsPerCell=POWER_PROTOCOL.worldsPerCell,
  bootstrapDraws=POWER_PROTOCOL.pairedBootstrapDraws,
  seed=POWER_PROTOCOL.seed
}={}){
  validateFrames(frames);
  if(!Array.isArray(cells)||!cells.length||cells.length>10||
    !Number.isInteger(worldsPerCell)||worldsPerCell<1||worldsPerCell>3000||
    !Number.isInteger(bootstrapDraws)||bootstrapDraws<20||bootstrapDraws>2000||
    !Number.isInteger(seed))
    throw Error('Invalid bounded power protocol');
  const results=[];
  for(let c=0;c<cells.length;c++){
    const cell=cells[c];
    let strictPass=0,pooledPass=0,positive3=0,gain=0,oracle=0,coverage=0;
    const values=[];
    for(let w=0;w<worldsPerCell;w++){
      const worldSeed=(seed ^ Math.imul(c+1,0x9e3779b9) ^
        Math.imul(w+1,0x85ebca6b))>>>0;
      const result=simulatePowerWorld(frames,cell,{
        seed:worldSeed,bootstrapDraws
      });
      if(result.currentGatePassed)strictPass++;
      if(result.pooledWeekLogLossGatePassed)pooledPass++;
      if(result.positiveSeasons>=3)positive3++;
      gain+=result.residualPooledLogLossGain;
      oracle+=result.meanExpectedOracleLogLossGain;
      coverage+=result.observedCoverage;
      values.push(result.residualPooledLogLossGain);
    }
    values.sort((a,b)=>a-b);
    results.push({
      id:cell.id,signalLogitScale:cell.s,
      signalObservationCorrelation:cell.rho,
      weekShockSd:cell.weekShockSd,
      intendedSignalCoveragePercent:round(cell.coverage*100,2),
      observedSignalCoveragePercent:round(100*coverage/worldsPerCell,2),
      worlds:worldsPerCell,
      originalStrictGate:{
        approved:strictPass,passRatePercent:round(100*strictPass/worldsPerCell,2),
        wilson95Percent:wilson95(strictPass,worldsPerCell)
      },
      diagnosticPooledGate:{
        approved:pooledPass,passRatePercent:round(100*pooledPass/worldsPerCell,2),
        wilson95Percent:wilson95(pooledPass,worldsPerCell),
        multiplicityControlled:false,
        productionReady:false
      },
      threePositiveYearsRatePercent:round(100*positive3/worldsPerCell,2),
      meanOracleExpectedLogLossGain:round(oracle/worldsPerCell,6),
      meanFittedResidualLogLossGain:round(gain/worldsPerCell,6),
      fittedResidualLogLossGainP05:round(quantile(values,.05),6),
      fittedResidualLogLossGainMedian:round(quantile(values,.5),6),
      fittedResidualLogLossGainP95:round(quantile(values,.95),6)
    });
  }
  const nullResult=results.find(r=>r.id==='NULL_MARKET_IS_TRUE');
  return {
    schema:1,version:POWER_PROTOCOL.version,preregistered:true,
    protocol:'docs/RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md',
    modelPromoted:false,bettingAuthorized:false,verifiedROI:null,verifiedCLV:null,
    dataStatus:'SYNTHETIC_OUTCOMES_ON_SOURCE_DERIVED_GAME_FRAMES',
    realWorldFalsePositiveRateKnown:false,
    bootstrapDraws,worldsPerCell,seed,
    syntheticNullCheck:{
      scenario:'NULL_MARKET_IS_TRUE',
      isSingleCandidateOnly:true,
      estimatedFalseApprovalRatePercent:nullResult?.originalStrictGate.passRatePercent??null
    },
    results,
    limitations:[
      'Original two-year ridge logistic fit and season gate are identical to residual research, but the bootstrap is reduced to 300 resamples per synthetic world.',
      'Market has true Bernoulli probability by construction only in the efficient-market null cell.',
      'A power estimate requires a declared signal strength and observation correlation, not an inferred actual NFL edge.',
      'No correction for searching across the many models actually tried by BETQ in development.',
      'The simpler pooled-only gate is a diagnostic, not an authorized release or staking criterion.',
      'Marginal simulated success rates are not evidence that real-world pricing or execution is beatable.'
    ]
  };
}
