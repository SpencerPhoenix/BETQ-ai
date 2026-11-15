import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deVigPair,deVigAmericanPair,americanToDecimal} from '../research/no-vig/benchmark.mjs';
import {binaryCalibrationDiagnostics as diagnostics} from '../research/no-vig/calibration-fixtures.mjs';
import {noVigPair} from '../src/engine.mjs';
const cases=JSON.parse(readFileSync(new URL('./fixtures/no-vig/numerical-cases.json',import.meta.url))).cases;
const close=(a,b,tolerance=1e-13)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} differs from ${b}`);
for(const c of cases)test('Independent rational fixture: '+c.name,()=>{
 const p=deVigAmericanPair(c.american);p.probabilities.forEach((v,i)=>close(v,c.proportional[i]));close(p.overround,c.overround);
 assert.equal(p.basis,'MARKET_DERIVED_NOT_INDEPENDENT');assert.equal(p.verifiedEdge,false);
 if(c.shinError)assert.throws(()=>deVigAmericanPair(c.american,{method:'SHIN_TWO_OUTCOME'}),{code:c.shinError});
 else deVigAmericanPair(c.american,{method:'SHIN_TWO_OUTCOME'}).probabilities.forEach((v,i)=>close(v,c.shin[i]));
});
test('Proportional matches unchanged engine over 529 fixed American pairs',()=>{
 const prices=[-10000,-5000,-2000,-1000,-500,-300,-200,-150,-120,-110,-100,100,110,120,150,200,300,500,1000,2000,5000,10000,100000];let n=0;
 for(const a of prices)for(const b of prices){const r=deVigAmericanPair([a,b]),old=noVigPair(a,b);r.probabilities.forEach((v,i)=>close(v,old[i]));n++;}
 assert.equal(n,529);
});
test('Outcome reversal preserves margin and z and swaps probabilities',()=>{
 for(const c of cases)for(const method of ['PROPORTIONAL','SHIN_TWO_OUTCOME']){
  if(method==='SHIN_TWO_OUTCOME'&&c.shinError)continue;
  const a=deVigAmericanPair(c.american,{method}),b=deVigAmericanPair([...c.american].reverse(),{method});
  close(a.probabilities[0],b.probabilities[1]);close(a.probabilities[1],b.probabilities[0]);close(a.overround,b.overround);
  if(method==='SHIN_TWO_OUTCOME')close(a.parameters.z,b.parameters.z);
 }
});
test('Shin probabilities satisfy independent quadratic identities and additive equivalence',()=>{
 let n=0;for(let a=1.05;a<=5;a+=.11)for(let b=1.05;b<=5;b+=.13){
  const q=[1/a,1/b],S=q[0]+q[1];if(S<1)continue;
  const r=deVigPair([a,b],{method:'SHIN_TWO_OUTCOME'}),z=r.parameters.z;
  for(let i=0;i<2;i++){const p=r.probabilities[i];close(q[i]**2/S,(1-z)*p*p+z*p);close(p,q[i]-(S-1)/2);assert.ok(p>0&&p<1);}
  close(r.probabilities[0]+r.probabilities[1],1);assert.ok(z>=0&&z<1);n++;
 }
 assert.ok(n>100);
});
test('Inputs are detached, precision retained, unknown methods and underround never silently fall back',()=>{
 const input=[1.37,3.6],copy=[...input],r=deVigPair(input);assert.deepEqual(input,copy);r.decimalOdds[0]=99;assert.deepEqual(input,copy);
 assert.ok(String(r.probabilities[0]).length>8);
 assert.throws(()=>deVigPair([3,3],{method:'SHIN_TWO_OUTCOME'}),{code:'SHIN_UNDERROUND_UNSUPPORTED'});
 assert.throws(()=>deVigPair([2,2],{method:'POWER'}),{code:'UNSUPPORTED_NO_VIG_METHOD'});
});
test('Malformed, nonfinite, sparse and nonbinary odds are rejected without coercion',()=>{
 for(const v of [null,{},[],[2],[2,2,2],[1,2],[0,2],[-2,2],['2',2],[NaN,2],[Infinity,2],[true,2],Array(2)])assert.throws(()=>deVigPair(v));
 for(const v of [0,99,-99,'-110',null,NaN,Infinity,true])assert.throws(()=>americanToDecimal(v));
});
test('Near-fair binary64 residue is distinguished from material underround',()=>{
 for(const pair of [[107,-107],[143,-143]]){const r=deVigAmericanPair(pair,{method:'SHIN_TWO_OUTCOME'});assert.equal(r.marginState,'ZERO_WITHIN_FLOATING_TOLERANCE');assert.ok(r.parameters.z>=0);close(r.probabilities[0]+r.probabilities[1],1);}
 assert.throws(()=>deVigPair([2.000001,2.000001],{method:'SHIN_TWO_OUTCOME'}),{code:'SHIN_UNDERROUND_UNSUPPORTED'});
});
test('American precision collapse accepted by legacy is explicitly rejected by strict research domain',()=>{
 assert.ok(noVigPair(-Number.MAX_VALUE,100));
 assert.throws(()=>deVigAmericanPair([-Number.MAX_VALUE,100]),{code:'UNREPRESENTABLE_DECIMAL_ODDS'});
});
test('Known scores and correct endpoint predictions are scored exactly without NaN',()=>{
 const r=diagnostics([{id:'a',probability:.25,outcome:0},{id:'b',probability:.75,outcome:1}]);
 close(r.brier,.0625);close(r.logLoss,-Math.log(.75));close(r.ece,.25);assert.equal(r.n,2);assert.equal(r.reliability[2].n,1);assert.equal(r.reliability[0].eventRate95,null);
 const endpoint=diagnostics([{id:'a',probability:0,outcome:0},{id:'b',probability:1,outcome:1}]);close(endpoint.brier,0);close(endpoint.logLoss,0);assert.equal(endpoint.reliability[9].n,1);
});
test('Wrong exact endpoints retain explicit infinite log loss in JSON, never clipped away',()=>{
 const r=diagnostics([{id:'a',probability:0,outcome:1},{id:'b',probability:1,outcome:0}]);
 assert.equal(r.logLoss,null);assert.equal(r.logLossStatus,'POSITIVE_INFINITY');assert.equal(r.zeroProbabilityMistakes,2);assert.equal(r.brier,1);
 assert.equal(JSON.parse(JSON.stringify(r)).logLossStatus,'POSITIVE_INFINITY');
});
test('Synthetic empirical calibration never establishes model validation or promotion',()=>{
 const rows=Array.from({length:20},(_,i)=>({id:String(i),probability:i<10?.2:.8,outcome:i<10?Number(i<2):Number(i<18)})),r=diagnostics(rows);
 close(r.ece,0,1e-14);close(r.brier,.16);close(r.logLoss,-(.8*Math.log(.8)+.2*Math.log(.2)));
 assert.equal(r.status,'DESCRIPTIVE_ONLY_NOT_VALIDATION');assert.equal(r.calibrationEstablished,false);assert.equal(r.promotionAllowed,false);assert.equal(r.fittedCalibration,false);
 for(const b of r.reliability.filter(b=>b.n)){assert.ok(b.eventRate95.lower<b.observedRate);assert.ok(b.eventRate95.upper>b.observedRate);assert.equal(b.eventRate95.method,'WILSON_IID_BINOMIAL');}
});
test('Brier and log loss have minimum expected score at the honest Bernoulli probability',()=>{
 const score=p=>diagnostics(Array.from({length:10},(_,i)=>({id:String(i),probability:p,outcome:Number(i<3)})));
 const truth=score(.3);for(const p of [.01,.1,.2,.4,.6,.9,.99]){const r=score(p);assert.ok(r.brier>truth.brier);assert.ok(r.logLoss>truth.logLoss);}
});
test('Small-sample Wilson uncertainty and empty status are explicit',()=>{
 const empty=diagnostics([]);assert.equal(empty.status,'INSUFFICIENT_DATA');assert.equal(empty.brier,null);assert.equal(empty.logLossStatus,'NO_OBSERVATIONS');
 assert.ok(empty.reliability.every(b=>b.n===0&&b.meanProbability===null&&b.observedRate===null&&b.eventRate95===null));
 const r=diagnostics([{id:'a',probability:.8,outcome:1}]),ci=r.reliability[8].eventRate95;
 close(ci.lower,.20654931437723745);close(ci.upper,1);assert.equal(r.status,'DESCRIPTIVE_ONLY_NOT_VALIDATION');
});
test('ECE weights unequal bins by sample count rather than averaging bin errors',()=>{
 const r=diagnostics([{id:'a',probability:.2,outcome:0},...Array.from({length:3},(_,i)=>({id:String(i),probability:.9,outcome:1}))]);
 close(r.ece,.125);close(r.brier,.0175);assert.ok(Math.abs(r.ece-.15)>.01);
});
test('Same selected outcomes and accuracy can conceal worse probability calibration',()=>{
 const outcomes=Array.from({length:10},(_,i)=>({id:String(i),outcome:Number(i<8)}));
 const honest=diagnostics(outcomes.map(r=>({...r,probability:.8}))),overconfident=diagnostics(outcomes.map(r=>({...r,probability:.99})));
 assert.ok(overconfident.brier>honest.brier);assert.ok(overconfident.logLoss>honest.logLoss);close(honest.ece,0);close(overconfident.ece,.19);
});
test('All predecessor, exact and successor boundary values obey half-open bins including p=1',()=>{
 const adjacent=(x,delta)=>{const f=new Float64Array([x]),u=new BigUint64Array(f.buffer);u[0]+=delta;return f[0];};
 for(let i=1;i<10;i++)for(const [p,index] of [[adjacent(i/10,-1n),i-1],[i/10,i],[adjacent(i/10,1n),i]]){
  const r=diagnostics([{id:String(i),probability:p,outcome:0}]);assert.equal(r.reliability[index].n,1);
 }
 assert.equal(diagnostics([{id:'last',probability:1,outcome:1}]).reliability[9].n,1);
});
test('Ordering and outcome-complement invariance for proper scoring',()=>{
 const rows=Array.from({length:11},(_,i)=>({id:String(i),probability:i/10,outcome:Number(i>=5)})),r=diagnostics(rows);
 assert.deepEqual(diagnostics([...rows].reverse()).reliability,r.reliability);
 const c=diagnostics(rows.map(x=>({...x,probability:1-x.probability,outcome:1-x.outcome})));close(r.brier,c.brier);close(r.logLoss,c.logLoss);
});
test('Duplicate IDs, nonbinary settlements and invalid or oversized diagnostic input fail closed',()=>{
 const r={id:'x',probability:.5,outcome:1};for(const rows of [[r,r],[{...r,probability:NaN}],[{...r,probability:'0.5'}],[{...r,probability:1.1}],[{...r,outcome:'TIE'}],[{...r,outcome:.5}],[{...r,outcome:true}],null,Array(20001),Array(2)])assert.throws(()=>diagnostics(rows));
});
