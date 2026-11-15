import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,readdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {syntheticBdlOutcomeInput} from './fixtures/bdl-outcome-candidate.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),script=join(root,'scripts/prepare-bdl-receipts.mjs');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'betq-bdl-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const input=syntheticBdlOutcomeInput();
  await writeFile(join(dir,'journal.json'),JSON.stringify(input.journal));
  await writeFile(join(dir,'bdl.json'),input.bdlBytes);await writeFile(join(dir,'nflverse.csv'),input.nflverseBytes);
  const manifest={schema:1,journalPath:'journal.json',bdlPath:'bdl.json',nflversePath:'nflverse.csv',
    gameId:input.gameId,expectedProviderGameId:input.expectedProviderGameId,
    bdlRetrievedAt:input.bdlRetrievedAt,nflverseRetrievedAt:input.nflverseRetrievedAt};
  const manifestPath=join(dir,'manifest.json');await writeFile(manifestPath,JSON.stringify(manifest));
  const guard=join(dir,'offline-clock.mjs');
  await writeFile(guard,`import http from 'node:http';import https from 'node:https';import net from 'node:net';import tls from 'node:tls';import {syncBuiltinESMExports} from 'node:module';
    const denied=()=>{throw Error('UNEXPECTED_NETWORK_REQUEST');};
    globalThis.fetch=denied;http.request=http.get=https.request=https.get=net.connect=net.createConnection=tls.connect=denied;syncBuiltinESMExports();
    Date.now=()=>Date.parse('${input.evaluatedAt}');`);
  const run=(args)=>spawnSync(process.execPath,['--max-old-space-size=256','--import',guard,script,...args],{cwd:dir,encoding:'utf8',timeout:15000,
    env:{PATH:process.env.PATH,HOME:dir,TZ:'UTC'}});
  const prepare=(output=join(dir,'bundle'))=>run(['--manifest',manifestPath,'--output',output]);
  return {dir,input,manifest,manifestPath,run,prepare};
}
test('Offline CLI creates private replayable bundle, preserves inputs, and makes zero network calls',async t=>{
  const x=await setup(t),before=await readFile(join(x.dir,'journal.json'));
  const out=x.prepare();assert.equal(out.status,0,out.stderr);assert.equal(out.stderr,'');
  const summary=JSON.parse(out.stdout);assert.equal(summary.providerRequests,0);assert.equal(summary.paidRequests,0);
  assert.equal(summary.scoringEligible,false);assert.equal(summary.qualifiedOutcomes,0);assert.equal(summary.evidenceRevisions,1);
  assert.equal(summary.activation,'DISABLED');assert.equal(summary.journalModified,false);
  assert.deepEqual(await readFile(join(x.dir,'journal.json')),before);
  assert.deepEqual((await readdir(join(x.dir,'bundle'))).sort(),['frozen-journal.json','ledger.json','report.json']);
  assert.equal((await stat(join(x.dir,'bundle'))).mode&0o777,0o700);
  for(const name of ['frozen-journal.json','ledger.json','report.json'])assert.equal((await stat(join(x.dir,'bundle',name))).mode&0o777,0o600);
  const verified=x.run(['--verify',join(x.dir,'bundle')]);assert.equal(verified.status,0,verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ledgerSha256,summary.ledgerSha256);
  assert.doesNotMatch(out.stdout,/bodyBase64|bodySha256|homeScore|9999001/);
});
test('Repeated preparation is idempotent with a supplied prior ledger and does not overwrite it',async t=>{
  const x=await setup(t);assert.equal(x.prepare().status,0);
  const priorPath=join(x.dir,'bundle/ledger.json'),prior=await readFile(priorPath);
  x.manifest.previousLedgerPath='bundle/ledger.json';await writeFile(x.manifestPath,JSON.stringify(x.manifest));
  const out=x.prepare(join(x.dir,'bundle-two'));assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).added,false);
  assert.deepEqual(await readFile(priorPath),prior);
  const verified=x.run(['--verify',join(x.dir,'bundle-two'),'--previous-ledger',priorPath]);assert.equal(verified.status,0,verified.stderr);
});
test('CLI refuses an existing output and never changes an existing bundle',async t=>{
  const x=await setup(t);assert.equal(x.prepare().status,0);const before=await readFile(join(x.dir,'bundle/ledger.json'));
  const out=x.prepare();assert.equal(out.status,1);assert.match(out.stderr,/EEXIST/);
  assert.deepEqual(await readFile(join(x.dir,'bundle/ledger.json')),before);
});
test('CLI refuses repository output, remote inputs, unexpected credentials and overridden clock',async t=>{
  const x=await setup(t),repoOut=resolve(root,'untracked-bdl-test-output');
  const denied=x.prepare(repoOut);assert.equal(denied.status,1);assert.match(denied.stderr,/OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/);
  for(const changed of [{bdlPath:'https://provider.invalid/private?key=DO_NOT_PRINT'},
    {apiKey:'DO_NOT_PRINT'},{recordedAt:x.input.evaluatedAt},{evaluatedAt:x.input.evaluatedAt}]){
    await writeFile(x.manifestPath,JSON.stringify({...x.manifest,...changed}));
    const out=x.prepare();assert.equal(out.status,1);assert.doesNotMatch(out.stderr+out.stdout,/DO_NOT_PRINT|provider.invalid/);
  }
  const invalid=x.run(['--manifest',x.manifestPath,'--output',join(x.dir,'bundle'),'--token','DO_NOT_PRINT']);
  assert.equal(invalid.status,1);assert.doesNotMatch(invalid.stderr,/DO_NOT_PRINT/);
});
test('CLI rejects symlink input and output parent, malformed UTF8, duplicate JSON keys and excessive size',async t=>{
  const x=await setup(t);await symlink(join(x.dir,'bdl.json'),join(x.dir,'alias.json'));
  await writeFile(x.manifestPath,JSON.stringify({...x.manifest,bdlPath:'alias.json'}));
  let out=x.prepare();assert.equal(out.status,1);assert.match(out.stderr,/SYMLINK_INPUT_NOT_ALLOWED/);
  await writeFile(x.manifestPath,JSON.stringify(x.manifest));
  await symlink(x.dir,join(x.dir,'parent-alias'));out=x.prepare(join(x.dir,'parent-alias/new'));
  assert.equal(out.status,1);assert.match(out.stderr,/SYMLINK_OUTPUT_PARENT_NOT_ALLOWED/);
  for(const raw of [Buffer.from([255]),Buffer.from('{"schema":1,"schema":1}'),Buffer.alloc(16385,32)]){
    await writeFile(x.manifestPath,raw);out=x.prepare();assert.equal(out.status,1);assert.equal(out.stdout,'');
  }
  assert.equal((await readdir(x.dir)).includes('bundle'),false);
});
test('CLI refuses stale source timestamps without creating output',async t=>{
  const x=await setup(t);await writeFile(x.manifestPath,JSON.stringify({...x.manifest,bdlRetrievedAt:'2026-11-09T16:00:00.000Z'}));
  const out=x.prepare();assert.equal(out.status,1);assert.equal(out.stdout,'');
  assert.equal((await readdir(x.dir)).includes('bundle'),false);
});
test('Replay detects altered archive, journal, report and duplicate encoded ledger keys',async t=>{
  for(const filename of ['ledger.json','frozen-journal.json','report.json']){
    const x=await setup(t);assert.equal(x.prepare().status,0);
    const path=join(x.dir,'bundle',filename),content=await readJson(path);
    content.EXTRA_UNTRUSTED_FIELD='DO_NOT_PRINT';await writeFile(path,JSON.stringify(content));
    const out=x.run(['--verify',join(x.dir,'bundle')]);assert.equal(out.status,1);assert.doesNotMatch(out.stderr,/DO_NOT_PRINT/);
  }
  const x=await setup(t);assert.equal(x.prepare().status,0);
  const path=join(x.dir,'bundle/ledger.json'),raw=await readFile(path,'utf8');
  await writeFile(path,raw.replace('{','{"schema":999,'));const out=x.run(['--verify',join(x.dir,'bundle')]);
  assert.equal(out.status,1);assert.match(out.stderr,/DUPLICATE_INPUT_JSON_KEY/);
});
test('CLI help is read-only and no argument creates no artifact',async t=>{
  const x=await setup(t),before=(await readdir(x.dir)).sort();
  assert.equal(x.run(['--help']).status,0);assert.equal(x.run([]).status,1);
  assert.deepEqual((await readdir(x.dir)).sort(),before);
});
test('Four-megabyte source limit archives valid original bytes within a bounded heap',async t=>{
  const x=await setup(t),original=Buffer.from(x.input.nflverseBytes).toString('utf8');
  const padding='A'.repeat(4000000-Buffer.byteLength(original));
  await writeFile(join(x.dir,'nflverse.csv'),original.replace(/\n$/,padding+'\n'));
  const out=x.prepare();assert.equal(out.status,0,out.stderr);assert.equal(out.signal,null);
  const verified=x.run(['--verify',join(x.dir,'bundle')]);assert.equal(verified.status,0,verified.stderr);
  assert.equal((await stat(join(x.dir,'nflverse.csv'))).size,4000000);
});
test('Oversized and malformed schedule files fail without heap exhaustion or partial output',async t=>{
  for(const size of [4000000,4000001,14000000]){
    const x=await setup(t);await writeFile(join(x.dir,'nflverse.csv'),Buffer.alloc(size));
    const out=x.prepare();assert.equal(out.status,1,out.stderr);assert.equal(out.signal,null);
    assert.equal(out.stdout,'');assert.match(out.stderr,/^BETQ_OFFLINE_RECEIPT_ERROR [A-Z_]+\n$/);
    assert.equal((await readdir(x.dir)).includes('bundle'),false);
  }
});
