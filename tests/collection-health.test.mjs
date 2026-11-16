import {describeMarketCaptureContract} from '../src/evidence-compat.mjs';
import test from 'node:test';
import {bundledDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {collectionHealthFromBundledJournal} from '../src/collection-health.mjs';
const now=Date.parse('2026-11-07T12:00:00Z');
test('Health never presents a bundled capture as a functioning current collector',()=>{
  const result=collectionHealthFromBundledJournal({snapshots:[
    {capturedAt:'2026-11-06T12:00:00Z'},{capturedAt:'2026-11-07T10:00:00Z'}
  ]},now);
  assert.equal(result.lastKnownCaptureAgeSeconds,7200);
  assert.equal(result.lastKnownCaptureAt,'2026-11-07T10:00:00.000Z');
  assert.equal(result.state,'COLLECTOR_HEALTH_UNKNOWN');
  assert.equal(result.latestAttemptStatus,'NOT_OBSERVED_BY_WEB_SERVICE');
  assert.equal(result.liveFreshnessVerified,false);
});
test('Empty, invalid and future-only journal metadata cannot invent a healthy collector',()=>{
  for(const journal of [null,{}, {snapshots:[]}, {snapshots:[{}, {capturedAt:'bad'}, {capturedAt:'2026-11-08T00:00:00Z'}]}]){
    const result=collectionHealthFromBundledJournal(journal,now);
    assert.equal(result.lastKnownCaptureAt,null);
    assert.equal(result.lastKnownCaptureAgeSeconds,null);
    assert.equal(result.starvationVerified,false);
    assert.equal(result.liveFreshnessVerified,false);
  }
});
const base={marketCaptureContract:describeMarketCaptureContract(),status:'ok',app:'BETQ.ai',version:'0.11.0',odds:{configured:true},
  nflModel:{available:true},forwardEvidence:{status:'COLLECTING_FORWARD_EVIDENCE'}};
const cli=new URL('../scripts/verify-evidence-health.mjs',import.meta.url);
test('Collector preflight refuses absent or blocked operator/budget prerequisite contract',()=>{
  for(const captureReadiness of [undefined,{ready:false,reason:'BUDGET_OUTCOME_UNKNOWN'}]){
    const result=spawnSync(process.execPath,[cli.pathname],{input:JSON.stringify({...base,captureReadiness}),encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/prerequisites unavailable/);
  }
});
test('Collector preflight reports uncertainty separately when provider prerequisites are ready',()=>{
  const fixtureNow=Date.parse(bundledDeliveryArtifact.generatedAt)+3600000;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`Date.now=()=>${fixtureNow};await import(${JSON.stringify(cli.href)});`],{input:JSON.stringify(modelHealthFixture(bundledDeliveryArtifact,fixtureNow)),encoding:'utf8'});
  assert.equal(result.status,0);
  assert.match(result.stderr,/Collector health is unverified/);
  assert.match(result.stdout,/source contract verified/);
});
