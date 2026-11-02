/**
 * Market-anchored challenger with *strictly prior-season* calibration.
 *
 * This is a retrospective closing-odds research benchmark. Closing odds are
 * NOT a historically accessible entry price; no ROI / CLV or automatic bet
 * recommendations are authorized by this research.
 *
 * alpha=0 => pure de-vigged market (no independent predictive contribution)
 * alpha=1 => original Elo. alpha is fitted only on PREVIOUS years.
 */
import { toDecimal } from './engine.mjs';

const WEIGHTS=Object.freeze([0,0.1,0.25,0.5,0.75,1]);
const finite=Number.isFinite,round=(n,d=5)=>finite(n)?Number(n.toFixed(d)):null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const winRate=(wins,denom)=>denom?round(100*wins/denom,2):null;
const clamp=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const logLoss=(p,y)=>-(y*Math.log(clamp(p))+(1-y)*Math.log(clamp(1-p)));
const blend=(pMarket,pElo,weight)=>clamp(pMarket+weight*(pElo-pMarket));

function validatedRows(report){
  if(!report||!Number.isInteger(report.season)||!Array.isArray(report.decisions))
    throw Error('Invalid season replay report');
  return report.decisions.filter(d=>d.priceAvailable&&d.actual!=='TIE'&&
    finite(d.closeMarketHomeProbability)&&d.closeMarketHomeProbability>0&&
    d.closeMarketHomeProbability<1&&finite(d.modelHomeProbability)&&
    d.modelHomeProbability>0&&d.modelHomeProbability<1&&
    (d.actual==='home'||d.actual==='away')).map(d=>({
      gameId:d.gameId,year:report.season,week:d.week,date:d.date,
      home:d.home,away:d.away,
      market:d.closeMarketHomeProbability,elo:d.modelHomeProbability,
      actual:d.actual==='home'?1:0,selectedSide:d.selectedSide,
      estimatedEV:d.estimatedEV
    }));
}
function grade(rows,weight){
  if(!rows.length)return {n:0,brier:null,logLoss:null,accuracy:null,calibrationGap:null};
  let brier=0,ll=0,correct=0,pred=0,actual=0;
  for(const x of rows){
    const p=blend(x.market,x.elo,weight),y=x.actual;
    brier+=(p-y)**2;
    ll+=logLoss(p,y);
    correct+=Number((p>=0.5)===(y===1));
    pred+=p;actual+=y;
  }
  return {n:rows.length,brier:round(brier/rows.length),logLoss:round(ll/rows.length),
    accuracyPercent:winRate(correct,rows.length),
    averageHomeProbability:round(pred/rows.length,4),
    actualHomeWinRate:round(actual/rows.length,4)};
}
function pairedWeekCI(rows,weight,{samples=1000,seed=97311}={}){
  if(rows.length<150)return null;
  const groups=new Map();
  for(const x of rows){
    const key=x.year+':'+x.week;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(x);
  }
  const clusters=[...groups.values()],arr=[];
  if(clusters.length<12)return null;
  let current=seed>>>0;
  const random=()=>((current=(Math.imul(current,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<samples;i++){
    let delta=0,count=0;
    for(let c=0;c<clusters.length;c++){
      const cluster=clusters[Math.floor(random()*clusters.length)];
      for(const x of cluster){
        delta+=(x.market-x.actual)**2-(blend(x.market,x.elo,weight)-x.actual)**2;
        count++;
      }
    }
    arr.push(delta/count);
  }
  arr.sort((a,b)=>a-b);
  return {method:'WEEK_CLUSTERED_BOOTSTRAP_1000',
    lower:round(arr[Math.floor(samples*0.025)]),
    upper:round(arr[Math.ceil(samples*0.975)-1]),
    mean:round(mean(arr))};
}

/** Only seasons < testSeason may tune the market/model blend. */
export function fitPriorMarketBlend(reports,testSeason){
  if(!Number.isInteger(testSeason)||testSeason<2020||testSeason>2099)
    throw Error('Invalid test season');
  const year1=testSeason-2,year2=testSeason-1;
  const selected=reports.filter(r=>r.season===year1||r.season===year2);
  if(selected.length!==2)throw Error('Missing prior-year market calibration');
  const rows=selected.flatMap(validatedRows);
  if(rows.length<350)throw Error('Insufficient paired prior-year closing moneylines');
  const evaluations=WEIGHTS.map(weight=>({weight,metrics:grade(rows,weight)}));
  const market=evaluations[0];
  const candidate=[...evaluations].sort((a,b)=>
    a.metrics.logLoss-b.metrics.logLoss||a.weight-b.weight)[0];
  // Fallback to market unless independent Elo reduces BOTH proper scores,
  // surpasses a meaningful minimum, and improves week-clustered bootstrap.
  const ci=pairedWeekCI(rows,candidate.weight);
  const improvement=market.metrics.brier-candidate.metrics.brier;
  const accepted=candidate.weight>0&&candidate.metrics.logLoss<market.metrics.logLoss-0.0005&&
    improvement>0.001&&ci?.lower>0;
  const weight=accepted?candidate.weight:0;
  return {
    testSeason,trainedOnYears:[year1,year2],
    eligibleHistoricalPairs:rows.length,
    chosenWeight:weight,
    candidateUnrestrictedWeight:candidate.weight,
    candidatePriorBrier:candidate.metrics.brier,
    marketPriorBrier:market.metrics.brier,
    priorBrierImprovement:round(improvement),
    confidence95:ci,acceptedIndependentContribution:accepted,
    candidateTrainingScores:evaluations.map(e=>({
      modelWeight:e.weight,brier:e.metrics.brier,logLoss:e.metrics.logLoss
    })),
    reason:accepted?'Prior paired outcomes supported limited independent adjustment':
      'No robust, prior-year evidence that Elo residual improves the market reference'
  };
}
function selector(rows,prices,rule){
  let selected=0,wins=0,losses=0,ties=0,net=0,stake=0,modelPred=0,marketPred=0;
  const report=[];
  for(const d of rows){
    const quote=prices.get(d.gameId);
    if(!quote||!['home','away'].includes(d.actual))continue;
    const marketFavorite=quote.homeMarketProbability>=0.5?'home':'away';
    const favoriteP=Math.max(quote.homeMarketProbability,quote.awayMarketProbability);
    if(favoriteP<rule.minFavoriteProbability)continue;
    if(rule.requireModelAgreement){
      const modelSide=d.modelHomeProbability>=0.5?'home':'away';
      if(modelSide!==marketFavorite)continue;
    }
    const price=marketFavorite==='home'?quote.homeAmerican:quote.awayAmerican;
    if(!finite(price))continue;
    const odds=toDecimal(price);
    if(!odds)continue;
    const win=marketFavorite===d.actual;
    const pnl=win?odds-1:-1;
    selected++;stake++;net+=pnl;
    if(win)wins++;else losses++;
    const selectedModelP=marketFavorite==='home'?d.modelHomeProbability:1-d.modelHomeProbability;
    modelPred+=selectedModelP;marketPred+=favoriteP;
    report.push({gameId:d.gameId,date:d.date,season:d.season,side:marketFavorite,
      selectedPrice:price,modeledProbability:round(selectedModelP,5),
      marketProbability:round(favoriteP,5),outcome:win?'WIN':'LOSS',pnl:round(pnl,4)});
  }
  return {
    ruleId:rule.id,minMarketFavoriteProbability:rule.minFavoriteProbability,
    requireModelAgreement:rule.requireModelAgreement,
    selectionMethod:'HISTORICAL_CLOSING_MARKET_FAVORITE_NOT_EX-ANTE_QUOTE',
    graded:selected,wins,losses,winRatePercent:winRate(wins,selected),
    averageMarketFavoriteProbabilityPercent:selected?round(100*marketPred/selected,2):null,
    averageEloSelectedProbabilityPercent:selected?round(100*modelPred/selected,2):null,
    netOneUnit:round(net,3),
    hypotheticalClosingPriceROIPercent:selected?round(net/stake*100,2):null,
    verifiedROI:null,verifiedCLV:null,executable:false,
    sampleSelections:report.slice(0,10)
  };
}

export function analyzeMarketChallenge(replayByYear,priceIndex,{
  testYears=[2022,2023,2024,2025]
}={}){
  const byYear=new Map(replayByYear.map(r=>[r.season,r]));
  const years=[];
  for(const testSeason of testYears){
    const current=byYear.get(testSeason);
    if(!current)throw Error('Missing annual replay '+testSeason);
    const fitted=fitPriorMarketBlend(replayByYear,testSeason);
    const rows=validatedRows(current);
    if(rows.length<200)throw Error('Insufficient paired target games '+testSeason);
    const original=grade(rows,1),market=grade(rows,0),blendScore=grade(rows,fitted.chosenWeight);
    const ci=pairedWeekCI(rows,fitted.chosenWeight);
    const decisions=current.decisions;
    const policies=[
      {id:'MARKET_FAVORITE_60',minFavoriteProbability:0.60,requireModelAgreement:false},
      {id:'MARKET_FAVORITE_65',minFavoriteProbability:0.65,requireModelAgreement:false},
      {id:'MARKET_FAVORITE_70',minFavoriteProbability:0.70,requireModelAgreement:false},
      {id:'MARKET_AND_ELO_AGREE_60',minFavoriteProbability:0.60,requireModelAgreement:true}
    ].map(rule=>selector(decisions,priceIndex,rule));
    const originalCandidates=current.decisions.filter(d=>d.priceAvailable&&d.actual!=='TIE'&&
      d.estimatedEV>=0.03&&d.selectedSide);
    let underdogs=0,disagreement=0,modelSum=0,marketSum=0;
    for(const g of originalCandidates){
      const marketP=g.selectedSide==='home'?g.closeMarketHomeProbability:1-g.closeMarketHomeProbability;
      if(marketP<0.5)underdogs++;
      if(marketP<0.45)disagreement++;
      modelSum+=g.selectedProbability;marketSum+=marketP;
    }
    years.push({
      season:testSeason,training:fitted,
      pairedGames:rows.length,
      originalElo:original,
      closingMarket:market,
      conservativelyCalibrated:blendScore,
      blendVsMarketBrier:round(market.brier-blendScore.brier),
      modelContributionWeight:fitted.chosenWeight,
      testWeekClusteredCI:ci,
      favoriteScenarios:policies,
      falseEdgeAudit:{
        original3PercentCandidates:originalCandidates.length,
        marketUnderdogCandidates:underdogs,
        marketUnderdogSharePercent:winRate(underdogs,originalCandidates.length),
        largeMarketDisagreementCandidates:disagreement,
        modelEstimatedWinPercent:originalCandidates.length?
          round(100*modelSum/originalCandidates.length,2):null,
        marketReferenceWinPercent:originalCandidates.length?
          round(100*marketSum/originalCandidates.length,2):null
      }
    });
  }
  const pooledPolicy={};
  for(const id of ['MARKET_FAVORITE_60','MARKET_FAVORITE_65','MARKET_FAVORITE_70','MARKET_AND_ELO_AGREE_60']){
    const matches=years.map(x=>x.favoriteScenarios.find(r=>r.ruleId===id));
    const games=matches.reduce((sum,r)=>sum+r.graded,0),
      wins=matches.reduce((sum,r)=>sum+r.wins,0),
      losses=matches.reduce((sum,r)=>sum+r.losses,0),
      net=matches.reduce((sum,r)=>sum+r.netOneUnit,0);
    pooledPolicy[id]={graded:games,wins,losses,
      winRatePercent:winRate(wins,games),netOneUnit:round(net,2),
      hypotheticalClosingPriceROIPercent:games?round(100*net/games,2):null,
      verifiedROI:null,executable:false};
  }
  return {
    schema:1,version:'market-challenge-v1',type:'STRICT_ANNUAL_HISTORICAL_MARKET_BENCHMARK',
    researchOnly:true,yearCount:years.length,
    blendFitMethod:'TWO_PREVIOUS_SEASONS_ONLY_WEEK_BLOCKED_CI',
    bookmakerSourceTimeVerified:false,confirmedExecutableEntry:false,
    marketProbabilityIsIndependentModel:false,
    verifiedROI:null,verifiedCLV:null,bettingAuthorized:false,
    favoriteScenarioPurpose:'Show that higher selection winner rates do not automatically yield profitable returns.',
    years,pooledPolicy,
    limitations:[
      'Closing prices were not historically available at the time of hypothetical selection; selection scenarios are hindsight-available prices.',
      'Market anchoring cannot produce an independent edge by itself.',
      'Weights are chosen only on prior-year paired outcomes; test-year outcomes are never fitted.',
      'Historical model development and thresholds have been inspected repeatedly; retrospective outcomes are not pristine prospective evidence.',
      'Market favorite selection is an illustrative hit-rate benchmark, not a proposed wagering strategy.',
      'No historical filled prices, true CLV or audited realized ROI exist in this source.'
    ]
  };
}
