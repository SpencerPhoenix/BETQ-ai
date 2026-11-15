/** Offline synthetic math audit and retained-input availability check. Stdout only. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deVigAmericanPair,NO_VIG_VERSION} from '../research/no-vig/benchmark.mjs';
import {binaryCalibrationDiagnostics} from '../research/no-vig/calibration-fixtures.mjs';
import {noVigPair} from '../src/engine.mjs';
const fixtures=JSON.parse(readFileSync(new URL('../tests/fixtures/no-vig/numerical-cases.json',import.meta.url)));
const grid=[-10000,-5000,-2000,-1000,-500,-300,-200,-150,-120,-110,-100,100,110,120,150,200,300,500,1000,2000,5000,10000,100000];
let pairs=0,maxAbsoluteEngineDifference=0,shinSupported=0,shinUnderroundRejected=0,maxMethodDifference=0;
for(const a of grid)for(const b of grid){
  const r=deVigAmericanPair([a,b]),old=noVigPair(a,b);pairs++;
  maxAbsoluteEngineDifference=Math.max(maxAbsoluteEngineDifference,...r.probabilities.map((p,i)=>Math.abs(p-old[i])));
  try{const s=deVigAmericanPair([a,b],{method:'SHIN_TWO_OUTCOME'});shinSupported++;
    maxMethodDifference=Math.max(maxMethodDifference,Math.abs(s.probabilities[0]-r.probabilities[0]));
  }catch(error){if(error.code!=='SHIN_UNDERROUND_UNSUPPORTED')throw error;shinUnderroundRejected++;}
}
const fixtureResults=fixtures.cases.map(c=>{
  let shin;try{shin=deVigAmericanPair(c.american,{method:'SHIN_TWO_OUTCOME'});}catch(error){shin={available:false,reason:error.code};}
  return {name:c.name,proportional:deVigAmericanPair(c.american),shin};
});
const syntheticRows=Array.from({length:20},(_,i)=>({id:'SYNTHETIC-'+i,probability:i<10?.2:.8,outcome:i<10?Number(i<2):Number(i<18)}));
const raw=readFileSync(new URL('../data/evidence/nfl-2026.json',import.meta.url),'utf8'),journal=JSON.parse(raw);
const paired=journal.snapshots.filter(s=>Array.isArray(s.decimalOdds)&&s.decimalOdds.length===2).length;
process.stdout.write(JSON.stringify({version:NO_VIG_VERSION,scope:'OFFLINE_SYNTHETIC_NUMERICAL_BENCHMARK',
  reconstruction:'NEW_LOCAL_IMPLEMENTATION_NOT_RECOVERY_OF_PREVIOUS_COMMIT',
  productionIntegration:'NONE_IN_BENCHMARK_MODULES',providerCalls:0,thirdPartyCodeExecuted:false,predictiveImprovementEstablished:false,
  grid:{pairs,maxAbsoluteEngineDifference,shinSupported,shinUnderroundRejected,maxMethodDifference,
    warning:'Method differences reflect alternative margin assumptions, not demonstrated accuracy.'},
  fixtureResults,syntheticCalibration:binaryCalibrationDiagnostics(syntheticRows),
  retainedInputAudit:{path:'data/evidence/nfl-2026.json',sha256:createHash('sha256').update(raw).digest('hex'),
    snapshots:journal.snapshots.length,withRawPairedDecimalOdds:paired,evaluationStatus:'NOT_EVALUATED',
    blockers:['Normalized multi-book medians do not identify original paired prices or each bookmaker margin.',
      'No historical scores are computed from reconstructed odds.',
      'An approved receipt-bound paired-quote dataset, qualified outcomes and frozen later evaluation are required.']},
  limitations:['This verifies arithmetic and diagnostic fixtures, not a live strategy.',
    'Both methods are market-derived, not independent game forecasts.',
    'Two-outcome Shin is not generalized to three-way or push/void markets.',
    'Prospective qualification and dependence-aware uncertainty remain separate work.']},null,2)+'\n');
