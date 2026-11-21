/** Offline, development-only comparison. Never imported by the production server. */
import {fitPriorLogistic,fittedProbability} from './residual-research.mjs';
export const MODEL_NAMES=Object.freeze(['market','elo','fixedQuarterResidual','constrainedOffset','marketCalibration','calibratedResidual']);
const logit=p=>Math.log(p/(1-p));
const sigmoid=z=>1/(1+Math.exp(-z));
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const quantile=(a,p)=>{const s=[...a].sort((x,y)=>x-y),v=(s.length-1)*p,i=Math.floor(v);return s[i]+(s[Math.ceil(v)]-s[i])*(v-i);};
export const logLoss=(p,y)=>-(y*Math.log(p)+(1-y)*Math.log1p(-p));
export function validateRows(rows){
 if(!Array.isArray(rows)||!rows.length)throw Error('ABLATION_ROWS_REQUIRED');
 const ids=new Set();
 for(const r of rows){
  if(!r||typeof r.gameId!=='string'||!r.gameId||ids.has(r.gameId)||
    !Number.isInteger(r.year)||r.year<2000||r.year>2025||!Number.isInteger(r.week)||r.week<1||r.week>25||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date||
    Number(r.date.slice(0,4))<r.year||Number(r.date.slice(0,4))>r.year+1||
    ![r.market,r.elo].every(p=>Number.isFinite(p)&&p>0&&p<1)||![0,1].includes(r.actual))throw Error('ABLATION_ROW_INVALID');
  ids.add(r.gameId);
 }
 return rows;
}
/** One convex parameter, fixed ridge20 and interval[0,1]. Zero means unchanged market. */
export function fitConstrainedOffset(rows){
 validateRows(rows);if(rows.length<350)throw Error('ABLATION_PRIOR_SAMPLE_TOO_SMALL');
 const grad=b=>rows.reduce((s,r)=>{const x=logit(r.elo)-logit(r.market);return s+x*(sigmoid(logit(r.market)+b*x)-r.actual);},20*b);
 if(grad(0)>=0)return 0;
 if(grad(1)<=0)return 1;
 let lo=0,hi=1;for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(grad(mid)>0)hi=mid;else lo=mid;}
 return (lo+hi)/2;
}
export function fitBeforeTarget(rows,year){
 validateRows(rows);if(!Number.isInteger(year)||year<2022||year>2025)throw Error('ABLATION_YEAR_INVALID');
 const prior=rows.filter(r=>r.year===year-2||r.year===year-1);
 for(const y of [year-2,year-1])if(prior.filter(r=>r.year===y).length<200)throw Error('ABLATION_PRIOR_SEASON_MISSING');
 const target=rows.filter(r=>r.year===year);
 if(!target.length||prior.some(r=>r.date>=target.reduce((d,t)=>t.date<d?t.date:d,'9999')))throw Error('ABLATION_CHRONOLOGY_INVALID');
 return {targetYear:year,trainedSeasons:[year-2,year-1],trainingN:prior.length,
  trainingLastDate:prior.map(r=>r.date).sort().at(-1),beta:fitConstrainedOffset(prior),
  marketCalibration:fitPriorLogistic(prior,{residual:false}),calibratedResidual:fitPriorLogistic(prior,{residual:true})};
}
export function predictModels(row,fit){
 const blend=b=>b===0?row.market:b===1?row.elo:sigmoid(logit(row.market)+b*(logit(row.elo)-logit(row.market)));
 if(row.year!==fit.targetYear||row.date<=fit.trainingLastDate)throw Error('ABLATION_PREDICTION_CHRONOLOGY_INVALID');
 return {market:row.market,elo:row.elo,fixedQuarterResidual:blend(.25),constrainedOffset:blend(fit.beta),
  marketCalibration:fittedProbability(row,fit.marketCalibration),calibratedResidual:fittedProbability(row,fit.calibratedResidual)};
}
export function scorePredictions(rows,name){
 if(!rows.length)throw Error('ABLATION_SCORE_EMPTY');
 const p=rows.map(r=>r.predictions[name]);if(!p.every(x=>Number.isFinite(x)&&x>0&&x<1))throw Error('ABLATION_PREDICTIONS_INVALID');
 const n=rows.length,directionalN=p.filter(x=>x!==.5).length,correct=rows.reduce((s,r,i)=>s+Number(p[i]!==.5&&(p[i]>.5)===(r.actual===1)),0);
 return {n,logLoss:mean(rows.map((r,i)=>logLoss(p[i],r.actual))),brier:mean(rows.map((r,i)=>(p[i]-r.actual)**2)),directionalN,correct,abstentions:n-directionalN};
}
/** Common draws, stratified by season. Intervals describe this frozen finite family only. */
export function pairedIntervals(rows,{resamples=10000,seed=20261120}={}){
 if(!Number.isInteger(resamples)||resamples<100||resamples>100000||!Number.isInteger(seed))throw Error('ABLATION_BOOTSTRAP_INVALID');
 const names=MODEL_NAMES.slice(1),seasonMap=new Map();
 for(const r of rows){
  if(!seasonMap.has(r.year))seasonMap.set(r.year,new Map());const weeks=seasonMap.get(r.year);
  if(!weeks.has(r.week))weeks.set(r.week,{n:0,gains:names.map(()=>0)});const w=weeks.get(r.week);w.n++;
  const base=logLoss(r.predictions.market,r.actual);
  names.forEach((name,j)=>w.gains[j]+=base-logLoss(r.predictions[name],r.actual));
 }
 const seasons=[...seasonMap.values()].map(m=>[...m.values()]);
 if(seasons.some(s=>s.length<10))throw Error('ABLATION_TOO_FEW_WEEK_BLOCKS');
 const observed=names.map(name=>mean(rows.map(r=>logLoss(r.predictions.market,r.actual)-logLoss(r.predictions[name],r.actual))));
 let state=seed>>>0;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
 const draws=names.map(()=>[]),maxima=[];
 for(let b=0;b<resamples;b++){
  let n=0;const sums=names.map(()=>0);
  for(const weeks of seasons)for(let k=0;k<weeks.length;k++){const w=weeks[Math.floor(random()*weeks.length)];n+=w.n;w.gains.forEach((x,j)=>sums[j]+=x);}
  const d=sums.map((s,j)=>{const x=s/n;draws[j].push(x);return Math.abs(x-observed[j]);});maxima.push(Math.max(...d));
 }
 const radius=quantile(maxima,.95);
 return {method:'SEASON_STRATIFIED_WEEK_BLOCK_CENTERED_MAX_ABSOLUTE_GAIN',resamples,seed,
  family:names,primary:'logLoss',blocks:seasons.reduce((s,a)=>s+a.length,0),simultaneousRadius:radius,
  comparisons:Object.fromEntries(names.map((name,j)=>[name,{gain:observed[j],nominal95:[quantile(draws[j],.025),quantile(draws[j],.975)],simultaneous95:[observed[j]-radius,observed[j]+radius]}]))};
}
export function runMarketPriorAblation(rows,{resamples=10000,seed=20261120}={}){
 validateRows(rows);const predictions=[],fits=[];
 for(const year of [2022,2023,2024,2025]){
  if(rows.filter(r=>r.year===year).length<200)throw Error('ABLATION_TARGET_SAMPLE_TOO_SMALL');
  const fit=fitBeforeTarget(rows,year);fits.push(fit);
  for(const r of rows.filter(r=>r.year===year).sort((a,b)=>a.date.localeCompare(b.date)||a.gameId.localeCompare(b.gameId)))predictions.push({...r,predictions:predictModels(r,fit)});
 }
 return {fits,predictions,summary:{use:'EXPLORATORY_REUSED_HISTORICAL_SEASONS',
  models:Object.fromEntries(MODEL_NAMES.map(name=>[name,{pooled:scorePredictions(predictions,name),
   bySeason:Object.fromEntries([2022,2023,2024,2025].map(y=>[y,scorePredictions(predictions.filter(r=>r.year===y),name)]))}])),
  uncertainty:pairedIntervals(predictions,{resamples,seed}),automaticPromotionAllowed:false,wageringAllowed:false,
  decisionTimeComparisonReady:false,verifiedROI:false,verifiedCLV:false}};
}
