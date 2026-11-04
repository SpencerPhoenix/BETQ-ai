#!/usr/bin/env node
/**
 * Read-only production release check. No /api/slate, paid provider or writes.
 * Warn (not fail) when a healthy older Render release is still running.
 * Fail distinctly for unavailable, malformed, or HTTP-error service.
 */
import {readFileSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {probeDeploymentHealth,RELEASE_STATES} from '../src/deployment-health.mjs';

const version=JSON.parse(readFileSync('package.json','utf8')).version;
// A data-only publication must not redefine the expected deployed code revision.
const commit=execFileSync('git',[
  'log','-1','--format=%H','--','src','public','package.json','render.yaml'
],{encoding:'utf8',timeout:10000}).trim();
if(!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{40}$/i.test(commit??'')){
  throw Error('Complete git history and package release metadata required for exact verification');
}
const explain=r=>[r.status,r.reason||'','expected='+version+'@'+commit,
  'observed='+String(r.actualVersion||'unknown')+'@'+String(r.actualCommit||'unavailable'),
  'http='+String(r.httpStatus??'unavailable')].join(' ');
let result;
for(let i=0;i<2;i++){
  result=await probeDeploymentHealth({expectedVersion:version,expectedCommit:commit});
  if(![RELEASE_STATES.TIMEOUT,RELEASE_STATES.UNREACHABLE].includes(result.status) &&
     !(result.status===RELEASE_STATES.HTTP_ERROR && result.httpStatus>=500))break;
  // One bounded retry for potentially transient infrastructure failure.
  if(i===0)await new Promise(resolve=>setTimeout(resolve,2000));
}
if(process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT,'status='+result.status+'\n');
const message=explain(result);
if(result.status===RELEASE_STATES.OK){
  console.log('Production release matched: '+message);
}else if([RELEASE_STATES.STALE,RELEASE_STATES.UNKNOWN].includes(result.status)){
  console.log('::warning::Healthy but unverified deployment source: '+message);
  console.log('::notice::Skipping release-specific v'+version+' feature checks; no downtime inferred.');
}else{
  console.error('::error::Production health audit failure: '+message);
  process.exitCode=1;
}
