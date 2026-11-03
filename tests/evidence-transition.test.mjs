import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm,unlink} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyJournal} from '../src/evidence.mjs';
import {verifyAppendOnlyEvidence} from '../src/evidence-transition.mjs';
import {sourceProvenance} from './fixtures/source-provenance.mjs';

const snapshot=(id='original')=>({id,gameId:'game-'+id,season:2026,
  gameDate:'2026-11-02',home:'SEA',away:'CHI',
  capturedAt:'2026-11-01T12:00:00.000Z',commenceTime:'2026-11-02T12:00:00.000Z',
  modelHomeProbability:0.6,researchOnly:true});
const oldResult=()=>({gameId:'game-original',gameDate:'2026-11-02',
  homeScore:17,awayScore:24,outcome:'AWAY',revision:1,source:'NFLVERSE_SCHEDULES'});
function fixture(){
  const j=emptyJournal(2026);j.snapshots=[snapshot(),snapshot('second')];
  j.settlements=[oldResult(),{...oldResult(),gameId:'game-second'}];return j;
}
function confirmed(){
  const result={...oldResult(),revision:2,
    ...sourceProvenance('2026-11-04T12:00:00.000Z'),
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED'};
  result.finalityAttestation={status:'CROSS_SOURCE_FINAL',corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
    gameId:result.gameId,gameDate:result.gameDate,homeScore:17,awayScore:24,
    eventId:'401123456',sourceSha256:'a'.repeat(64),
    observedAt:result.verifiedAt,officialLeagueCertification:false};
  return result; // synthetic unit-test attestation, not a collected source result
}
test('unchanged history and appended forecasts/corroboration pass without mutating inputs',()=>{
  const previous=fixture(),current=structuredClone(previous);
  current.snapshots.push(snapshot('new'));current.settlements.push(confirmed());
  const before=JSON.stringify({previous,current});
  assert.deepEqual(verifyAppendOnlyEvidence(previous,current),{immutableRecordsVerified:true,
    originalSnapshots:2,appendedSnapshots:1,originalSettlements:2,appendedSettlementRevisions:1});
  assert.equal(JSON.stringify({previous,current}),before);
  assert.equal(verifyAppendOnlyEvidence(previous,previous).appendedSnapshots,0);
});
test('schema-valid forecast edits, deletions and reordering cannot pass the publication guard',()=>{
  for(const change of [j=>{j.snapshots[0].modelHomeProbability=0.9;},
    j=>{j.snapshots[0].capturedAt='2026-11-01T11:59:59.000Z';},
    j=>{j.snapshots[0].extraProvenance='rewritten';},j=>j.snapshots.pop(),j=>j.snapshots.reverse()]){
    const previous=fixture(),current=structuredClone(previous);change(current);
    assert.throws(()=>verifyAppendOnlyEvidence(previous,current),/FROZEN_FORECAST/);
  }
});
test('historic result edits, deletions, reordering and root metadata changes fail closed',()=>{
  for(const change of [j=>{j.settlements[0].homeScore=18;},
    j=>{j.settlements[0].source='changed';},j=>j.settlements.pop(),j=>j.settlements.reverse()]){
    const previous=fixture(),current=structuredClone(previous);change(current);
    assert.throws(()=>verifyAppendOnlyEvidence(previous,current),/HISTORIC_SETTLEMENT/);
  }
  const previous=fixture(),current=structuredClone(previous);current.provenance.results='changed';
  assert.throws(()=>verifyAppendOnlyEvidence(previous,current),/JOURNAL_METADATA_CHANGED/);
});
test('new result revisions require tracked games, consecutive revisions and complete corroboration',()=>{
  for(const [change,error] of [
    [r=>{r.gameId='untracked';},/WITHOUT_FROZEN_FORECAST/],
    [r=>{r.gameDate='2026-11-03';r.finalityAttestation.gameDate=r.gameDate;},/GAME_DATE_MISMATCH/],
    [r=>{r.revision=1;},/NOT_CONSECUTIVE/],
    [r=>{r.revision=3;},/NOT_CONSECUTIVE/],
    [r=>{delete r.communitySourceVintage;},/NOT_SOURCE_CORROBORATED/],
    [r=>{delete r.finalityAttestation;},/NOT_SOURCE_CORROBORATED/]
  ]){
    const previous=fixture(),current=structuredClone(previous),result=confirmed();change(result);
    current.settlements.push(result);assert.throws(()=>verifyAppendOnlyEvidence(previous,current),error);
  }
});
test('settlement-only mode forbids new forecasts and conflicting frozen game identities fail closed',()=>{
  const previous=fixture(),current=structuredClone(previous);current.settlements.push(confirmed());
  assert.equal(verifyAppendOnlyEvidence(previous,current,{allowNewSnapshots:false}).appendedSettlementRevisions,1);
  current.snapshots.push(snapshot('new'));
  assert.throws(()=>verifyAppendOnlyEvidence(previous,current,{allowNewSnapshots:false}),/SETTLEMENT_ONLY_FORECAST_APPEND_FORBIDDEN/);
  const conflict=structuredClone(previous);conflict.snapshots.push({...snapshot(),id:'conflicting',home:'NYG'});
  assert.throws(()=>verifyAppendOnlyEvidence(previous,conflict),/CONFLICTING_FROZEN_GAME_IDENTITY/);
});
test('existing real journal is accepted unchanged, including its legacy community-only result',async()=>{
  const bytes=await readFile(new URL('../data/evidence/nfl-2026.json',import.meta.url));
  const j=JSON.parse(bytes.toString('utf8'));
  assert.equal(verifyAppendOnlyEvidence(j,structuredClone(j)).appendedSettlementRevisions,0);
});
test('fixed-file CLI compares HEAD, rejects deleted files, and permits a valid new-season journal',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'betq-append-guard-'));
  try{
    execFileSync('git',['init','-q'],{cwd});
    await mkdir(join(cwd,'data/evidence'),{recursive:true});
    const path=join(cwd,'data/evidence/nfl-2026.json');
    await writeFile(path,JSON.stringify(fixture()));
    execFileSync('git',['add','data/evidence/'],{cwd});
    execFileSync('git',['-c','user.name=BETQ Test','-c','user.email=test@example.invalid',
      'commit','-qm','synthetic test baseline'],{cwd});
    const script=new URL('../scripts/verify-evidence-append-only.mjs',import.meta.url).pathname;
    const run=(args=[])=>spawnSync(process.execPath,[script,...args],{cwd,encoding:'utf8'});
    assert.equal(run().status,0);
    assert.equal(run(['--settlement-only']).status,0);
    assert.notEqual(run(['--write']).status,0);
    const changed=fixture();changed.snapshots[0].modelHomeProbability=0.8;
    await writeFile(path,JSON.stringify(changed));
    assert.match(run().stderr,/FROZEN_FORECAST/);
    await writeFile(path,JSON.stringify(fixture()));
    const append=fixture();append.snapshots.push(snapshot('new'));
    await writeFile(path,JSON.stringify(append));
    assert.match(run(['--settlement-only']).stderr,/SETTLEMENT_ONLY_FORECAST_APPEND_FORBIDDEN/);
    await writeFile(path,JSON.stringify(fixture()));
    await writeFile(join(cwd,'data/evidence/nfl-2027.json'),JSON.stringify(emptyJournal(2027)));
    assert.match(run(['--settlement-only']).stderr,/SETTLEMENT_ONLY_NEW_JOURNAL_FORBIDDEN/);
    const passed=run();assert.equal(passed.status,0,passed.stderr);
    const report=JSON.parse(passed.stdout);
    assert.equal(report.reports.length,2);assert.equal(report.filesWritten,0);assert.equal(report.providerRequests,0);
    await unlink(path);assert.match(run().stderr,/TRACKED_EVIDENCE_JOURNAL_DELETED/);
  }finally{await rm(cwd,{recursive:true,force:true});}
});
test('both draft writer workflows run the same immutable-history check before git add or push',async()=>{
  for(const file of ['capture-evidence.yml','settlement-only.yml']){
    const workflow=await readFile(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
    const guard=workflow.indexOf('node scripts/verify-evidence-append-only.mjs');
    assert.ok(guard>0,file);assert.ok(guard<workflow.indexOf('git add data/evidence/'),file);
    assert.ok(guard<workflow.indexOf('git push origin HEAD:main'),file);
    if(file==='settlement-only.yml'){
      assert.match(workflow,/verify-evidence-append-only\.mjs --settlement-only/);
      for(const path of ['src/evidence-transition.mjs','scripts/verify-evidence-append-only.mjs',
        'tests/evidence-transition.test.mjs'])assert.ok(workflow.includes("- '"+path+"'"),path);
    }
  }
});
