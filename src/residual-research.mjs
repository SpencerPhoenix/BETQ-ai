/**
 * BETQ pre-registered residual-information / disagreement / null-edge study.
 * Experiments H1-H3 are fixed in docs/RESEARCH_PROTOCOL_RESIDUAL_2026_11_02.md
 * BEFORE this code is run on actual source results.
 *
 * Every season's coefficients and disagreement deciles use ONLY the preceding
 * two calendar NFL seasons. Historical closing odds are not time-aligned
 * executable prices; every output remains retrospective research only.
 */
const finite=Number.isFinite;
const clamp=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const logit=p=>Math.log(clamp(p)/(1-clamp(p)));
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const round=(x,n=5)=>finite(x)?Number(x.toFixed(n)):null;
const total=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?total(a)/a.length:null;
const percentile=(sorted,p)=>{
  if(!sorted.length)return null;
  const pos=(sorted.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?sorted[lo]:sorted[lo]*(hi-pos)+sorted[hi]*(pos-lo);
};
const ll=(p,y)=>-(y*Math.log(clamp(p))+(1-y)*Math.log(clamp(1-p)));
const SELECTED_YEARS=Object.freeze([2022,2023,2024,2025]);
export const RESIDUAL_RESEARCH_VERSION='betq-residual-research-v1';
export const PRE_REGISTERED=Object.freeze({
  testYears:SELECTED_YEARS,trainingYearsBeforeTarget:2,
  ridgeSlope:20,ridgeIntercept:2,iterations:35,
  uncertaintyResamples:2000,nullWorlds:400,nullSeed:20261102,
  binCount:10,gateMinimumPositiveYears:3,
  protocol:'docs/RESEARCH_PROTOCOL_RESIDUAL_2026_11_02.md'
});

function features(row,dim){
  const market=logit(row.market);
  return dim===3?[1,market,logit(row.elo)-market]:[1,market];
}
function linear(x,beta){let result=0;for(let j=0;j<x.length;j++)result+=x[j]*beta[j];return result;}
function solveLinear(a,b){
  const n=b.length,A=a.map((r,i)=>[...r,b[i]]);
  for(let i=0;i<n;i++){
    let best=i;
    for(let j=i+1;j<n;j++)if(Math.abs(A[j][i])>Math.abs(A[best][i]))best=j;
    if(Math.abs(A[best][i])<1e-9)throw Error('Logistic ridge Hessian singular');
    [A[i],A[best]]=[A[best],A[i]];
    const d=A[i][i];
    for(let j=i;j<=n;j++)A[i][j]/=d;
    for(let k=0;k<n;k++)if(k!==i){
      const factor=A[k][i];
      for(let j=i;j<=n;j++)A[k][j]-=factor*A[i][j];
    }
  }
  return A.map(r=>r[n]);
}
function penaltyAt(i,lambda){return i===0?2:lambda;}
function priorAt(i){return i===1?1:0;}
function scoreObjective(rows,beta,lambda,dim){
  let score=0;
  for(const r of rows){const x=features(r,dim),p=sigmoid(linear(x,beta));score+=ll(p,r.actual);}
  for(let j=0;j<dim;j++)score+=penaltyAt(j,lambda)*(beta[j]-priorAt(j))**2/2;
  return score;
}

/** Ridge Newton logistic: pre-registered hyperparameter, no outcome-dependent model search. */
export function fitPriorLogistic(rows,{residual=false,lambda=20,maxIterations=35}={}){
  const dim=residual?3:2;
  if(!Array.isArray(rows)||rows.length<350||
     !finite(lambda)||lambda<=0||
     !Number.isInteger(maxIterations)||maxIterations<1||maxIterations>100)
    throw Error('Insufficient or invalid nested prior training');
  const beta=dim===3?[0,1,0]:[0,1];
  for(let iteration=0;iteration<maxIterations;iteration++){
    const grad=Array(dim).fill(0);
    const hessian=Array.from({length:dim},()=>Array(dim).fill(0));
    for(const row of rows){
      const x=features(row,dim),p=sigmoid(linear(x,beta));
      const w=Math.max(1e-8,p*(1-p)),err=p-row.actual;
      for(let j=0;j<dim;j++){
        grad[j]+=err*x[j];
        for(let k=0;k<dim;k++)hessian[j][k]+=w*x[j]*x[k];
      }
    }
    for(let j=0;j<dim;j++){
      grad[j]+=penaltyAt(j,lambda)*(beta[j]-priorAt(j));
      hessian[j][j]+=penaltyAt(j,lambda);
    }
    const step=solveLinear(hessian,grad);
    if(step.some(x=>!finite(x)))throw Error('Nonfinite fitted coefficient');
    const old=scoreObjective(rows,beta,lambda,dim);
    let rate=1,changed=false,maxMove=0;
    while(rate>=1/1024){
      const proposed=beta.map((b,j)=>Math.max(j===0?-2:-3,Math.min(3,b-rate*step[j])));
      if(scoreObjective(rows,proposed,lambda,dim)<=old+1e-9){
        for(let j=0;j<dim;j++){maxMove=Math.max(maxMove,Math.abs(proposed[j]-beta[j]));beta[j]=proposed[j];}
        changed=true;break;
      }
      rate/=2;
    }
    if(!changed||maxMove<1e-8)break;
  }
  if(beta.some(v=>!finite(v)))throw Error('Invalid fitted logistic coefficients');
  return {intercept:round(beta[0],8),marketLogitWeight:round(beta[1],8),
    modelResidualWeight:dim===3?round(beta[2],8):0,
    featureMode:residual?'MARKET_LOGIT_PLUS_ELO_RESIDUAL':'MARKET_CALIBRATION_ONLY',
    trainingN:rows.length,lambda,interceptPenalty:2};
}
export function fittedProbability(row,params){
  if(!params||!finite(params.intercept)||!finite(params.marketLogitWeight)||
     !finite(params.modelResidualWeight))throw Error('Invalid logistic model');
  return sigmoid(params.intercept+params.marketLogitWeight*logit(row.market)+
    params.modelResidualWeight*(logit(row.elo)-logit(row.market)));
}
export function rowsFromReplay(replay){
  if(!replay||!Number.isInteger(replay.season)||!Array.isArray(replay.decisions))throw Error('Invalid historical replay');
  return replay.decisions.filter(d=>d.priceAvailable===true&&d.actual!=='TIE'&&
    (d.actual==='home'||d.actual==='away')&&
    finite(d.closeMarketHomeProbability)&&d.closeMarketHomeProbability>0&&d.closeMarketHomeProbability<1&&
    finite(d.modelHomeProbability)&&d.modelHomeProbability>0&&d.modelHomeProbability<1&&
    Number.isInteger(d.week)&&d.week>=1&&d.week<=25
  ).map(d=>({
    gameId:d.gameId,year:replay.season,week:d.week,date:d.date,
    market:d.closeMarketHomeProbability,elo:d.modelHomeProbability,
    actual:d.actual==='home'?1:0
  })).sort((a,b)=>a.date.localeCompare(b.date)||a.gameId.localeCompare(b.gameId));
}
function evaluate(rows,predictions){
  if(rows.length!==predictions.length)throw Error('Prediction-row mismatch');
  const n=rows.length;
  if(!n)return {n:0,brier:null,logLoss:null,accuracy:null};
  let brier=0,logloss=0,correct=0,meanP=0,meanY=0;
  for(let i=0;i<n;i++){
    const p=predictions[i],y=rows[i].actual;
    if(!finite(p)||p<=0||p>=1)throw Error('Invalid evaluated probability');
    brier+=(p-y)**2;logloss+=ll(p,y);
    correct+=Number((p>=0.5)===(y===1));meanP+=p;meanY+=y;
  }
  return {n,brier:round(brier/n,6),logLoss:round(logloss/n,6),
    accuracyPercent:round(correct/n*100,2),
    averagePredictedHome:round(meanP/n),observedHomeRate:round(meanY/n)};
}
function weekClusteredPairedCI(rows,reference,challenger,{resamples=2000,seed=20261102}={}){
  const blocks=new Map();
  for(let i=0;i<rows.length;i++){
    const k=rows[i].year+':'+rows[i].week;
    if(!blocks.has(k))blocks.set(k,{brier:0,logLoss:0,n:0});
    const block=blocks.get(k),y=rows[i].actual;
    block.brier+=(reference[i]-y)**2-(challenger[i]-y)**2;
    block.logLoss+=ll(reference[i],y)-ll(challenger[i],y);
    block.n++;
  }
  const arr=[...blocks.values()];
  if(arr.length<10||rows.length<100)return null;
  let state=seed>>>0;
  const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const brier=[],logloss=[];
  for(let r=0;r<resamples;r++){
    let b=0,l=0,n=0;
    for(let i=0;i<arr.length;i++){
      const chosen=arr[Math.floor(rand()*arr.length)];
      b+=chosen.brier;l+=chosen.logLoss;n+=chosen.n;
    }
    brier.push(b/n);logloss.push(l/n);
  }
  brier.sort((a,b)=>a-b);logloss.sort((a,b)=>a-b);
  return {
    method:'WEEK_CLUSTERED_PAIRED_PERCENTILE',resamples,clusters:arr.length,
    brier:{lower:round(percentile(brier,.025),6),upper:round(percentile(brier,.975),6)},
    logLoss:{lower:round(percentile(logloss,.025),6),upper:round(percentile(logloss,.975),6)}
  };
}
const cutoffsFor=(rows,binCount=10)=>{
  const sorted=rows.map(r=>Math.abs(r.elo-r.market)).sort((a,b)=>a-b);
  if(sorted.length<350)throw Error('Insufficient prior disagreement examples');
  return Array.from({length:binCount-1},(_,i)=>percentile(sorted,(i+1)/binCount));
};
function disagreementRow(row){
  const homePreferred=row.elo>=row.market;
  return {magnitude:Math.abs(row.elo-row.market),
    pModel:homePreferred?row.elo:1-row.elo,
    pMarket:homePreferred?row.market:1-row.market,
    won:homePreferred?row.actual:1-row.actual};
}
function disagreementBins(rows,priorRows,{count=10}={}){
  const cutoffs=cutoffsFor(priorRows,count);
  const bins=Array.from({length:count},(_,i)=>({
    decile:i+1,n:0,forecastModelSum:0,forecastMarketSum:0,outcomeSum:0,
    modelBrierSum:0,marketBrierSum:0,disagreeSum:0
  }));
  for(const row of rows){
    const item=disagreementRow(row);
    let index=0;while(index<cutoffs.length&&item.magnitude>cutoffs[index])index++;
    const b=bins[index];b.n++;
    b.forecastModelSum+=item.pModel;b.forecastMarketSum+=item.pMarket;
    b.outcomeSum+=item.won;b.disagreeSum+=item.magnitude;
    b.modelBrierSum+=(item.pModel-item.won)**2;
    b.marketBrierSum+=(item.pMarket-item.won)**2;
  }
  return {
    priorYearCutoffProbabilityPoints:cutoffs.map(v=>round(100*v,3)),
    bins:bins.map(b=>({
      decile:b.decile,n:b.n,
      averageDisagreementPoints:b.n?round(100*b.disagreeSum/b.n,3):null,
      modelFavoredSideForecastPercent:b.n?round(100*b.forecastModelSum/b.n,2):null,
      marketFavoredSideReferencePercent:b.n?round(100*b.forecastMarketSum/b.n,2):null,
      actualModelSideWinPercent:b.n?round(100*b.outcomeSum/b.n,2):null,
      modelOverconfidencePoints:b.n?round(100*(b.forecastModelSum-b.outcomeSum)/b.n,2):null,
      marketOverconfidencePoints:b.n?round(100*(b.forecastMarketSum-b.outcomeSum)/b.n,2):null,
      modelBrier:b.n?round(b.modelBrierSum/b.n,6):null,
      marketBrier:b.n?round(b.marketBrierSum/b.n,6):null,
      note:b.n<40?'LOW_BIN_SAMPLE_INTERPRET_CAUTIOUSLY':'RETROSPECTIVE_ONLY'
    }))
  };
}
export function evaluateNestedResidualGate(byYear,{
  sampleCI=2000,seed=20261102,analysisMode='FULL'
}={}){
  const out=[],combinedRows=[],combinedMarket=[],combinedCalibrated=[],combinedResidual=[];
  for(const testYear of SELECTED_YEARS){
    const earlier=[...(byYear.get(testYear-2)||[]),...(byYear.get(testYear-1)||[])];
    const holdout=byYear.get(testYear)||[];
    if(earlier.length<350||holdout.length<200)throw Error('Not enough independent earlier-year examples '+testYear);
    const marketCal=fitPriorLogistic(earlier,{residual:false});
    const residual=fitPriorLogistic(earlier,{residual:true});
    const market=holdout.map(x=>x.market);
    const cal=holdout.map(x=>fittedProbability(x,marketCal));
    const corrected=holdout.map(x=>fittedProbability(x,residual));
    const original=holdout.map(x=>x.elo);
    const ci=analysisMode==='POWER'?null:
      weekClusteredPairedCI(holdout,cal,corrected,{resamples:sampleCI,seed:seed+testYear});
    out.push({
      season:testYear,trainedSeasons:[testYear-2,testYear-1],
      originalElo:evaluate(holdout,original),
      closingMarket:evaluate(holdout,market),
      calibratedMarket:evaluate(holdout,cal),
      incrementalResidual:evaluate(holdout,corrected),
      coefficients:{marketOnly:marketCal,residualModel:residual},
      calibratedMarketMinusResidualBrier:round(evaluate(holdout,cal).brier-evaluate(holdout,corrected).brier,6),
      calibratedMarketMinusResidualLogLoss:round(evaluate(holdout,cal).logLoss-evaluate(holdout,corrected).logLoss,6),
      confidence95:ci,
      disagreementAudit:analysisMode==='POWER'?null:disagreementBins(holdout,earlier)
    });
    combinedRows.push(...holdout);combinedMarket.push(...market);
    combinedCalibrated.push(...cal);combinedResidual.push(...corrected);
  }
  const pooledCI=weekClusteredPairedCI(combinedRows,combinedCalibrated,combinedResidual,{resamples:sampleCI,seed});
  const pm=evaluate(combinedRows,combinedMarket),
    pc=evaluate(combinedRows,combinedCalibrated),
    pr=evaluate(combinedRows,combinedResidual);
  const positiveYears=out.filter(x=>
    x.calibratedMarketMinusResidualBrier>0&&x.calibratedMarketMinusResidualLogLoss>0).length;
  const gatePassed=positiveYears>=3&&pc.brier>pr.brier&&pc.logLoss>pr.logLoss&&
    (pooledCI?.brier.lower??-1)>0&&(pooledCI?.logLoss.lower??-1)>0;
  return {
    perSeason:out,pooled:{
      closingMarket:pm,calibratedMarket:pc,incrementalResidual:pr,
      improvementBrier:round(pc.brier-pr.brier,6),
      improvementLogLoss:round(pc.logLoss-pr.logLoss,6),
      pairedWeek95:pooledCI,positiveSeasonCount:positiveYears
    },
    evidenceFlagPassed:gatePassed
  };
}
function nullWorlds(realByYear,{
  worlds=400,seed=20261102,resamples=2000
}={}){
  if(!Number.isInteger(worlds)||worlds<1||worlds>4000)throw Error('Invalid no-edge simulation count');
  let state=seed>>>0;
  const rand=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  let passing=0,positiveYears3=0;
  const examples=[];
  for(let i=0;i<worlds;i++){
    const simulated=new Map();
    for(const [season,rows] of realByYear){
      simulated.set(season,rows.map(row=>({
        ...row,actual:rand()<row.market?1:0
      })));
    }
    const out=evaluateNestedResidualGate(simulated,{sampleCI:resamples,seed:seed+i*37});
    if(out.evidenceFlagPassed)passing++;
    if(out.pooled.positiveSeasonCount>=3)positiveYears3++;
    if(i<4)examples.push({
      nullWorld:i,gatePassed:out.evidenceFlagPassed,
      pooledBrierGain:out.pooled.improvementBrier,
      pooledLogLossGain:out.pooled.improvementLogLoss
    });
  }
  return {
    assumption:'TRUE_P_HOME_EQUALS_RETROSPECTIVE_DE_VIGGED_CLOSING_MARKET',
    generatedOutcomesAreSynthetic:true,
    iterations:worlds,seed,
    falseApprovalCount:passing,
    estimatedFalseApprovalRatePercent:round(100*passing/worlds,3),
    positiveSeasonCount3OrMore:positiveYears3,
    sampleWorlds:examples,
    interpretation:'Source-conditional rate under a synthetic efficient market, not a universal actual error probability.'
  };
}

/** Complete research report: no production model promotion is authorized. */
export function evaluateResidualResearch(replays,{
  nullIterations=400,nullSeed=20261102,uncertaintyResamples=2000
}={}){
  if(!Array.isArray(replays))throw Error('Missing historical source replays');
  const byYear=new Map();
  for(const r of replays){
    if(byYear.has(r.season))throw Error('Duplicate historical evaluation season');
    byYear.set(r.season,rowsFromReplay(r));
  }
  for(let year=2020;year<=2025;year++){
    if((byYear.get(year)?.length??0)<200)throw Error('Missing historical source season '+year);
  }
  const actual=evaluateNestedResidualGate(byYear,{sampleCI:uncertaintyResamples,seed:nullSeed});
  const nullResult=nullWorlds(byYear,{
    worlds:nullIterations,seed:nullSeed,resamples:uncertaintyResamples
  });
  const pooledBins=Array.from({length:10},(_,i)=>({
    decile:i+1,n:0,model:0,market:0,actual:0
  }));
  for(const year of actual.perSeason){
    for(const b of year.disagreementAudit.bins){
      if(!b.n)continue;
      const bin=pooledBins[b.decile-1];
      bin.n+=b.n;
      bin.model+=b.modelFavoredSideForecastPercent*b.n/100;
      bin.market+=b.marketFavoredSideReferencePercent*b.n/100;
      bin.actual+=b.actualModelSideWinPercent*b.n/100;
    }
  }
  const pooledDisagreement=pooledBins.map(b=>({
    decile:b.decile,n:b.n,
    modelFavoredSideForecastPercent:b.n?round(100*b.model/b.n,2):null,
    marketReferencePercent:b.n?round(100*b.market/b.n,2):null,
    observedWinPercent:b.n?round(100*b.actual/b.n,2):null,
    modelOverconfidencePoints:b.n?round(100*(b.model-b.actual)/b.n,2):null,
    marketOverconfidencePoints:b.n?round(100*(b.market-b.actual)/b.n,2):null
  }));
  return {
    schema:1,version:RESIDUAL_RESEARCH_VERSION,
    preregisteredProtocol:PRE_REGISTERED.protocol,
    testYears:SELECTED_YEARS,
    type:'RETROSPECTIVE_CLOSING_REFERENCE_RESEARCH',
    experimentalModel:'RIDGE_LOGISTIC_MARKET_OFFSET_RESIDUAL',
    dataScope:'HISTORICAL_CLOSING_NO_KNOWN_ENTRY_TIME',
    modelPromoted:false,realBettingAuthorized:false,
    verifiedCLV:null,verifiedROI:null,verifiedIncrementalProfitability:false,
    dataUsedForPriorModelDevelopment:true,
    historicalIncrementalInformationFlag:actual.evidenceFlagPassed,
    ...actual,
    pooledDisagreement,
    zeroEdgeSyntheticNull:nullResult,
    caveats:[
      'Closing market data are a research reference, not authenticated historical decision-time prices.',
      '2025 and earlier test seasons have been inspected previously; this is not genuinely new forward evidence.',
      'Market-derived residual models are not independent sportsbook forecasting models.',
      'Fewer than 40 games per seasonal disagreement bin should not be interpreted as stable statistical evidence.',
      'The null false-approval estimate is specific to Bernoulli(closing-market) synthetic worlds, not every real-world failure mode.',
      'No automatic bet, CLV, live return or model promotion follows from retrospective statistical scores.'
    ]
  };
}
