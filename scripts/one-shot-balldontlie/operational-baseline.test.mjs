import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BASE_SHA,OPERATIONAL_BASE_SHA,OPERATIONAL_JOURNAL_SHA256,JOURNAL_SHA256,BRANCH,
  EARLIEST_READ_AT,approvedContext,runOneShot,validateOperationalJournal,verifyOperationalBaseline} from './run.mjs';
const root=new URL('../../',import.meta.url);
const currentText=await readFile(new URL('data/evidence/nfl-2026.json',root),'utf8');
const frozenText=await readFile(new URL('docs/checkpoints/2026-11-05-elo/source-journal.json',root),'utf8');
const at=Date.parse(EARLIEST_READ_AT),hash=x=>createHash('sha256').update(x).digest('hex');
const context={approved:'true',repositorySecretConfirmed:'true',repository:'SpencerPhoenix/BETQ-ai',
  event:'workflow_dispatch',ref:BRANCH,runAttempt:'1',expectedSha:'a'.repeat(40),actualSha:'a'.repeat(40),
  currentMainSha:OPERATIONAL_BASE_SHA,expiresAt:new Date(at+600000).toISOString()};

test('operational pin and immutable pregame source are distinct and both journals bind exactly',async()=>{
  assert.notEqual(BASE_SHA,OPERATIONAL_BASE_SHA);assert.notEqual(JOURNAL_SHA256,OPERATIONAL_JOURNAL_SHA256);
  assert.equal(hash(currentText),OPERATIONAL_JOURNAL_SHA256);assert.equal(hash(frozenText),JOURNAL_SHA256);
  assert.deepEqual(await verifyOperationalBaseline(),{valid:true,operationalBaseSha:OPERATIONAL_BASE_SHA,
    currentSnapshots:132,originalSnapshotsPreserved:77,evidenceBaseSha:BASE_SHA});
});
test('stale main, old branch and missing operational attestation stop before any request',async()=>{
  for(const changes of [{currentMainSha:BASE_SHA},{currentMainSha:'b'.repeat(40)},
    {currentMainSha:undefined},{ref:'refs/heads/feat/jax-bal-postgame-20261105'},{ref:'refs/heads/main'}]){
    let calls=0;
    const c={...context,...changes};assert.equal(approvedContext(c,at),false);
    const result=await runOneShot({context:c,apiKey:'mock-only-key',journalText:frozenText,clock:()=>at,
      fetchImpl:async()=>{calls++;throw Error('UNEXPECTED_REQUEST');}});
    assert.equal(result.status,'NOT_APPROVED');assert.equal(calls,0);
  }
});
test('changed current bytes and substituted archival bytes fail closed',()=>{
  for(const [current,frozen] of [[currentText+' ',frozenText],[frozenText,frozenText],
    [currentText,currentText],[currentText,frozenText+' '],['',frozenText],[null,frozenText]])
    assert.throws(()=>validateOperationalJournal(current,frozen),/OPERATIONAL_JOURNAL_HASH/);
});
test('new settlements and later snapshots do not replace the immutable comparison input',async()=>{
  const current=JSON.parse(currentText),frozen=JSON.parse(frozenText);
  assert.equal(current.settlements.length,3);assert.equal(frozen.settlements.length,2);
  assert.equal(current.snapshots.length,132);assert.equal(frozen.snapshots.length,77);
  let calls=0;
  const result=await runOneShot({context,apiKey:'mock-only-key',journalText:currentText,clock:()=>at,
    fetchImpl:async()=>{calls++;throw Error('UNEXPECTED_REQUEST');}});
  assert.equal(result.status,'INVALID_PINNED_INPUT');assert.equal(calls,0);
  assert.equal(result.journalWrites,0);assert.equal(result.qualifiedOutcomes,0);
});
test('the local registered-path replacement is manual only, exact branch pinned and rechecks main after tests',async()=>{
  const active=await readFile(new URL('.github/workflows/live-probe.yml',root),'utf8');
  const template=await readFile(new URL('./live-probe.yml.template',import.meta.url),'utf8');
  assert.equal(active,template);
  assert.doesNotMatch(active,/\n\s*(push|schedule|pull_request|workflow_run):|git push|contents: write|api\/slate|upload-artifact/);
  assert.ok(active.includes("github.ref == '"+BRANCH+"'"));
  assert.equal((active.match(/git ls-remote --exit-code origin refs\/heads\/main/g)||[]).length,2);
  assert.ok(active.lastIndexOf('git ls-remote')>active.indexOf('npm test'));
  assert.ok(active.indexOf('!approvedContext(context,now)')<active.indexOf('secrets.BALLDONTLIE_API_KEY'));
  assert.ok(active.indexOf('steps.ready.outputs.main_sha')>active.indexOf('id: ready'));
  assert.equal((active.match(/secrets\./g)||[]).length,1);
});
