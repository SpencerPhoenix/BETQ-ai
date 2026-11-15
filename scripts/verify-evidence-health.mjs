#!/usr/bin/env node
/**
 * Read ONLY /api/health from stdin; zero live odds credits.
 * Use a contract-based guard to avoid rejecting every new software release.
 */
import {compatibleEvidenceHealth} from '../src/evidence-compat.mjs';
let source='';
try{
  for await(const part of process.stdin){
    source+=part.toString('utf8');
    if(source.length>32000)throw Error('HEALTH_BODY_TOO_LARGE');
  }
  const health=JSON.parse(source);
  const value=compatibleEvidenceHealth(health);
  if(!value.compatible){
    console.error('BETQ prospective collector stopped before paid odds: '+value.reason);
    process.exitCode=1;
  }else if(health.captureReadiness?.ready!==true){
    console.error('BETQ paid capture prerequisites unavailable: '+String(health.captureReadiness?.reason||'OPERATOR_BUDGET_CONTRACT_MISSING'));
    process.exitCode=1;
  }else{
    if(health.collectionHealth?.liveFreshnessVerified!==true)console.warn('Collector health is unverified; provider readiness does not prove fresh collection.');
    console.log('BETQ evidence collector source contract verified ('+value.version+
      '), no paid credits used by compatibility check.');
  }
}catch{
  console.error('BETQ health metadata invalid; no live odds request permitted.');
  process.exitCode=1;
}
