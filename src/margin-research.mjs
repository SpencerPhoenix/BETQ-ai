/**
 * NFL score-margin residual to retrospective closing spread.
 * Frozen protocol: docs/RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md
 *
 * The source spread direction is POSITIVE for expected home margin; validate
 * using pre-2022 observations, never choose sign from target-season outcomes.
 * All prices are historical closing references, not time-stamped offers.
 */
const round=(n,d=5)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const finite=Number.isFinite;
const capProb=p=>Math.max(1e-6,Math.min(1-1e-6,p));
const logit=p=>Math.log(capProb(p)/(1-capProb(p)));
const quantile=(a,p)=>{
  const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return lo===hi?a[lo]:a[lo]*(hi-i)+a[hi]*(i-lo);
};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

export function buildMarginRows(sourceRows,replayYears){
  if(!Array.isArray(sourceRows)||!Array.isArray(replayYears))throw Error('Invalid margin sources');
  const games=new Map();
  for(const r of sourceRows){
    if(typeof r?.game_id!=='string'||!r.game_id)continue;
    const spreadStr=String(r.spread_line??'').trim();
    const hsStr=String(r.home_score??'').trim(),asStr=String(r.away_score??'').trim();
    if(!spreadStr||!hsStr||!asStr)continue;
    const spread=Number(spreadStr),hs=Number(hsStr),as=Number(asStr);
    if(![spread,hs,as].every(finite)||Math.abs(spread)>40||
       !Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0||hs>100||as>100)
      continue;
    games.set(r.game_id,{spread,margin:hs-as});
  }
  const byYear=new Map();
  for(const rep of replayYears){
    const rows=[],seen=new Set();
    for(const d of rep.decisions||[]){
      const source=games.get(d.gameId);
      if(!source||seen.has(d.gameId)||!finite(d.modelHomeProbability)||
         !finite(d.closeMarketHomeProbability)||
         !(d.modelHomeProbability>0&&d.modelHomeProbability<1)||
         !(d.closeMarketHomeProbability>0&&d.closeMarketHomeProbability<1)||
         !Number.isInteger(d.week)||d.week<1||d.week>25)continue;
      seen.add(d.gameId);
      rows.push({
        gameId:d.gameId,year:rep.season,week:d.week,date:d.date,
        homeMargin:source.margin,marketHomeMargin:source.spread,
        feature:logit(d.modelHomeProbability)-logit(d.closeMarketHomeProbability)
      });
    }
    byYear.set(rep.season,rows.sort((a,b)=>a.date.localeCompare(b.date)||
      a.gameId.localeCompare(b.gameId)));
  }
  return byYear;
}
export function assertSpreadDirection(rows){
  if(!Array.isArray(rows)||rows.length<350)throw Error('Insufficient pre-2022 source sign validation');
  const x=rows.map(r=>r.marketHomeMargin),y=rows.map(r=>r.homeMargin);
  const mx=mean(x),my=mean(y);
  let sxx=0,syy=0,sxy=0;
  for(let i=0;i<x.length;i++){
    sxx+=(x[i]-mx)**2;syy+=(y[i]-my)**2;sxy+=(x[i]-mx)*(y[i]-my);
  }
  const correlation=sxy/Math.sqrt(sxx*syy);
  if(!finite(correlation)||correlation<.2)
    throw Error('Closing spread sign or source integrity failed pre-test check');
  return {
    validatedOnYears:[2020,2021],
    convention:'POSITIVE_IS_EXPECTED_HOME_MARGIN',
    pretestGames:rows.length,
    empiricalPretestCorrelation:round(correlation,5),
    sourceMetadata:'nflverse spread_line from PFR schedules; no actual entry timestamp',
    note:'Sign checked only in pre-2022 years; not selected using target-season scores.'
  };
}
export function fitMarginCorrection(rows){
  if(!Array.isArray(rows)||rows.length<350)throw Error('Insufficient margin training rows');
  let sx=0,sy=0,sxx=0,sxy=0;
  for(const r of rows){
    const x=r.feature,y=r.homeMargin-r.marketHomeMargin;
    if(!finite(x)||!finite(y)||Math.abs(x)>20||Math.abs(y)>150)
      throw Error('Invalid prior-season margin feature');
    sx+=x;sy+=y;sxx+=x*x;sxy+=x*y;
  }
  const A=rows.length+2,D=sxx+20;
  const det=A*D-sx*sx;
  if(!finite(det)||det<=0)throw Error('Margin ridge matrix invalid');
  const intercept=(sy*D-sx*sxy)/det,beta=(A*sxy-sx*sy)/det;
  return {
    intercept:round(intercept,8),residualWeight:round(beta,8),
    fitRows:rows.length,ridgeIntercept:2,ridgeSlope:20,
    formula:'spread + intercept + residualWeight*(logit(Elo)-logit(no-vig market))'
  };
}
export function scoreMargins(rows,fit=null){
  if(!rows.length)return {n:0,mse:null,mae:null,rmse:null};
  let mse=0,mae=0;
  for(const r of rows){
    const prediction=r.marketHomeMargin+(fit?fit.intercept+fit.residualWeight*r.feature:0);
    const error=r.homeMargin-prediction;
    mse+=error*error;mae+=Math.abs(error);
  }
  return {n:rows.length,mse:round(mse/rows.length,5),
    rmse:round(Math.sqrt(mse/rows.length),4),mae:round(mae/rows.length,4)};
}
function groupedMarginCI(rows,fit,{seed=20261102,repeats=2000}={}){
  const blocks=new Map();
  for(const row of rows){
    const id=row.year+':'+row.week;
    if(!blocks.has(id))blocks.set(id,{total:0,n:0});
    const baseline=(row.homeMargin-row.marketHomeMargin)**2;
    const corrected=(row.homeMargin-row.marketHomeMargin-
      fit.intercept-fit.residualWeight*row.feature)**2;
    const b=blocks.get(id);b.total+=baseline-corrected;b.n++;
  }
  const grouped=[...blocks.values()];
  if(grouped.length<12||rows.length<100)return null;
  let state=seed>>>0;
  const uniform=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const boot=[];
  for(let rep=0;rep<repeats;rep++){
    let numerator=0,denom=0;
    for(let j=0;j<grouped.length;j++){
      const block=grouped[Math.floor(uniform()*grouped.length)];
      numerator+=block.total;denom+=block.n;
    }
    boot.push(numerator/denom);
  }
  boot.sort((a,b)=>a-b);
  return {
    method:'PAIRED_SEASON_WEEK_BOOTSTRAP',
    weeks:grouped.length,repeats,
    meanImprovement:round(mean(rows.map(r=>{
      const a=(r.homeMargin-r.marketHomeMargin)**2;
      const b=(r.homeMargin-r.marketHomeMargin-fit.intercept-fit.residualWeight*r.feature)**2;
      return a-b;
    })),5),
    lower95:round(quantile(boot,.025),5),
    upper95:round(quantile(boot,.975),5)
  };
}
export function evaluateMarginResearch(byYear){
  if(!(byYear instanceof Map))throw Error('Margin source must be year-indexed');
  const source=assertSpreadDirection([...(byYear.get(2020)||[]),...(byYear.get(2021)||[])]);
  const years=[],paired=[];
  for(const year of [2022,2023,2024,2025]){
    const training=[...(byYear.get(year-2)||[]),...(byYear.get(year-1)||[])];
    const test=byYear.get(year)||[];
    if(training.length<350||test.length<200)throw Error('Insufficient margin rows '+year);
    const fit=fitMarginCorrection(training);
    const base=scoreMargins(test),challenger=scoreMargins(test,fit);
    years.push({
      season:year,trainedYears:[year-2,year-1],n:test.length,
      coefficients:fit,closingSpreadBaseline:base,eloMarginResidual:challenger,
      improvementMse:round(base.mse-challenger.mse,5),
      paired95:groupedMarginCI(test,fit,{seed:20261102+year,repeats:2000})
    });
    paired.push(...test.map(r=>({...r,fit})));
  }
  const baselines=scoreMargins(paired);
  let totalError=0,totalAbsolute=0;
  for(const row of paired){
    const pred=row.marketHomeMargin+row.fit.intercept+row.fit.residualWeight*row.feature;
    const err=row.homeMargin-pred;
    totalError+=err*err;totalAbsolute+=Math.abs(err);
  }
  const candidate={
    n:paired.length,mse:round(totalError/paired.length,5),
    rmse:round(Math.sqrt(totalError/paired.length),4),
    mae:round(totalAbsolute/paired.length,4)
  };
  const groups=new Map();
  for(const row of paired){
    const id=row.year+':'+row.week;
    if(!groups.has(id))groups.set(id,{total:0,n:0});
    const base=(row.homeMargin-row.marketHomeMargin)**2;
    const modified=(row.homeMargin-row.marketHomeMargin-
      row.fit.intercept-row.fit.residualWeight*row.feature)**2;
    groups.get(id).total+=base-modified;groups.get(id).n++;
  }
  const pooledCI=(()=>{
    const list=[...groups.values()];
    let state=20261102;
    const rnd=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
    const sampled=[];
    for(let n=0;n<2000;n++){
      let numerator=0,denom=0;
      for(let i=0;i<list.length;i++){
        const selected=list[Math.floor(rnd()*list.length)];
        numerator+=selected.total;denom+=selected.n;
      }
      sampled.push(numerator/denom);
    }
    sampled.sort((a,b)=>a-b);
    return {
      method:'PAIRED_SEASON_WEEK_BOOTSTRAP',weeks:list.length,repeats:2000,
      lower95:round(quantile(sampled,.025),5),
      upper95:round(quantile(sampled,.975),5)
    };
  })();
  const positiveYears=years.filter(y=>y.improvementMse>0).length;
  const exploratoryEvidenceFlag=baselines.mse>candidate.mse&&
    (pooledCI.lower95??-1)>0&&positiveYears>=3;
  return {
    schema:1,version:'betq-margin-research-v1',
    sourceSignValidation:source,
    type:'RETROSPECTIVE_CLOSING_SPREAD_MARGIN_RESEARCH',
    model:'Ridge-corrected closing point spread by frozen Elo-minus-market logit residual',
    dataProvenance:'HISTORICAL_CLOSING_NOT_KNOWN_EXECUTABLE_ENTRY',
    testYears:[2022,2023,2024,2025],
    finalScoreUsedOnlyAsEvaluationLabel:true,
    correctedForecastUsesFutureOutcomes:false,
    automaticPromotion:false,
    verifiedROI:null,verifiedCLV:null,bettingAuthorized:false,
    years,
    pooled:{
      closingSpreadBaseline:baselines,eloMarginResidual:candidate,
      improvementMse:round(baselines.mse-candidate.mse,5),
      positiveSeasonCount:positiveYears,paired95:pooledCI
    },
    exploratoryEvidenceFlag,
    limitations:[
      'Final game margin is used as the evaluation outcome, never a feature at forecast time.',
      'Closing spread and closing moneylines are retrospective source references; no historical wager or opening-to-close move was validated.',
      'This test uses the old Elo residual only, not a fully refitted player or scoring-distribution model.',
      'Feature and model concept were chosen after earlier historical NFL results were examined; no fresh out-of-sample claim.',
      'Week-group bootstrap does not capture all repeated team dependence.'
    ]
  };
}
