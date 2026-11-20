import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {inspectModelOnlyHealth,modelOnlyRunStatus,MODEL_ONLY_HEALTH_TIMEOUT_MS} from '../src/model-only-health.mjs';
import {describeModelDelivery} from '../src/model-delivery.mjs';
const artifact=JSON.parse(await readFile(new URL('../data/nfl_elo.json',import.meta.url),'utf8'));
const now=Date.parse(artifact.generatedAt)+1000,health=()=>({modelOnlyCaptureSchema:2,serverTime:new Date(now).toISOString(),nflModel:{deliveryIdentity:describeModelDelivery(artifact,now)}});
const inspect=fetchImpl=>inspectModelOnlyHealth(artifact,{clock:()=>now,fetchImpl});
test('health preserves exact compatibility gate and bounded request',async()=>{
 const result=await inspect(async(url,options)=>{assert.match(url,/\/api\/health$/);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.signal);return Response.json(health());});
 assert.deepEqual(result,{compatible:true,reason:null,httpStatus:200});
});
for(const [name,response,reason] of [
 ['http',()=>new Response('secret',{status:503}),'HEALTH_HTTP_ERROR'],
 ['json',()=>new Response('{secret'),'HEALTH_INVALID_JSON'],
 ['oversize',()=>new Response('secret',{headers:{'content-length':'250001'}}),'HEALTH_BODY_TOO_LARGE'],
 ['schema',()=>Response.json({...health(),modelOnlyCaptureSchema:1}),'HEALTH_CAPTURE_SCHEMA_UNSUPPORTED'],
 ['null',()=>Response.json(null),'HEALTH_CAPTURE_SCHEMA_UNSUPPORTED'],
 ['time',()=>Response.json({...health(),serverTime:new Date(now+1).toISOString()}),'MODEL_HEALTH_TIME_INVALID_OR_STALE'],
 ['identity',()=>Response.json({...health(),nflModel:{deliveryIdentity:{...health().nflModel.deliveryIdentity,artifactCanonicalSha256:'secret'}}}),'RUNTIME_MODEL_ARTIFACT_MISMATCH'],
 ['timeout',()=>{throw new DOMException('secret','TimeoutError');},'HEALTH_TIMEOUT'],
 ['network',()=>{throw new Error('secret');},'HEALTH_FETCH_OR_BODY_ERROR']
])test(`health ${name} failure stays closed without leaking source text`,async()=>{const result=await inspect(async()=>response());assert.equal(result.compatible,false);assert.equal(result.reason,reason);assert.doesNotMatch(JSON.stringify(result),/secret/);});
const run=(patch={})=>({type:'RUN',payload:{runKey:'1.1',failedWeeks:[],productionCompatible:true,...patch}});
const report=events=>modelOnlyRunStatus({events},'1.1');
test('heartbeat differs from captures and ignores older events',()=>{assert.equal(report([{type:'CAPTURED'},run()]).status,'HEARTBEAT_NO_CAPTURE');assert.equal(report([run(),{type:'RESERVED',id:'r',gameId:'g'},{type:'CAPTURED',id:'c',gameId:'g',payload:{reservationId:'r'}},{type:'CUSTODY',gameId:'g',payload:{captureId:'c'}}]).status,'CAPTURED_WITH_CUSTODY');});
test('health, missing weeks, capture failure and unconfirmed custody degrade',()=>{for(const events of [[run({productionCompatible:false})],[run({failedWeeks:[9]})],[run(),{type:'CAPTURE_FAILED'}],[run(),{type:'CAPTURED'}],[run(),{type:'RESERVED'}],[]])assert.equal(report(events).status,'DEGRADED');});
test('workflow reports only after custody publication and always retains artifacts',async()=>{const text=await readFile(new URL('../.github/workflows/model-only-scheduled.yml',import.meta.url),'utf8');assert.ok(text.indexOf('publish-model-only-ledger.mjs final')<text.indexOf('report-model-only-run.mjs'));assert.match(text,/Preserve candidates[\s\S]*if: always\(\)/);});
test('reporter fails degraded after recording summary, healthy no-capture exits zero',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const {emptyModelLedger,ledgerEvent}=await import('../src/scheduled-model-ledger.mjs');
 const dir=await mkdtemp(join(tmpdir(),'model-health-'));
 try{for(const compatible of [false,true]){
  const ledger=emptyModelLedger(now);ledgerEvent(ledger,'RUN',null,run({productionCompatible:compatible}).payload,now);
  const path=join(dir,'ledger.json'),summary=join(dir,'summary.md');await writeFile(path,JSON.stringify(ledger));
  const result=spawnSync(process.execPath,[new URL('../scripts/report-model-only-run.mjs',import.meta.url).pathname,path],{env:{...process.env,GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1',GITHUB_STEP_SUMMARY:summary},encoding:'utf8'});
  assert.equal(result.status,compatible?0:1,result.stderr);assert.equal(JSON.parse(result.stdout).status,compatible?'HEARTBEAT_NO_CAPTURE':'DEGRADED');assert.match(await readFile(summary,'utf8'),/A heartbeat is not a forecast/);
 }}finally{await rm(dir,{recursive:true,force:true});}
});

test('historical custody repair cannot hide unconfirmed current capture',()=>{assert.ok(report([run(),{type:'CAPTURED',id:'new',gameId:'g'},{type:'CUSTODY',gameId:'old',payload:{captureId:'old'}}]).reasons.includes('CAPTURE_CUSTODY_UNCONFIRMED'));});

test('actual missed windows degrade but historical policy-start misses do not',()=>{
 for(const reason of ['WINDOW_ELAPSED','RESERVATION_UNRESOLVED'])assert.equal(report([run(),{type:'MISSED',payload:{reason}}]).status,'DEGRADED');
 assert.equal(report([run(),{type:'MISSED',payload:{reason:'POLICY_STARTED_AFTER_WINDOW'}}]).status,'HEARTBEAT_NO_CAPTURE');
});
test('run start includes reconciled finals even when health is incompatible',async()=>{
 const text=await readFile(new URL('../scripts/run-model-only-cycle.mjs',import.meta.url),'utf8');assert.ok(text.indexOf("phase:'STARTED'")<text.indexOf('inspectModelOnlyHealth(artifact'));
 const status=report([run({phase:'STARTED'}),{type:'FINAL'},run({productionCompatible:false})]);assert.equal(status.counts.FINAL,1);assert.equal(status.status,'DEGRADED');
});


test('cold startup uses exactly one fixed 75-second health deadline, within workflow budget',async t=>{
 const controller=new AbortController();let deadlines=[],calls=0;
 t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return controller.signal;});
 const result=await inspect(async(url,options)=>{calls++;assert.equal(options.signal,controller.signal);return Response.json(health());});
 assert.equal(result.compatible,true);assert.equal(calls,1);assert.deepEqual(deadlines,[75000]);assert.equal(MODEL_ONLY_HEALTH_TIMEOUT_MS,75000);
 const workflow=await readFile(new URL('../.github/workflows/model-only-scheduled.yml',import.meta.url),'utf8');assert.match(workflow,/timeout-minutes: 12/);
});
test('health timeout and transient HTTP errors remain single-attempt closed failures',async()=>{
 for(const response of [()=>{throw new DOMException('timed out','TimeoutError');},()=>new Response('',{status:503})]){
  let calls=0;const result=await inspect(async()=>{calls++;return response();});
  assert.equal(result.compatible,false);assert.equal(calls,1);
 }
});
test('a 60-second cold start validates against the completion clock, not request start',async()=>{
 let current=now;
 const result=await inspectModelOnlyHealth(artifact,{clock:()=>current,fetchImpl:async()=>{
  current+=60000;return Response.json({...health(),serverTime:new Date(current).toISOString()});
 }});
 assert.equal(result.compatible,true);
 const stale=await inspectModelOnlyHealth(artifact,{clock:()=>now+75000,fetchImpl:async()=>Response.json(health())});
 assert.equal(stale.reason,'MODEL_HEALTH_TIME_INVALID_OR_STALE');
});
test('reservation and capture still evaluate current window after the health wait',async()=>{
 const text=await readFile(new URL('../scripts/run-model-only-cycle.mjs',import.meta.url),'utf8');
 assert.match(text,/if\(productionCompatible\)ledger=reserveModelGames\(ledger,receipts,\{now:clock\(\),runKey,failedWeeks\}\)/);
 assert.match(text,/if\(clock\(\)>Date.parse\(reserved.payload.game.kickoff\)-45\*60000\)throw Error\('WINDOW_CLOSED'\)/);
 assert.match(text,/AbortSignal.timeout\(20000\)/);
});
