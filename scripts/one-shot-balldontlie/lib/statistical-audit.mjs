/**
 * Dependence sensitivity for paired probability forecasts. Independent
 * implementation of week-block resampling, not copied from an external project.
 * References: arch bootstrap documentation; scikit-learn temporal validation.
 * Week blocks do not fully eliminate cross-week/team dependence. Report both
 * the interval and that remaining limitation; never equate it with betting ROI.
 */
import {validDay} from './integrity.mjs';
const round=n=>Number(n.toFixed(6));
export function weekBlock(date) {
  if(!validDay(date)) throw Error('Invalid observation date');
  const d=new Date(date+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
  return d.toISOString().slice(0,10);
}
export function pairedWeekBootstrap(rows,{repeats=2000,seed=381771}={}) {
  if(!Array.isArray(rows)||rows.length>20000||!Number.isInteger(repeats)||repeats<100||repeats>10000)
    throw Error('Invalid resampling input');
  const blocks=new Map(),ids=new Set();
  let total=0;
  for(const r of rows){
    if(!r||typeof r.id!=='string'||ids.has(r.id)||![0,1].includes(r.outcome)||
       ![r.baseline,r.challenger].every(p=>Number.isFinite(p)&&p>0&&p<1))
      throw Error('Malformed or duplicate paired prediction');
    ids.add(r.id);
    const week=weekBlock(r.date),diff=(r.baseline-r.outcome)**2-(r.challenger-r.outcome)**2;
    if(!blocks.has(week))blocks.set(week,{sum:0,n:0});
    const b=blocks.get(week);b.sum+=diff;b.n++;total+=diff;
  }
  const common={method:'PAIRED_WEEK_BLOCK_BOOTSTRAP',n:rows.length,weeks:blocks.size,
    repeats,meanImprovement:rows.length?round(total/rows.length):null,
    limitation:'Within-week resampling only; recurring teams and cross-week dependence remain.'};
  if(rows.length<30||blocks.size<8)return {...common,available:false,reason:'INSUFFICIENT_GAMES_OR_WEEKS',lower:null,upper:null};
  let state=seed>>>0;
  const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const list=[...blocks.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v),draws=[];
  for(let j=0;j<repeats;j++){
    let sum=0,n=0;
    for(let i=0;i<list.length;i++){const b=list[Math.floor(random()*list.length)];sum+=b.sum;n+=b.n;}
    draws.push(sum/n);
  }
  draws.sort((a,b)=>a-b);
  return {...common,available:true,lower:round(draws[Math.floor(repeats*.025)]),
    upper:round(draws[Math.ceil(repeats*.975)-1])};
}
