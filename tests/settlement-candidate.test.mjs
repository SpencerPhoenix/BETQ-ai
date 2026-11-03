import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyJournal} from '../src/evidence.mjs';
import {nflSeasonAt} from '../src/settlement-only.mjs';
import {sourceProvenance} from './fixtures/source-provenance.mjs';
import {assertSettlementPreparation,createSettlementCandidate,serializeSettlementCandidate,
  candidateSha256,verifySettlementCandidate} from '../src/settlement-candidate.mjs';

const sourceCommit='a'.repeat(40),preparedAt='2026-11-04T12:00:00.000Z';
const encode=j=>JSON.stringify(j,null,2)+'\n';
const gate=()=>({event:'workflow_dispatch',ref:'refs/heads/main',operation:'prepare',
  sourceUseConfirmed:true,expectedSourceCommit:sourceCommit,actualSourceCommit:sourceCommit,
  currentMainCommit:sourceCommit});
function fixture(season=2026){
  const previous=emptyJournal(season);
  previous.snapshots=[{id:'synthetic',gameId:'synthetic-game',season,gameDate:'2026-11-02',
    home:'SEA',away:'CHI',capturedAt:'2026-11-01T12:00:00.000Z',commenceTime:'2026-11-02T12:00:00.000Z',
    modelHomeProbability:0.6,researchOnly:true}];
  const journal=structuredClone(previous);
  journal.settlements.push({gameId:'synthetic-game',gameDate:'2026-11-02',homeScore:17,awayScore:24,
    outcome:'AWAY',revision:1,source:'NFLVERSE_SCHEDULES',...sourceProvenance(preparedAt),
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',
    finalityAttestation:{status:'CROSS_SOURCE_FINAL',corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
      gameId:'synthetic-game',gameDate:'2026-11-02',homeScore:17,awayScore:24,eventId:'401123456',
      sourceSha256:'c'.repeat(64),observedAt:preparedAt,officialLeagueCertification:false}});
  return {previous,journal,previousText:encode(previous),journalText:encode(journal)};
}
test('preparation gate requires explicit approved main dispatch pinned to actual and current revision',()=>{
  assert.deepEqual(assertSettlementPreparation(gate()),{preparationAllowed:true,publicationAuthorized:false});
  for(const change of [{event:'schedule'},{event:'pull_request'},{ref:'refs/heads/feature'},
    {operation:'validate'},{sourceUseConfirmed:false},{sourceUseConfirmed:'true'},
    {expectedSourceCommit:''},{expectedSourceCommit:'abcdef'},
    {actualSourceCommit:'b'.repeat(40)},{currentMainCommit:'c'.repeat(40)}])
    assert.throws(()=>assertSettlementPreparation({...gate(),...change}));
});
test('candidate binds exact baseline and result bytes, regenerated summary and source commit without authorizing publication',()=>{
  const f=fixture(),bundle=createSettlementCandidate({sourceCommit,preparedAt,...f});
  assert.equal(bundle.baselineSha256,candidateSha256(f.previousText));
  assert.equal(bundle.journalSha256,candidateSha256(f.journalText));
  assert.equal(bundle.summarySha256,candidateSha256(bundle.summaryText));
  assert.equal(bundle.transition.appendedSettlementRevisions,1);
  const text=serializeSettlementCandidate(bundle);
  const options={expectedSha256:candidateSha256(text),expectedSourceCommit:sourceCommit,previousText:f.previousText};
  assert.equal(verifySettlementCandidate(text,options).publicationAuthorized,false);
  assert.equal(verifySettlementCandidate(text,options).verified,true);
  assert.equal(serializeSettlementCandidate(createSettlementCandidate({sourceCommit,preparedAt,...f})),text);
});
test('tampering, stale baseline and wrong externally reviewed digest or revision fail closed',()=>{
  const f=fixture(),bundle=createSettlementCandidate({sourceCommit,preparedAt,...f});
  const text=serializeSettlementCandidate(bundle);
  const options={expectedSha256:candidateSha256(text),expectedSourceCommit:sourceCommit,previousText:f.previousText};
  assert.throws(()=>verifySettlementCandidate(text+' ',options),/DIGEST_MISMATCH/);
  assert.throws(()=>verifySettlementCandidate(text,{...options,expectedSha256:undefined}),/DIGEST_MISMATCH/);
  assert.throws(()=>verifySettlementCandidate(text,{...options,expectedSourceCommit:'b'.repeat(40)}),/SOURCE_COMMIT_MISMATCH/);
  assert.throws(()=>verifySettlementCandidate(text,{...options,previousText:f.previousText+' '}),/BASELINE_MISMATCH/);
  for(const change of [b=>{b.publicationAuthorized=true;},b=>{b.summaryText='{}';},
    b=>{b.summarySha256='d'.repeat(64);},b=>{b.baselineSha256='d'.repeat(64);},
    b=>{b.journalPath='../../elsewhere';},b=>{b.extra='unreviewed';}]){
    const altered=structuredClone(bundle);change(altered);const changed=serializeSettlementCandidate(altered);
    assert.throws(()=>verifySettlementCandidate(changed,{...options,expectedSha256:candidateSha256(changed)}),/BASELINE_MISMATCH/);
  }
});
test('candidate creation enforces settlement-only append rules and canonical preparation metadata',()=>{
  const f=fixture();
  const forecast=structuredClone(f.journal);forecast.snapshots.push({...forecast.snapshots[0],id:'later'});
  assert.throws(()=>createSettlementCandidate({sourceCommit,preparedAt,...f,journalText:encode(forecast)}),/FORECAST_APPEND_FORBIDDEN/);
  const incomplete=structuredClone(f.journal);delete incomplete.settlements[0].communitySourceVintage;
  assert.throws(()=>createSettlementCandidate({sourceCommit,preparedAt,...f,journalText:encode(incomplete)}),/NOT_SOURCE_CORROBORATED/);
  assert.throws(()=>createSettlementCandidate({sourceCommit,preparedAt:'2026-11-04',...f}),/INVALID_PREPARATION_TIME/);
  assert.throws(()=>createSettlementCandidate({sourceCommit:'main',preparedAt,...f}),/INVALID_SOURCE_COMMIT/);
});
test('JSON-escaped bundles cannot be emitted larger than the verifier accepts',()=>{
  const f=fixture();
  f.previous.padding='"'.repeat(800000);f.journal.padding=f.previous.padding;
  const previousText=encode(f.previous),journalText=encode(f.journal);
  assert.ok(Buffer.byteLength(journalText)<3000000);
  const bundle=createSettlementCandidate({sourceCommit,preparedAt,previousText,journalText});
  assert.throws(()=>serializeSettlementCandidate(bundle),/CANDIDATE_TOO_LARGE/);
});
test('fixed-path CLI prepares synthetic artifact only and verifies it read-only without publishing',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'betq-candidate-'));
  try{
    execFileSync('git',['init','-q'],{cwd});await mkdir(join(cwd,'data/evidence'),{recursive:true});
    const season=nflSeasonAt(),f=fixture(season),file=join(cwd,'data/evidence/nfl-'+season+'.json');
    await writeFile(file,f.previousText);await writeFile(join(cwd,'code.txt'),'unchanged');
    execFileSync('git',['add','.'],{cwd});execFileSync('git',['-c','user.name=BETQ Test',
      '-c','user.email=test@example.invalid','commit','-qm','synthetic baseline'],{cwd});
    const sha=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
    const env={...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
      GITHUB_SHA:sha,EXPECTED_SOURCE_SHA:sha,CURRENT_MAIN_SHA:sha,SETTLEMENT_OPERATION:'prepare',SOURCE_USE_CONFIRMED:'true'};
    const script=new URL('../scripts/settlement-candidate.mjs',import.meta.url).pathname;
    const run=(mode,extra={})=>spawnSync(process.execPath,[script,mode],{cwd,env:{...env,...extra},encoding:'utf8'});
    assert.equal(run('preflight').status,0);
    assert.match(run('preflight',{SOURCE_USE_CONFIRMED:'false'}).stderr,/CONFIRMATION_REQUIRED/);
    assert.match(run('preflight',{CURRENT_MAIN_SHA:'b'.repeat(40)}).stderr,/REVISION_MISMATCH/);
    await writeFile(file,f.journalText);assert.match(run('preflight').stderr,/CLEAN_PINNED_CHECKOUT_REQUIRED/);
    const prepared=run('prepare');assert.equal(prepared.status,0,prepared.stderr);
    const report=JSON.parse(prepared.stdout);assert.equal(report.publicationAuthorized,false);
    assert.equal(report.providerRequests,0);assert.equal(report.appendedSettlementRevisions,1);
    assert.match(run('prepare').stderr,/EEXIST/);
    const verified=run('verify',{EXPECTED_CANDIDATE_SHA256:report.candidateSha256});
    assert.equal(verified.status,0,verified.stderr);
    assert.equal(await readFile(file,'utf8'),f.journalText);
    assert.match(run('verify',{EXPECTED_CANDIDATE_SHA256:'d'.repeat(64)}).stderr,/DIGEST_MISMATCH/);
    assert.match(run('verify',{EXPECTED_SOURCE_SHA:'b'.repeat(40)}).stderr,/PINNED_CHECKOUT_REQUIRED/);
    assert.notEqual(run('--publish').status,0);
    assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim(),sha);
  }finally{await rm(cwd,{recursive:true,force:true});}
});
test('preparation CLI rejects changes outside its season evidence allowlist',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'betq-candidate-other-'));
  try{
    execFileSync('git',['init','-q'],{cwd});await writeFile(join(cwd,'code.txt'),'baseline');
    execFileSync('git',['add','.'],{cwd});execFileSync('git',['-c','user.name=BETQ Test',
      '-c','user.email=test@example.invalid','commit','-qm','baseline'],{cwd});
    const sha=execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8'}).trim();
    await writeFile(join(cwd,'code.txt'),'changed');
    const r=spawnSync(process.execPath,[new URL('../scripts/settlement-candidate.mjs',import.meta.url).pathname,'prepare'],
      {cwd,encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',
        GITHUB_SHA:sha,EXPECTED_SOURCE_SHA:sha,CURRENT_MAIN_SHA:sha,SETTLEMENT_OPERATION:'prepare',SOURCE_USE_CONFIRMED:'true'}});
    assert.match(r.stderr,/UNEXPECTED_PREPARATION_CHANGE/);
  }finally{await rm(cwd,{recursive:true,force:true});}
});
test('workflow defaults to offline validation and cannot publish or schedule settlement writes',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/settlement-only.yml',import.meta.url),'utf8');
  assert.match(workflow,/default: validate/);assert.match(workflow,/default: false/);
  assert.doesNotMatch(workflow,/\n  schedule:|cron:|contents: write|persist-credentials: true|git push|git commit|git reset|workflow_run:/);
  assert.match(workflow,/contents: read/);assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);
  const validation=workflow.slice(workflow.indexOf('  validation:'),workflow.indexOf('  preparation:'));
  assert.doesNotMatch(validation,/evidence:settle|settlement-candidate|upload-artifact/);
  assert.match(workflow,/inputs.operation == 'prepare'/);
  const provider=workflow.indexOf('run: npm run evidence:settle');
  assert.ok(workflow.indexOf('settlement-candidate.mjs preflight')<provider);
  assert.ok(workflow.lastIndexOf('settlement-candidate.mjs preflight')<provider);
  assert.ok(workflow.indexOf('Retest the actual pinned preparation checkout')<provider);
  assert.ok(provider<workflow.indexOf('verify-evidence-append-only.mjs --settlement-only'));
  assert.ok(workflow.indexOf('verify-evidence-append-only.mjs --settlement-only')<workflow.indexOf('settlement-candidate.mjs prepare'));
  assert.match(workflow,/path: \|\n            audit-output\/settlement-candidate.json\n            audit-output\/settlement-candidate-report.json/);
  assert.doesNotMatch(workflow,/run:.*\$\{\{ inputs\./);
});
