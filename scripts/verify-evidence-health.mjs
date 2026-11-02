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
  const value=compatibleEvidenceHealth(JSON.parse(source));
  if(!value.compatible){
    console.error('BETQ prospective collector stopped before paid odds: '+value.reason);
    process.exitCode=1;
  }else{
    console.log('BETQ evidence collector source contract verified ('+value.version+
      '), no paid credits used by compatibility check.');
  }
}catch{
  console.error('BETQ health metadata invalid; no live odds request permitted.');
  process.exitCode=1;
}
