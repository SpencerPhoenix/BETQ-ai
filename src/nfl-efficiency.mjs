/**
 * Walk-forward NFL efficiency challenger. The challenger NEVER replaces the
 * deployed Elo model without independent holdout evidence.
 *
 * All derived EPA and success-rate features are lagged: the current game's
 * aggregate is added only AFTER its prediction is recorded. Historical
 * calibration/holdout windows remain disjoint.
 */
import {pairedWeekBootstrap} from './statistical-audit.mjs';
import {timestamp, sourceDateFresh, nflGameDate, isProbability} from './integrity.mjs';
import { walkForward, eloProbability, calibrate, NFL_TEAMS, canonicalTeam } from './nfl-elo.mjs';

const rounded=(n,d=6)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const sigmoid=x=>1/(1+Math.exp(-clamp(x,-25,25)));
const logit=p=>Math.log(clamp(p,1e-6,1-1e-6)/(1-clamp(p,1e-6,1-1e-6)));
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const HOURS=86400000;
const seasonTime=x=>Date.parse(x+'T12:00:00Z');

function trend(rows) {
  if(!rows?.length)return null;
  const last=rows.slice(-8);
  // Recent games have greater weight; no future game can enter this history.
  const nums={off:0,def:0,succOff:0,succDef:0,weight:0,plays:0};
  for(let i=0;i<last.length;i++){
    const e=last[i],age=last.length-1-i,w=Math.pow(0.83,age);
    nums.off+=e.offEPA*w;nums.def+=e.defEPA*w;
    nums.succOff+=e.offSuccess*w;nums.succDef+=e.defSuccess*w;
    nums.weight+=w;nums.plays+=e.offPlays;
  }
  return {n:last.length,offEPA:nums.off/nums.weight,defEPA:nums.def/nums.weight,
    offSuccess:nums.succOff/nums.weight,defSuccess:nums.succDef/nums.weight,
    netEPA:(nums.off-nums.def)/nums.weight,
    netSuccess:(nums.succOff-nums.succDef)/nums.weight,
    latestGameDate:last[last.length-1].date,plays:nums.plays};
}
function priorRest(gameDate,history) {
  const last=history?.at(-1);
  if(!last)return 7;
  return clamp(Math.round((seasonTime(gameDate)-seasonTime(last.date))/HOURS),0,18);
}
export function efficiencyInputs(home,away,gameDate,histories) {
  const h=trend(histories.get(home)),a=trend(histories.get(away));
  if(!h||!a||h.n<4||a.n<4)return {available:false,reason:'INSUFFICIENT_PRIOR_COMPLETED_GAMES'};
  if(!Number.isFinite(seasonTime(gameDate)))return {available:false,reason:'INVALID_GAMEDAY'};
  // There is no future information: histories contain only previously processed games.
  const hRest=priorRest(gameDate,histories.get(home));
  const aRest=priorRest(gameDate,histories.get(away));
  const restDiff=clamp(hRest-aRest,-10,10);
  return {available:true,epaDiff:clamp(h.netEPA-a.netEPA,-2,2),
    successDiff:clamp(h.netSuccess-a.netSuccess,-1,1),
    restDiff,homePriorGames:h.n,awayPriorGames:a.n,
    homeEPA:rounded(h.offEPA,4),homeAllowedEPA:rounded(h.defEPA,4),
    awayEPA:rounded(a.offEPA,4),awayAllowedEPA:rounded(a.defEPA,4),
    homeSuccess:rounded(h.offSuccess,4),awaySuccess:rounded(a.offSuccess,4),
    homeRestDays:hRest,awayRestDays:aRest,
    homeLastCompleted:h.latestGameDate,awayLastCompleted:a.latestGameDate};
}

export function chronologicalFeatures(games,pbpById,eloParams) {
  const walk=walkForward(games,eloParams);
  const histories=new Map(),records=[];
  const push=(team,stat,date)=>{
    if(!histories.has(team))histories.set(team,[]);
    const h=histories.get(team);
    h.push({...stat,date});
    if(h.length>8)h.shift();
  };
  for(let i=0;i<games.length;i++){
    const game=games[i],before=walk.history[i];
    const inputs=efficiencyInputs(game.home,game.away,game.date,histories);
    if(inputs.available && game.homeScore!==game.awayScore)records.push({
      id:game.id,season:game.season,date:game.date,actual:game.homeScore>game.awayScore?1:0,
      eloProbability:before.prediction,rawElo:before.rawProbability,
      ...inputs
    });
    const stats=pbpById[game.id];
    if(stats?.home===game.home && stats?.away===game.away){
      push(game.home,stats.homeStats,game.date);
      push(game.away,stats.awayStats,game.date);
    }
  }
  return {records,histories,
    coverage:{historicalGames:games.length,featureReadyGames:records.length}};
}
function predictOne(row,c) {
  return sigmoid(logit(row.eloProbability) +
    c.epa*row.epaDiff + c.success*row.successDiff + c.rest*row.restDiff);
}
function scoring(rows,c) {
  if(!rows.length)return {n:0,brier:null,logLoss:null,accuracy:null};
  let brier=0,logLoss=0,accuracy=0;
  for(const row of rows){
    const p=clamp(predictOne(row,c),1e-6,1-1e-6),y=row.actual;
    brier+=(p-y)**2;
    logLoss-=y*Math.log(p)+(1-y)*Math.log(1-p);
    accuracy+=Number((p>=0.5)===(y===1));
  }
  return {n:rows.length,brier:rounded(brier/rows.length,5),
    logLoss:rounded(logLoss/rows.length,5),
    accuracy:rounded(accuracy/rows.length,4)};
}
function pairedBootstrap(rows,coefs) {
  if(rows.length<180)return null;
  const differences=rows.map(r=>(r.eloProbability-r.actual)**2-(predictOne(r,coefs)-r.actual)**2);
  let seed=421637;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const sums=[];
  for(let b=0;b<2000;b++){
    let total=0;
    for(let j=0;j<differences.length;j++)total+=differences[Math.floor(rnd()*differences.length)];
    sums.push(total/differences.length);
  }
  sums.sort((a,b)=>a-b);
  return {method:'PAIRED_BOOTSTRAP_2000',lower:rounded(sums[49],5),
    upper:rounded(sums[1949],5),mean:rounded(mean(differences),5)};
}
const baseline={epa:0,success:0,rest:0};
export function fitEfficiencyChallenger(games,pbpById,eloParams,{
  asOf=new Date().toISOString()
}={}) {
  const {records,histories,coverage}=chronologicalFeatures(games,pbpById,eloParams);
  const tuning=records.filter(r=>r.season>=2018&&r.season<=2022);
  const calibrating=records.filter(r=>r.season>=2023&&r.season<=2024);
  const holdout=records.filter(r=>r.season===2025);
  if(tuning.length<850||calibrating.length<400||holdout.length<230)
    throw Error('Insufficient disjoint NFL EPA/Elo data for independent evaluation: '+
      [tuning.length,calibrating.length,holdout.length].join('/'));
  let best=null;
  for(const epa of [0,0.5,1,1.5,2,3]){
    for(const success of [0,1,2,3,4]){
      for(const rest of [0,0.01,0.02,0.04]){
        const candidate={epa,success,rest};
        const sample=scoring(tuning,candidate);
        if(!best||sample.logLoss<best.score.logLoss)best={coefs:candidate,score:sample};
      }
    }
  }
  // Independent calibration window. The 2025 holdout is never used to select coefficients.
  let calibrated=null;
  for(const factor of [0.6,0.8,1,1.15,1.3]){
    const c=Object.fromEntries(Object.entries(best.coefs).map(([k,v])=>[k,v*factor]));
    const m=scoring(calibrating,c);
    if(!calibrated||m.logLoss<calibrated.score.logLoss)
      calibrated={factor,coefs:c,score:m};
  }
  const baseline2025=scoring(holdout,baseline);
  const challenger2025=scoring(holdout,calibrated.coefs);
  const ci=pairedBootstrap(holdout,calibrated.coefs);
  const weekSensitivity=pairedWeekBootstrap(holdout.map(r=>({
    id:r.id,date:r.date,outcome:r.actual,baseline:r.eloProbability,
    challenger:predictOne(r,calibrated.coefs)
  })));
  // Requiring both proper scoring improvements AND positive lower CI is a strong gate.
  const promotable=challenger2025.brier+0.002<baseline2025.brier &&
    challenger2025.logLoss<baseline2025.logLoss && ci.lower>0 &&
    weekSensitivity.available && weekSensitivity.lower>0;
  const teamFeatures={};
  for(const [team,h] of histories) {
    const t=trend(h);
    if(t)teamFeatures[team]=Object.fromEntries(
      Object.entries(t).filter(([k])=>k!=='plays').map(([k,v])=>[k,typeof v==='number'?rounded(v,5):v])
    );
  }
  return {
    schema:1,version:'nfl-efficiency-1',evaluationVersion:2,generatedAt:asOf,
    source:'NFLVERSE_PBP_CC_BY_4_0',type:'INDEPENDENT_CHALLENGER_RESEARCH',
    training:{
      tune:'2018-2022',calibrate:'2023-2024',untouchedHoldout:'2025',
      minPriorGamesPerTeam:4,trendGames:8
    },
    tuning:best.score,calibration:calibrated.score,holdout:{
      elo:baseline2025,challenger:challenger2025,
      deltaBrier:rounded(baseline2025.brier-challenger2025.brier,5),
      confidence95:ci,weekSensitivity,
      referenceSeasonPreviouslyInspected:true
    },
    coefficients:calibrated.coefs,coefficientScale:calibrated.factor,
    readyForResearch:true,promotable,
    coverage,teamFeatures,
    limitations:[
      '2018-2025 historical EPA values are retrospective and may be revised by nflverse',
      'Quarterback / injured-starter status is not verified or modeled',
      'Rest is derived from previous completed team game dates, not itinerary',
      'Future games are excluded from feature history',
      'A holdout Brier improvement does not establish profitable bookmaker execution',
      'Challenger is never automatically promoted based solely on a positive point estimate'
    ]
  };
}
export function challengerResearchForEvent(event,eloHomeProbability,artifact,now=Date.now()) {
  if(!artifact||artifact.version!=='nfl-efficiency-1'||!artifact.readyForResearch)
    return {available:false,reason:'CHALLENGER_NOT_VALIDATED'};
  const at=Date.parse(artifact.generatedAt);
  if(!Number.isFinite(at)||at>now+60000||now-at>7*86400000)
    return {available:false,reason:'FEATURE_SOURCE_STALE'};
  const kick=timestamp(event?.commence_time);
  if(!Number.isFinite(now)||!Number.isFinite(kick)||kick<=now) return {available:false,reason:'INVALID_OR_STARTED_EVENT'};
  const home=NFL_TEAMS[event?.home_team],away=NFL_TEAMS[event?.away_team];
  if(!home||!away||home===away||!isProbability(eloHomeProbability)||!artifact.teamFeatures)
    return {available:false,reason:'UNMAPPED_NFL_EVENT'};
  const ht=artifact.teamFeatures[home],atTeam=artifact.teamFeatures[away];
  const gameDate=nflGameDate(event);
  if(!ht||!atTeam||ht.n<4||atTeam.n<4)
    return {available:false,reason:'TEAM_EPA_HISTORY_INSUFFICIENT'};
  if (![ht,atTeam].every(t=>sourceDateFresh(t.latestGameDate,now,28) &&
      ['netEPA','netSuccess','offEPA','defEPA'].every(k=>Number.isFinite(t[k]))) ||
      !artifact.coefficients || !['epa','success','rest'].every(k=>Number.isFinite(artifact.coefficients[k])))
    return {available:false,reason:'TEAM_FEATURES_STALE_OR_INVALID'};
  const restDiff=clamp(
    clamp(Math.round((seasonTime(gameDate)-seasonTime(ht.latestGameDate))/HOURS),0,18)-
    clamp(Math.round((seasonTime(gameDate)-seasonTime(atTeam.latestGameDate))/HOURS),0,18),-10,10);
  const inputs={
    epaDiff:clamp(ht.netEPA-atTeam.netEPA,-2,2),
    successDiff:clamp(ht.netSuccess-atTeam.netSuccess,-1,1),restDiff
  };
  const p=predictOne({eloProbability:eloHomeProbability,...inputs},artifact.coefficients);
  return {
    available:true,modelVersion:artifact.version,independentOfOdds:true,
    status:artifact.promotable?'CHALLENGER_VALIDATED_HOLDOUT':'UNPROMOTED_CHALLENGER',
    researchOnly:true,automaticSelection:false,
    homeWinProbability:rounded(p),awayWinProbability:rounded(1-p),
    baselineEloProbability:rounded(eloHomeProbability),
    holdout:artifact.holdout,
    inputs:{
      epaDifferential:rounded(inputs.epaDiff,4),successDifferential:rounded(inputs.successDiff,4),
      restDaysDifferential:restDiff,
      homeOffEPA:ht.offEPA,homeDefAllowedEPA:ht.defEPA,
      awayOffEPA:atTeam.offEPA,awayDefAllowedEPA:atTeam.defEPA,
      priorHomeGames:ht.n,priorAwayGames:atTeam.n
    },
    source:artifact.source,generatedAt:artifact.generatedAt,
    injuryAdjusted:false,startingQuarterbackVerified:false,
    weatherAdjusted:false
  };
}
