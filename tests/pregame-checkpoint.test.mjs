import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DIRECTORY,TRIAL_ID,REPOSITORY,INPUT_DIGESTS,canonical,sha256,readCheckpointInputs,
  freezePendingCohort,prepareCheckpoint,verifyPreparedCheckpoint,validatePublicationReceipt} from '../scripts/pregame-checkpoint.mjs';
import {summarizeEvidence} from '../src/evidence.mjs';
const inputs=await readCheckpointInputs();
const manifestText=await readFile(new URL('../'+DIRECTORY+'/manifest.json',import.meta.url),'utf8');
const manifest=JSON.parse(manifestText),preparedAt=manifest.preparedAt;
const script=await readFile(new URL('../scripts/pregame-checkpoint.mjs',import.meta.url),'utf8');
const blob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
function mockReceipt(){
  const commit={sha:'c'.repeat(40),tree:{sha:'d'.repeat(40)}};
  const run={id:123,repository:{full_name:REPOSITORY},event:'pull_request',run_attempt:1,status:'completed',
    conclusion:'success',head_sha:commit.sha,created_at:'2026-11-05T17:00:00Z',updated_at:'2026-11-05T17:01:00Z',
    html_url:'https://github.com/'+REPOSITORY+'/actions/runs/123'};
  const tree={sha:commit.tree.sha,truncated:false,tree:[
    {path:'scripts/pregame-checkpoint.mjs',type:'blob',mode:'100644',sha:blob(script)},
    ...Object.entries({'manifest.json':manifestText,...inputs}).map(([name,text])=>({
      path:DIRECTORY+'/'+name,type:'blob',mode:'100644',sha:blob(text)}))]};
  return {manifestText,inputs,run,commit,tree};
}
test('Frozen real cohort contains every pending game once with exact source and record hashes',async()=>{
  const before=JSON.stringify(inputs),out=await verifyPreparedCheckpoint(manifest,inputs);
  assert.equal(out.cohortSize,29);assert.equal(out.publicationVerified,false);assert.equal(out.qualifyingOutcomesAdded,0);
  const j=JSON.parse(inputs['source-journal.json']);
  assert.equal(sha256(inputs['source-journal.json']),INPUT_DIGESTS['source-journal.json']);
  assert.equal(new Set(manifest.cohort.map(x=>x.gameId)).size,29);
  for(const entry of manifest.cohort){
    const shot=j.snapshots.find(s=>s.id===entry.snapshotId);
    assert.equal(sha256(canonical(shot)),entry.snapshotSha256);
    assert.equal(entry.homeProbability,shot.modelHomeProbability);
    assert.equal(entry.challengerIncluded,false);
    assert.ok(!j.settlements.some(s=>s.gameId===entry.gameId));
  }
  assert.equal(JSON.stringify(inputs),before);
});
test('All 29 stored probabilities reproduce from the correct two historical model/code bindings',()=>{
  assert.equal(manifest.inferenceReplay.count,29);
  assert.equal(manifest.inferenceReplay.exactRoundedProbabilitiesReproduced,true);
  assert.equal(manifest.inferenceReplay.trainingReproduced,false);
  assert.equal(manifest.inferenceReplay.originalDeployedScorerIdentityVerified,false);
  assert.deepEqual(manifest.inferenceReplay.records.reduce((out,r)=>(out[r.bindingId]=(out[r.bindingId]||0)+1,out),{}),
    {'nov2-morning':15,'nov2-evening':14});
  for(const r of manifest.inferenceReplay.records)
    assert.equal(r.homeProbability,manifest.cohort.find(e=>e.snapshotId===r.snapshotId).homeProbability);
});
test('JAX operational example preserves first Elo and old market vintage without later challenger',()=>{
  const first=manifest.cohort[0];assert.equal(first.gameId,'2026_09_JAX_BAL');
  assert.equal(first.snapshotId,'1f4bc657f670fcd10bbff447');assert.equal(first.homeProbability,.401566);
  assert.equal(first.derivedMarketReference.homeProbability,.239418);
  assert.equal(first.derivedMarketReference.currentOdds,false);assert.equal(first.challengerIncluded,false);
  assert.equal(manifest.jaxBalPublicationExample.originalFirstSnapshotHasChallenger,false);
});
for(const name of Object.keys(INPUT_DIGESTS))test('Changed pinned bytes reject: '+name,async()=>{
  await assert.rejects(()=>prepareCheckpoint({...inputs,[name]:inputs[name]+' '},preparedAt),/HASH_MISMATCH/);
});
for(const mutate of [m=>m.cohort.pop(),m=>m.cohort.push(structuredClone(m.cohort[0])),
  m=>m.cohort[0].homeProbability=.99,m=>m.cohort[0].snapshotId='238a234637238cc041234e2c',
  m=>m.cohort[0].challengerIncluded=true,m=>m.cohort[0].frozenKickoff='2026-11-07T01:15:00.000Z',
  m=>m.safeguards.qualifyingOutcomesAdded=1,m=>m.checkpointPublication.verified=true])
  test('Manifest cohort/claim tampering cannot pass verification',async()=>{
    const bad=structuredClone(manifest);mutate(bad);
    await assert.rejects(()=>verifyPreparedCheckpoint(bad,inputs),/MANIFEST_MISMATCH/);
  });
test('Duplicate trial and preparation at/after earliest kickoff fail instead of dropping JAX',async()=>{
  await assert.rejects(()=>prepareCheckpoint(inputs,preparedAt,{existingTrialIds:[TRIAL_ID]}),/DUPLICATE/);
  for(const at of ['2026-11-06T01:15:00.000Z','2026-11-07T12:00:00.000Z'])
    await assert.rejects(()=>prepareCheckpoint(inputs,at),/WINDOW_CLOSED/);
});
test('Preparation rejects backfilled future-capture records and already-resulted upcoming games',()=>{
  const j=JSON.parse(inputs['source-journal.json']);
  const future=structuredClone(j);future.snapshots.find(s=>s.gameId==='2026_09_JAX_BAL').capturedAt='2026-11-05T23:00:00.000Z';
  assert.throws(()=>freezePendingCohort(future,preparedAt),/FUTURE|UNTRUSTED/);
  const known=structuredClone(j);known.settlements.push({gameId:'2026_09_JAX_BAL',homeScore:21,awayScore:14,outcome:'HOME'});
  assert.throws(()=>freezePendingCohort(known,preparedAt),/ALREADY_HAS_RESULT/);
});
test('Prepared timestamp alone is never publication proof or an eligible outcome',async()=>{
  assert.equal(manifest.checkpointPublication.verified,false);
  assert.equal(manifest.checkpointPublication.preparedAtIsPublicationProof,false);
  await assert.rejects(()=>validatePublicationReceipt({manifestText,inputs}),/RECEIPT/);
  const out=await validatePublicationReceipt(mockReceipt());
  assert.equal(out.authenticationVerifiedByThisFunction,false);
  assert.equal(out.qualifyingOutcomesAdded,0);assert.equal(out.sourceIndependenceVerified,false);
});
const badReceipts={
  'after kickoff':x=>x.run.updated_at='2026-11-06T01:15:00Z',
  'before local preparation':x=>x.run.created_at='2026-11-05T15:00:00Z',
  'failed check':x=>x.run.conclusion='failure',
  'different repository':x=>x.run.repository.full_name='elsewhere/repo',
  'different head':x=>x.run.head_sha='e'.repeat(40),
  'different tree':x=>x.tree.sha='e'.repeat(40),
  'truncated tree':x=>x.tree.truncated=true,
  'missing plan':x=>x.tree.tree=x.tree.tree.filter(f=>!f.path.endsWith('/plan.md')),
  'changed manifest bytes':x=>x.manifestText+=' ',
  'missing historical dependency':x=>x.tree.tree=x.tree.tree.filter(f=>!f.path.endsWith('/evening-historical-integrity.mjs')),
  'missing verifier':x=>x.tree.tree=x.tree.tree.filter(f=>f.path!=='scripts/pregame-checkpoint.mjs'),
  're-run mistaken for original receipt':x=>x.run.run_attempt=2
};
for(const [name,change] of Object.entries(badReceipts))test('Publication receipt rejects '+name,async()=>{
  const receipt=mockReceipt();change(receipt);await assert.rejects(()=>validatePublicationReceipt(receipt),/RECEIPT|BINDING/);
});
test('Checkpoint processing leaves existing journal, cohorts, metrics and files unchanged',async()=>{
  const source=new URL('../data/evidence/nfl-2026.json',import.meta.url);
  const before=await readFile(source,'utf8'),j=JSON.parse(before),summary=summarizeEvidence(j);
  await verifyPreparedCheckpoint(manifest,inputs);await validatePublicationReceipt(mockReceipt());
  assert.equal(await readFile(source,'utf8'),before);assert.deepEqual(summarizeEvidence(j,Date.parse(summary.generatedAt)),summary);
  assert.equal(summary.sourceCorroboratedSettledGames,0);assert.equal(summary.forwardMetrics,null);
  assert.equal(summary.settledGames,2);
});
