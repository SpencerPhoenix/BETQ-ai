import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isolatedTestEnvironment} from '../scripts/test-environment.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('Test worker environment is an allowlist, not a growing secret blacklist',()=>{
  const parent={PATH:'/bin',BETQ_ODDS_SNAPSHOTS_ENABLED:'true',BETQ_ODDS_SNAPSHOT_DATABASE_URL:'poison',
    ODDS_API_KEY:'poison',DATABASE_URL:'poison',PGPASSWORD:'poison',NODE_OPTIONS:'poison',
    FUTURE_PROVIDER_PASSWORD:'poison',HOME:'/private'};
  const safe=isolatedTestEnvironment(parent,'file:///guard.mjs');
  assert.deepEqual(Object.keys(safe).sort(),['LANG','NODE_ENV','NODE_OPTIONS','PATH','TZ']);
  assert.equal(safe.NODE_OPTIONS,'--import=file:///guard.mjs');assert.equal(parent.ODDS_API_KEY,'poison');
});
test('Poisoned deployment environment cannot reach test imports or child workers; remote TCP is blocked',()=>{
  const dir=mkdtempSync(join(tmpdir(),'betq-isolation-'));
  try{
    const fixture=join(dir,'canary.test.mjs');
    const moduleUrl=pathToFileURL(join(root,'src/configured-odds-snapshots.mjs')).href;
    writeFileSync(fixture,`import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {configuredOddsSnapshotStore} from ${JSON.stringify(moduleUrl)};
test('no deployed secrets at module import or subprocess',()=>{
  for(const key of ['BETQ_ODDS_SNAPSHOTS_ENABLED','BETQ_ODDS_SNAPSHOT_DATABASE_URL','BETQ_BUDGET_DATABASE_URL','BETQ_BUDGET_ACCOUNT_ID','BETQ_OPERATOR_REFRESH_TOKEN','ODDS_API_KEY','BALLDONTLIE_API_KEY','DATABASE_URL','PGPASSWORD','PGHOST','FUTURE_PROVIDER_PASSWORD'])assert.equal(process.env[key],undefined);
  let loaded=0;assert.equal(configuredOddsSnapshotStore({clientFactory(){loaded++;throw Error('loaded');}}),null);assert.equal(loaded,0);
  assert.throws(()=>net.connect(5432,'ep-production.invalid'),{code:'TEST_NETWORK_FORBIDDEN'});
  const child=spawnSync(process.execPath,['-e',"const net=require('node:net');if(process.env.ODDS_API_KEY)process.exit(2);try{net.connect(443,'provider.invalid');process.exit(3)}catch(e){if(e.code!=='TEST_NETWORK_FORBIDDEN')process.exit(4)}"],{encoding:'utf8'});
  assert.equal(child.status,0);
});`);
    const poison={...process.env,BETQ_ODDS_SNAPSHOTS_ENABLED:'true',BETQ_ODDS_SNAPSHOT_DATABASE_URL:'postgresql://poison@ep-production.invalid/betq',
      BETQ_BUDGET_DATABASE_URL:'postgresql://poison@ep-production.invalid/betq',BETQ_BUDGET_ACCOUNT_ID:'production-account',
      BETQ_OPERATOR_REFRESH_TOKEN:'poison',ODDS_API_KEY:'poison',BALLDONTLIE_API_KEY:'poison',DATABASE_URL:'poison',
      PGHOST:'ep-production.invalid',PGPASSWORD:'poison',FUTURE_PROVIDER_PASSWORD:'poison',NODE_OPTIONS:'--no-warnings'};
    const result=spawnSync(process.execPath,['scripts/run-tests.mjs',fixture],{cwd:root,env:poison,encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/pass 1/);assert.doesNotMatch(result.stdout+result.stderr,/postgresql|production-account/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Supported test entry points cannot bypass the isolated launcher',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts.test,'node scripts/run-tests.mjs');
  for(const name of await readdir(join(root,'.github/workflows'))){
    if(!/\.ya?ml$/.test(name))continue;
    const text=await readFile(join(root,'.github/workflows',name),'utf8');
    assert.doesNotMatch(text,/\bnode\s+--test\b/,name);
  }
});
