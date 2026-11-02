/**
 * BETQ.ai NFL season replay, chronological & source-honest.
 *
 * Each test season is scored with model parameters trained ONLY on earlier
 * seasons. Elo pregame forecasts for games on the same calendar day are frozen
 * together BEFORE any outcomes from that day are applied.
 *
 * Price data are nflverse/PFR CLOSING MONEYLINES, not timestamped historical
 * offers that a bettor could have locked. Selection ROI is a retrospective
 * closing-price hypothetical, NEVER verified fill/CLV/realized ROI.
 */
import { noVigPair, toDecimal } from './engine.mjs';
import { calibrate, eloProbability, canonicalTeam } from './nfl-elo.mjs';

export const REPLAY_VERSION='nfl-replay-v2';
export const DEFAULT_THRESHOLDS=Object.freeze([0,0.03,0.05]);
const K_GRID=[12,20,28,40,52], HFA_GRID=[25,40,55,70,85], REGRESSION=[0.25,0.35];
const SCALES=[0.6,0.75,0.9,1,1.1,1.25];
const finite=Number.isFinite;
const round=(n,d=5)=>finite(n)?Number(n.toFixed(d)):null;
const logLoss=(p,y)=>-(y*Math.log(Math.max(1e-6,Math.min(1-1e-6,p)))+
 (1-y)*Math.log(Math.max(1e-6,Math.min(1-1e-6,1-p))));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;

function validMoneyline(s){
  const trimmed=String(s??'').trim();
  if(!/^[+-]?\d{3,5}$/.test(trimmed))return null;
  const n=Number(trimmed);
  return Number.isInteger(n)&&n!==0&&Math.abs(n)>=100&&Math.abs(n)<=50000?n:null;
}

/** Read odds separately: model game data deliberately do not contain prices. */
export function indexedHistoricalClosing(rows){
  if(!Array.isArray(rows))throw Error('Schedules rows missing');
  const prices=new Map();
  for(const r of rows){
    if(!r?.game_id)continue;
    const home=validMoneyline(r.home_moneyline),away=validMoneyline(r.away_moneyline);
    if(home===null||away===null)continue;
    const rawHome=1/toDecimal(home),rawAway=1/toDecimal(away);
    const overround=rawHome+rawAway-1;
    if(!finite(overround)||overround<0||overround>0.17)continue;
    const fair=noVigPair(home,away);
    if(!fair)continue;
    prices.set(String(r.game_id),{
      homeAmerican:home,awayAmerican:away,
      homeMarketProbability:fair[0],awayMarketProbability:fair[1],
      overround:round(overround,6),
      basis:'RETROSPECTIVE_UNTIMESTAMPED_CLOSING_MONEYLINE'
    });
  }
  return prices;
}

/** Forecast all games from one date before revealing any result from that date. */
export function walkForwardByDay(games,params={}){
  const k=params.k??25,hfa=params.homeAdv??55,
        regression=params.regression??0.32,scale=params.scale??1;
  if(![k,hfa,regression,scale].every(finite)||k<=0||k>100||
     regression<0||regression>1||scale<=0)throw Error('Invalid pregame Elo parameters');
  const history=[],rating=new Map();
  let season=null,at=0,previousDay='';
  while(at<games.length){
    const first=games[at];
    if(first.season!==season){
      if(season!==null)for(const [team,value] of rating)
        rating.set(team,1500+(value-1500)*(1-regression));
      season=first.season;
    }
    const date=first.date,group=[];
    while(at<games.length&&games[at].season===season&&games[at].date===date)
      group.push(games[at++]);
    // Day-frozen: no same-date final enters any other pregame forecast.
    const pending=group.map(game=>{
      const h=rating.get(game.home)??1500,a=rating.get(game.away)??1500;
      const raw=eloProbability(h,a,hfa,game.neutral);
      return {game,prediction:calibrate(raw,scale),raw,homeRating:h,awayRating:a};
    });
    for(const p of pending)history.push({
      ...p.game,prediction:p.prediction,rawProbability:p.raw,
      homeRating:p.homeRating,awayRating:p.awayRating,
      actual:p.game.homeScore===p.game.awayScore?0.5:
        p.game.homeScore>p.game.awayScore?1:0
    });
    // Replay updates only after the day's predictions have been frozen.
    for(const p of pending){
      const result=p.game.homeScore===p.game.awayScore?0.5:
        p.game.homeScore>p.game.awayScore?1:0;
      const change=k*(result-p.raw);
      rating.set(p.game.home,(rating.get(p.game.home)??1500)+change);
      rating.set(p.game.away,(rating.get(p.game.away)??1500)-change);
    }
    previousDay=date;
  }
  return {history,ratings:Object.fromEntries(rating),throughDate:previousDay};
}

function score(rows,scale=1){
  const eligible=rows.filter(r=>r.actual!==0.5);
  if(!eligible.length)return {n:0,brier:null,logLoss:null,accuracy:null};
  let bs=0,ll=0,correct=0;
  for(const r of eligible){
    const p=calibrate(r.rawProbability,scale),y=r.actual;
    bs+=(p-y)**2;ll+=logLoss(p,y);
    correct+=Number((p>=0.5)===(y===1));
  }
  return {n:eligible.length,brier:bs/eligible.length,
    logLoss:ll/eligible.length,accuracy:correct/eligible.length};
}

/**
 * Frozen model selection for target season:
 *  - 5 years of parameter tuning (test-7 ... test-3)
 *  - 2 independent pre-test years for calibration (test-2,test-1)
 *  - NEVER the target season's outcome.
 */
export function fitBeforeSeason(games,testSeason){
  if(!Number.isInteger(testSeason)||testSeason<2008||testSeason>2099)
    throw Error('Invalid historical test season');
  const seen=games.filter(g=>g.season<testSeason);
  const tuneStart=testSeason-7,tuneEnd=testSeason-3;
  const calibrateStart=testSeason-2,calibrateEnd=testSeason-1;
  if(games.some(g=>g.season===testSeason)===false)throw Error('Missing test season');
  let winner=null;
  for(const k of K_GRID)for(const homeAdv of HFA_GRID)for(const regression of REGRESSION){
    const p={k,homeAdv,regression,scale:1};
    const h=walkForwardByDay(seen,p).history;
    const selected=h.filter(g=>g.season>=tuneStart&&g.season<=tuneEnd);
    const quality=score(selected,1);
    if(quality.n<600)continue;
    if(!winner||quality.logLoss<winner.quality.logLoss)
      winner={k,homeAdv,regression,quality};
  }
  if(!winner)throw Error('Insufficient prior tuning seasons for '+testSeason);
  const raw=walkForwardByDay(seen,{...winner,scale:1}).history;
  const cal=raw.filter(g=>g.season>=calibrateStart&&g.season<=calibrateEnd);
  let best=null;
  for(const scale of SCALES){
    const quality=score(cal,scale);
    if(quality.n<350)continue;
    if(!best||quality.logLoss<best.quality.logLoss)best={scale,quality};
  }
  if(!best)throw Error('Insufficient prior calibration for '+testSeason);
  return {
    params:{k:winner.k,homeAdv:winner.homeAdv,
      regression:winner.regression,scale:best.scale},
    tunedYears:[tuneStart,tuneEnd],
    calibrationYears:[calibrateStart,calibrateEnd],
    testSeason,tuning:{n:winner.quality.n,logLoss:round(winner.quality.logLoss)},
    calibration:{n:best.quality.n,logLoss:round(best.quality.logLoss)}
  };
}

function candidateForGame(game,p,closing){
  if(!closing)return {status:'NO_CLOSING_PRICE'};
  const homeEv=p*toDecimal(closing.homeAmerican)-1,
        awayEv=(1-p)*toDecimal(closing.awayAmerican)-1;
  const choose=homeEv>=awayEv?'home':'away';
  return {
    status:'PRICED',side:choose,price:choose==='home'?closing.homeAmerican:closing.awayAmerican,
    probability:choose==='home'?p:1-p,
    expectedEV:Math.max(homeEv,awayEv),
    marketFair:choose==='home'?closing.homeMarketProbability:closing.awayMarketProbability,
    priceBasis:closing.basis
  };
}
function percentage(a,b){return b?round(100*a/b,2):null;}
function wilson(w,n){
  if(!n)return null;
  const z=1.96,phat=w/n,denom=1+z*z/n;
  const midpoint=(phat+z*z/(2*n))/denom,
    margin=z*Math.sqrt(phat*(1-phat)/n+z*z/(4*n*n))/denom;
  return [round(Math.max(0,midpoint-margin),4),round(Math.min(1,midpoint+margin),4)];
}
export function summarizeSelections(games,threshold=0.03,{examples=15}={}){
  const candidates=games.filter(g=>g.priceAvailable&&g.estimatedEV>=threshold);
  let wins=0,losses=0,ties=0,net=0,stake=0,peak=0,maxDD=0,
      streak=0,maxStreak=0,modelProbTotal=0,marketProbTotal=0,
      impliedProbTotal=0,predictedEVTotal=0,probN=0;
  const reviewed=[];
  for(const g of candidates){
    if(g.actual==='TIE'){ties++;continue;}
    const won=g.selectedSide===g.actual;
    if(won){wins++;streak=0;}
    else{losses++;maxStreak=Math.max(maxStreak,++streak);}
    const d=toDecimal(g.selectedOdds);
    const pnl=won?(d-1):-1;
    net+=pnl;stake++;
    if(finite(g.selectedProbability)&&finite(g.closeMarketHomeProbability)&&
       finite(g.estimatedEV)&&finite(d)){
      const marketP=g.selectedSide==='home'?
        g.closeMarketHomeProbability:1-g.closeMarketHomeProbability;
      modelProbTotal+=g.selectedProbability;
      marketProbTotal+=marketP;
      impliedProbTotal+=1/d;
      predictedEVTotal+=g.estimatedEV;
      probN++;
    }
    peak=Math.max(peak,net);
    maxDD=Math.max(maxDD,peak-net);
    reviewed.push({...g,grade:won?'WIN':'LOSS',pnlUnits:round(pnl)});
  }
  const n=wins+losses;
  return {
    rule:'ONE_SIDE_PER_GAME_FIXED_PROBABILITY_EV_GATE',
    thresholdEVPercent:round(100*threshold,2),
    pricedCandidates:candidates.length,
    graded:n,wins,losses,tiesExcluded:ties,
    winRatePercent:percentage(wins,n),
    expectedSelectionWinRatePercent:probN?percentage(modelProbTotal,probN):null,
    referenceMarketWinProbabilityPercent:probN?percentage(marketProbTotal,probN):null,
    averageOfferedImpliedProbabilityPercent:probN?percentage(impliedProbTotal,probN):null,
    meanEstimatedEVPercent:probN?percentage(predictedEVTotal,probN):null,
    actualMinusForecastWinPoints:probN?
      round(100*(wins/n-modelProbTotal/probN),2):null,
    wilson95: wilson(wins,n),
    hypotheticalNetUnits:round(net,2),
    hypotheticalRiskedUnits:stake,
    hypotheticalClosingPriceROI:percentage(net,stake),
    maxConsecutiveLosses:maxStreak,
    maximumUnitDrawdown:round(maxDD,2),
    stakeRule:'FLAT_ONE_UNIT',
    historicalBookFillVerified:false,
    returnStatus:'RETROSPECTIVE_CLOSING_PRICE_ONLY_NOT_EXECUTABLE',
    clvAvailable:false,realizedROI:null,
    examples:reviewed.slice(0,examples)
  };
}

/**
 * Per-season objective:
 * - forecast quality measured on EVERY non-tie game
 * - pick success only on predeclared fixed EV gate against closing prices
 * - market benchmark only where both valid closing moneylines exist
 */
export function replaySeason(games,closingIndex,testSeason,{
  thresholds=DEFAULT_THRESHOLDS,exampleCount=18
}={}){
  const fit=fitBeforeSeason(games,testSeason);
  // Model forecasts are independent of closing prices. Applying the chosen
  // parameters retrospectively to the completed year is valid for a game-day
  // Elo update only because its own outcome is applied AFTER each frozen day.
  const replay=walkForwardByDay(games.filter(g=>g.season<=testSeason),fit.params);
  const tested=replay.history.filter(g=>g.season===testSeason);
  let valid=0,compared=0,modelBrier=0,marketBrier=0,
      modelLL=0,marketLL=0,correct=0,marketFavoriteCorrect=0;
  const decisions=[];
  for(const game of tested){
    const tie=game.actual===0.5;
    const closing=closingIndex.get(game.id);
    const p=game.prediction;
    const candidate=candidateForGame(game,p,closing);
    if(!tie){
      valid++;
      modelBrier+=(p-game.actual)**2;
      modelLL+=logLoss(p,game.actual);
      correct+=Number((p>=0.5)===(game.actual===1));
      if(closing){
        compared++;
        marketBrier+=(closing.homeMarketProbability-game.actual)**2;
        marketLL+=logLoss(closing.homeMarketProbability,game.actual);
        marketFavoriteCorrect+=Number((closing.homeMarketProbability>=0.5)===(game.actual===1));
      }
    }
    const decision={
      gameId:game.id,season:testSeason,date:game.date,week:game.week,
      home:game.home,away:game.away,
      modelHomeProbability:round(p,6),
      homeRatingAsOf:round(game.homeRating,2),
      awayRatingAsOf:round(game.awayRating,2),
      priceAvailable: Boolean(closing),
      closeMarketHomeProbability:closing?round(closing.homeMarketProbability,6):null,
      selectedSide:candidate.side||null,
      selectedOdds:candidate.price??null,
      selectedProbability:candidate.probability===undefined?null:round(candidate.probability,6),
      estimatedEV:candidate.expectedEV===undefined?null:round(candidate.expectedEV,6),
      actual:tie?'TIE':game.actual===1?'home':'away',
      finalScore:game.awayScore+'-'+game.homeScore,
      selectionStatus:candidate.status,
      quoteTimeVerified:false,
      modelBuiltUsingTestOutcomes:false,
      notes:tie?'Tie settlement rules not available; excludes pick grade':null
    };
    decisions.push(decision);
  }
  const rates=thresholds.map(t=>summarizeSelections(decisions,t,{examples:exampleCount}));
  return {
    season:testSeason,
    model:'SEASON_PRE_FIT_ELO_DAY_FROZEN',
    fit, games:tested.length,nonTieGames:valid,tiesExcluded:tested.length-valid,
    closingMoneylineCoverage:{validGamesWithBothPrices:compared,
      missingOnNonTies:valid-compared,coveragePercent:percentage(compared,valid)},
    allGameForecast:{n:valid,correct,incorrect:valid-correct,
      accuracyPercent:percentage(correct,valid),
      brier:valid?round(modelBrier/valid,5):null,
      logLoss:valid?round(modelLL/valid,5):null},
    closingMarketBenchmark:compared?{
      n:compared,brier:round(marketBrier/compared,5),
      favoriteWinnerAccuracyPercent:percentage(marketFavoriteCorrect,compared),
      logLoss:round(marketLL/compared,5),
      // Model score must use precisely the paired subset, computed separately.
      pairedModelBrier:round(decisions.filter(d=>d.priceAvailable&&d.actual!=='TIE')
        .reduce((sum,d)=>sum+(d.modelHomeProbability-Number(d.actual==='home'))**2,0)/compared,5),
      benchmark:'DE_VIGGED_RETROSPECTIVE_CLOSING_MONEYLINES'
    }:null,
    selectionRules:rates,
    note:'Closing prices have no verified historical quote time, fill, bookmaker identity, injury/availability snapshot or true CLV.',
    decisions
  };
}

export function buildSeasonReplay(games,sourceRows,{
  seasons=[2022,2023,2024,2025],thresholds=DEFAULT_THRESHOLDS,exampleCount=18
}={}){
  if(!Array.isArray(games)||!games.length)throw Error('Historical completed NFL games missing');
  const ordered=[...games].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const prices=indexedHistoricalClosing(sourceRows);
  const years=seasons.map(year=>replaySeason(ordered,prices,year,{thresholds,exampleCount}));
  const pooled={};
  for(const threshold of thresholds){
    const decisions=years.flatMap(y=>y.decisions);
    pooled[String(round(100*threshold,2))]=summarizeSelections(decisions,threshold,{examples:25});
  }
  return {
    schema:1,version:REPLAY_VERSION,
    sport:'americanfootball_nfl',type:'RETROSPECTIVE_WALK_FORWARD_RESEARCH',
    modelParametersRelearnedEachSeason:true,simulatedAsOf:'PRE_SEASON_FIT_PLUS_PRE_GAME_DAY_FREEZE',
    source:{
      name:'nflverse/nflverse-data schedules',credit:'nflverse / Lee Sharpe (CC BY 4.0)',
      url:'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv',
      odds:'Recorded closing moneylines, no historical quote times/book fills'
    },
    betExecutionVerified:false,verifiedCLV:false,verifiedROI:false,
    confidenceSource:'HISTORICAL_REPLAY_NOT_PROSPECTIVE',
    strategyRule:'At most one side per game; estimated closing-price EV threshold selected BEFORE evaluating outcomes.',
    defaultThresholdEVPercent:3,
    markets:['full-game moneyline'],sideAvailability:'home or away, no draw settlement',
    years,aggregateByThreshold:pooled,
    audit:[
      'Every target test year chooses Elo parameters only from seasons before that year',
      'Calibration seasons are before the tested season and disjoint from tuning',
      'Games on the same calendar day are forecast simultaneously, then results are applied',
      'The closing line is known only as a historical price reference, not a true pregame entry fill',
      'No CLV can be calculated from a single closing price',
      'Strategies are retrospectively assessed and are not independent prospective investment results',
      'Selections and thresholds are not optimized based on test-season returns',
      'Tie games excluded from graded hypothetical bets; count disclosed',
      'Accuracy measures all games, not just filtered candidate picks'
    ]
  };
}
