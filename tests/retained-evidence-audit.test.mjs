import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {emptyJournal} from '../src/evidence.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const script=fileURLToPath(new URL('../scripts/audit-retained-game-grades.mjs',import.meta.url));
async function run(t,journal){
  const cwd=await mkdtemp(join(tmpdir(),'betq-audit-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  await mkdir(join(cwd,'data/evidence'),{recursive:true});
  const bytes=JSON.stringify(journal),path=join(cwd,'data/evidence/nfl-2026.json');await writeFile(path,bytes);
  // Any accidental source fetch fails the child run rather than using an external service.
  await writeFile(join(cwd,'deny-network.mjs'),"globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')}; Date.now=()=>Date.parse('2026-11-16T12:00:00Z');\n");
  const child=spawnSync(process.execPath,['--import',join(cwd,'deny-network.mjs'),script],{cwd,encoding:'utf8'});
  assert.equal(await readFile(path,'utf8'),bytes);
  return {child,cwd,bytes};
}
test('offline audit reports missing corroboration without rewriting evidence or fabricating grades',async t=>{
  const journal={...syntheticScoringJournal(2,0),provenance:emptyJournal(2026).provenance};
  const {child,cwd,bytes}=await run(t,journal);assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(await readFile(join(cwd,'audit-output/retained-game-grades.json'),'utf8'));
  assert.equal(report.status,'NO_QUALIFIED_GAME_GRADES');assert.equal(report.grades.coverage.gradedGames,0);
  assert.equal(report.reasonCounts.RESULT_NOT_SOURCE_CORROBORATED,2);
  assert.equal(report.source.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(report.independentOutcomeVerificationPerformed,false);assert.equal(report.collectorHealthVerified,false);
  assert.equal(report.providerRequests,0);assert.equal(report.paidOddsRequests,0);assert.equal(report.journalModified,false);
});
test('empty valid journal reports zero coverage, not complete league coverage',async t=>{
  const {child,cwd}=await run(t,emptyJournal(2026));assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(await readFile(join(cwd,'audit-output/retained-game-grades.json'),'utf8'));
  assert.equal(report.grades.coverage.trackedGames,0);assert.equal(report.grades.coverage.leagueWideCompletenessVerified,false);
});
test('invalid journal fails the audit without producing a success artifact',async t=>{
  const {child,cwd}=await run(t,{schema:999});assert.notEqual(child.status,0);
  await assert.rejects(readFile(join(cwd,'audit-output/retained-game-grades.json')),e=>e.code==='ENOENT');
});
test('qualified fixture produces descriptive grades without a performance or independence claim',async t=>{
  const journal={...syntheticScoringJournal(1,1),provenance:emptyJournal(2026).provenance};
  const {child,cwd}=await run(t,journal);assert.equal(child.status,0,child.stderr);
  const report=JSON.parse(await readFile(join(cwd,'audit-output/retained-game-grades.json'),'utf8'));
  assert.equal(report.status,'DESCRIPTIVE_GRADES_AVAILABLE');assert.equal(report.grades.coverage.gradedGames,1);
  assert.equal(report.summary.forwardMetrics,null);assert.equal(report.independentOutcomeVerificationPerformed,false);
  assert.equal(report.grades.limitations.verifiedROI,false);
});
