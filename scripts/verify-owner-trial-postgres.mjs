/** Disposable localhost PostgreSQL integration only. Never accepts database URLs. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isolatedTestEnvironment} from './test-environment.mjs';
if(process.argv[2]!=='--isolated-child') {
  const env=isolatedTestEnvironment(process.env,new URL('./test-network-guard.mjs',import.meta.url).href);
  const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--isolated-child'],{env,stdio:'inherit',timeout:120000});
  process.exit(run.status??1);
}
// Even direct child invocation discards pg/provider environment before importing pg.
for(const key of Object.keys(process.env))if(!['PATH','TZ','LANG','NODE_ENV','NODE_OPTIONS'].includes(key))delete process.env[key];
const {default:pg}=await import('pg');
const {default:assert}=await import('node:assert/strict');
const {randomUUID}=await import('node:crypto');
const {readFile}=await import('node:fs/promises');
const {createOwnerTrialStore}=await import('../src/owner-trial-store.mjs');
const suffix=randomUUID().replaceAll('-','');
const schema=`trial_${suffix}`,role=`runtime_${suffix}`;
// Explicit options bypass libpq environment. No external server or supplied credential.
const base={host:'127.0.0.1',port:5432,database:'betq_owner_trial_ci',ssl:false,
  connectionTimeoutMillis:3000,statement_timeout:5000,idleTimeoutMillis:1000,max:12};
const admin=new pg.Pool({...base,user:'postgres',password:'disposable-ci-only'});
let runtime;let passed=0;
const operation=(market='h2h')=>({operationId:randomUUID(),market});
const account=()=>`synthetic-${randomUUID()}`;
const makeStore=id=>createOwnerTrialStore({enabled:true,pool:runtime,accountId:id});
async function seed(id,limit=3,daily=3,expired=false){
  await admin.query(`INSERT INTO ${schema}.owner_refresh_trial_policies
    (account_id,trial_id,enabled,starts_at,expires_at,lifetime_credit_limit,daily_credit_limit)
    VALUES($1,$2,true,clock_timestamp()-interval '1 day',clock_timestamp()+$3::interval,$4,$5)`,
    [id,randomUUID(),expired?'-1 hour':'5 days',limit,daily]);
}
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
try{
  const version=await admin.query('SHOW server_version_num');
  assert.equal(Math.floor(Number(version.rows[0].server_version_num)/10000),17);
  await admin.query(`CREATE SCHEMA ${schema}; CREATE ROLE ${role} LOGIN PASSWORD 'disposable-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  const client=await admin.connect();
  try{await client.query(`SET search_path TO ${schema}`);
    await client.query(await readFile(new URL('../sql/owner-refresh-trial.sql',import.meta.url),'utf8'));
  }finally{client.release();}
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE betq_owner_trial_ci TO ${role};
    GRANT USAGE ON SCHEMA ${schema} TO ${role};
    GRANT SELECT ON ${schema}.owner_refresh_trial_policies TO ${role};
    GRANT SELECT,INSERT ON ${schema}.owner_refresh_trial_operations TO ${role};
    GRANT UPDATE(charged_credits,state,completed_at) ON ${schema}.owner_refresh_trial_operations TO ${role}`);
  const connect=()=>new pg.Pool({...base,user:role,password:'disposable-runtime-only',options:`-c search_path=${schema}`});
  runtime=connect();
  await check('advisory lock serializes independent connections and duplicate claims',async()=>{
    const id=account();await seed(id);const op=operation();
    const results=await Promise.allSettled(Array.from({length:12},()=>makeStore(id).claim(op)));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='OWNER_TRIAL_DUPLICATE'));
    await assert.rejects(makeStore(id).claim({...op,market:'totals'}),{code:'OWNER_TRIAL_OPERATION_MISMATCH'});
    await makeStore(id).complete({...op,chargedCredits:1});
  });
  await check('lifetime ceiling survives pool shutdown and transaction restarts',async()=>{
    const id=account();await seed(id,2,2);
    for(let i=0;i<2;i++){const op=operation();await makeStore(id).claim(op);await makeStore(id).complete({...op,chargedCredits:0});
      await runtime.end();runtime=connect();}
    const results=await Promise.allSettled(Array.from({length:8},()=>makeStore(id).claim(operation())));
    assert.ok(results.every(x=>x.status==='rejected'&&x.reason.code==='OWNER_TRIAL_LIMIT'));
    assert.equal((await makeStore(id).status()).lifetimeUsed,2);
  });
  await check('daily ceiling rejects raced claims independently of lifetime allowance',async()=>{
    const id=account();await seed(id,12,1);const op=operation();await makeStore(id).claim(op);
    await makeStore(id).complete({...op,chargedCredits:1});
    const outcomes=await Promise.allSettled(Array.from({length:8},()=>makeStore(id).claim(operation())));
    assert.ok(outcomes.every(x=>x.status==='rejected'&&x.reason.code==='OWNER_TRIAL_LIMIT'));
    const state=await makeStore(id).status();assert.equal(state.dailyUsed,1);assert.equal(state.lifetimeLimit,12);
  });
  await check('anomalous actual charge atomically blocks concurrent next admission',async()=>{
    const id=account();await seed(id,12,12);const op=operation();await makeStore(id).claim(op);
    const results=await Promise.allSettled([makeStore(id).complete({...op,chargedCredits:2}),makeStore(id).claim(operation('totals'))]);
    assert.equal(results[0].value.unknown,true);assert.equal(results[1].status,'rejected');
    assert.equal(results[1].reason.code,'OWNER_TRIAL_UNRESOLVED');
    await runtime.end();runtime=connect();
    assert.equal((await makeStore(id).status()).lifetimeUsed,2);
    await assert.rejects(makeStore(id).complete({...op,chargedCredits:1}),{code:'OWNER_TRIAL_UNRESOLVED'});
  });
  await check('unknown outcome persists across new connections and expiry is enforced',async()=>{
    const id=account();await seed(id);const op=operation();await makeStore(id).claim(op);await makeStore(id).failUnknown(op);
    await runtime.end();runtime=connect();await assert.rejects(makeStore(id).claim(operation()),{code:'OWNER_TRIAL_UNRESOLVED'});
    const expired=account();await seed(expired,3,3,true);await assert.rejects(makeStore(expired).claim(operation()),{code:'OWNER_TRIAL_EXPIRED'});
  });
  await check('runtime denies policy mutation, deletion, and schema DDL',async()=>{
    for(const sql of [
      'UPDATE owner_refresh_trial_policies SET enabled=true',
      'DELETE FROM owner_refresh_trial_operations',
      'TRUNCATE owner_refresh_trial_operations',
      'CREATE TABLE forbidden(id integer)',
      'CREATE TABLE public.forbidden(id integer)',
      'ALTER TABLE owner_refresh_trial_operations ADD COLUMN forbidden integer',
      'UPDATE owner_refresh_trial_operations SET market=market'
    ])await assert.rejects(runtime.query(sql),{code:'42501'});
    const flags=await runtime.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    assert.ok(Object.values(flags.rows[0]).every(x=>x===false));
  });
  console.log(`PostgreSQL 17 integration: ${passed} checks passed; synthetic local data only; no TLS or provider claim.`);
}catch{console.error('PostgreSQL integration failed (details suppressed).');process.exitCode=1;}
finally{await runtime?.end();await admin.end();}
// Disposable service teardown removes all synthetic data; runtime never gets DELETE.
