import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {emptyJournal,prepareCaptureAdmission,updateJournal} from '../src/evidence.mjs';
import {retainedJournalProjection,recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';
import {createHandler} from '../src/server.mjs';
import {describeModelDelivery,MODEL_DELIVERY_POLICY} from '../src/model-delivery.mjs';
import {syntheticDeliveryArtifact} from './fixtures/model-delivery.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';

const NOW=Date.parse('2026-11-07T13:00:00.000Z');
const identity=describeModelDelivery(syntheticDeliveryArtifact('2026-11-07T11:00:00.000Z','2026-11-06'),NOW);
function conflicted(){
  const j={...syntheticScoringJournal(2,0),provenance:emptyJournal(2026).provenance,settlements:[]};
  j.snapshots.push({...j.snapshots[0],id:'fixture-conflicting-kickoff',commenceTime:'2026-11-08T18:20:00.000Z'});
  return j;
}
function next(s){return {...s,id:s.id+'-new',capturedAt:'2026-11-07T13:00:00.000Z',
  sourceReceivedAt:'2026-11-07T12:59:59.000Z',marketNewestQuoteAt:'2026-11-07T12:59:58.000Z',
  marketOldestQuoteAt:'2026-11-07T12:59:58.000Z',modelArtifactCanonicalSha256:identity.artifactCanonicalSha256,
  modelDeliveryPolicy:MODEL_DELIVERY_POLICY};}

test('Exact delivered model identity cannot override a retained schedule conflict; unrelated admission remains intact',()=>{
  const j=conflicted(),before=structuredClone(j),admission=prepareCaptureAdmission(j,[next(j.snapshots[0]),next(j.snapshots[1])],NOW);
  assert.equal(admission.accepted.length,1);assert.equal(admission.accepted[0].gameId,'fixture-game-1');
  assert.equal(admission.diagnostics.quarantinedCaptures,1);
  const result=updateJournal(j,admission.accepted,[],NOW).journal;
  assert.deepEqual(result.snapshots.slice(0,j.snapshots.length),before.snapshots);
  assert.equal(result.snapshots.at(-1).modelArtifactCanonicalSha256,identity.artifactCanonicalSha256);
  const projection=retainedJournalProjection(result,NOW);
  assert.equal(projection.quarantine.excludedSnapshotCount,2);assert.equal(projection.journal.snapshots.length,2);
  assert.equal(recomputeJournalEvidence(result,NOW).forwardMetrics,null);assert.deepEqual(j,before);
});

test('Malformed model identity inside a quarantined game remains global corruption, never hidden by exclusion',()=>{
  for(const patch of [{modelArtifactCanonicalSha256:'bad',modelDeliveryPolicy:MODEL_DELIVERY_POLICY},
    {modelArtifactCanonicalSha256:identity.artifactCanonicalSha256,modelDeliveryPolicy:'UNRECOGNIZED_POLICY'}]){
    const j=conflicted();Object.assign(j.snapshots[2],patch);const before=structuredClone(j);
    assert.throws(()=>retainedJournalProjection(j,NOW));assert.throws(()=>prepareCaptureAdmission(j,[],NOW));
    assert.throws(()=>updateJournal(j,[],[],NOW));assert.deepEqual(j,before);
  }
});

test('Legacy records are neither upgraded nor rewritten by the delivered-model guard and quarantine projection',()=>{
  const j=conflicted(),before=JSON.stringify(j),summary=recomputeJournalEvidence(j,NOW);
  assert.equal(summary.quarantine.rawSnapshotCount,3);assert.equal(summary.totalSnapshots,1);
  assert.equal(summary.sourceCorroboratedSettledGames,0);assert.equal(summary.forwardMetrics,null);
  assert.equal(j.snapshots.some(s=>'modelArtifactCanonicalSha256' in s),false);assert.equal(JSON.stringify(j),before);
});

test('Read-only bundled journal health exposes exact model identity and per-game quarantine without any odds fetch',async t=>{
  const journal=JSON.parse(readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8'));
  const before=JSON.stringify(journal);
  const artifact=JSON.parse(readFileSync(new URL('../data/nfl_elo.json',import.meta.url),'utf8'));
  // Keep this a fresh-artifact test when automated data refreshes advance the bundle.
  const at=Math.max(Date.parse(artifact.generatedAt)+3600000,...journal.snapshots.map(s=>Date.parse(s.capturedAt)),...journal.settlements.map(r=>Date.parse(r.verifiedAt)));
  const expected=describeModelDelivery(artifact,at),summary=recomputeJournalEvidence(journal,at);let calls=0;
  const server=http.createServer(createHandler({clock:()=>at,nflArtifact:artifact,nflEvidenceJournal:journal,evidenceFeed:null,
    nflEfficiency:null,nflInjuries:null,source:{status:()=>({configured:false}),getOdds:()=>{calls++;throw Error('NO_ODDS_REQUEST_ALLOWED');}},
    injuryFeed:{status:()=>({available:false}),get:async()=>({artifact:null})},operatorRefreshToken:''}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/health'),health=await response.json();
  assert.equal(response.status,200);assert.equal(calls,0);assert.equal(expected.available,true);
  assert.deepEqual(health.nflModel.deliveryIdentity,expected);assert.deepEqual(health.forwardEvidence.quarantine,summary.quarantine);
  assert.equal(health.forwardEvidence.available,true);assert.equal(summary.quarantine.excludedGameCount,1);
  assert.equal(health.forwardEvidence.sourceCorroboratedSettledGames,0);assert.equal(health.captureReadiness.ready,false);
  assert.equal(JSON.stringify(journal),before);
});
