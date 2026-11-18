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
const {createOwnerRefreshHandler}=await import('../src/owner-refresh.mjs');
const {createOddsSource}=await import('../src/odds.mjs');
const {Readable}=await import('node:stream');
const {createOwnerSessionStores}=await import('../src/owner-session-store.mjs');
const {createHash,randomBytes}=await import('node:crypto');
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
    await client.query(await readFile(new URL('../sql/owner-session.sql',import.meta.url),'utf8'));
  }finally{client.release();}
  await admin.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE betq_owner_trial_ci TO ${role};
    GRANT USAGE ON SCHEMA ${schema} TO ${role};
    GRANT SELECT ON ${schema}.owner_refresh_trial_policies TO ${role};
    GRANT SELECT,INSERT ON ${schema}.owner_refresh_trial_operations TO ${role};
    GRANT UPDATE(charged_credits,state,completed_at) ON ${schema}.owner_refresh_trial_operations TO ${role};
    GRANT SELECT,INSERT ON ${schema}.owner_auth_sessions,${schema}.owner_auth_rate TO ${role};
    GRANT UPDATE(session_hash,csrf_token,created_at_ms,last_seen_ms,expires_at_ms,high_water_ms,revoked) ON ${schema}.owner_auth_sessions TO ${role};
    GRANT UPDATE(window_start_ms,high_water_ms,used) ON ${schema}.owner_auth_rate TO ${role}`);
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
  await check('real trial ledger deduplicates distinct IDs across independent source caches (mock provider/budget/snapshot)',async()=>{
    const id=account();await seed(id,12,12);
    const snapshots=new Map(),keys=new Set();let fetches=0,reserves=0;
    const syntheticEvents=['synthetic-game-a','synthetic-game-b'].map((eventId,i)=>({
      id:eventId,sport_key:'americanfootball_nfl',commence_time:new Date(Date.now()+3600000).toISOString(),
      home_team:'Synthetic Home '+i,away_team:'Synthetic Away '+i,bookmakers:[]
    }));
    let releaseFetch,markStarted;
    const started=new Promise(resolve=>markStarted=resolve);
    const held=new Promise(resolve=>releaseFetch=resolve);
    let releaseWrite,markWriteStarted,reconciled=false;
    const writeStarted=new Promise(resolve=>markWriteStarted=resolve);
    const heldWrite=new Promise(resolve=>releaseWrite=resolve);
    const snapshotStore={async read(key){keys.add(key);return structuredClone(snapshots.get(key)??null);},
      async write(key,payload){keys.add(key);assert.equal(reconciled,true);markWriteStarted();await heldWrite;snapshots.set(key,structuredClone(payload));return {stored:true};}};
    // These are deliberately synthetic budget receipts, NOT real provider accounting proof.
    const budgetStore={async status(){return {persistent:true,available:true,ready:true,baselineCurrent:true,unresolvedReservations:0};},
      async reserve({estimatedCredits}){assert.equal(estimatedCredits,1);reserves++;return {id:randomUUID()};},
      async reconcile(){reconciled=true;return {reconciled:true};}};
    const fetchImpl=async url=>{
      fetches++;const u=new URL(url);assert.equal(u.pathname,'/v4/sports/americanfootball_nfl/odds');
      assert.equal(u.searchParams.get('regions'),'us');assert.equal(u.searchParams.get('markets'),'h2h');
      assert.equal(u.searchParams.has('eventIds'),false);markStarted();await held;
      return new Response(JSON.stringify(syntheticEvents),{headers:{'x-requests-remaining':'99','x-requests-used':'1','x-requests-last':'1'}});
    };
    const sources=Array.from({length:2},()=>createOddsSource({apiKey:'synthetic-never-sent',fetchImpl,budgetStore,snapshotStore}));
    const origin='https://synthetic.example',csrfToken='x'.repeat(43);
    const handlers=sources.map(source=>createOwnerRefreshHandler({enabled:true,origin,ownerId:'synthetic-owner',
      resolveSession:async()=>({verified:true,userId:'synthetic-owner',csrfToken}),store:makeStore(id),source}));
    const request=()=>{const r=Readable.from([JSON.stringify({market:'h2h',idempotencyKey:randomUUID(),csrfToken})]);
      r.method='POST';r.url='/api/owner/refresh';r.headers={origin,'sec-fetch-site':'same-origin','content-type':'application/json'};return r;};
    const runs=handlers.map(h=>h(request()));
    try{
      await started;
      // One distinct operation remains unresolved while the other is denied by real PG.
      const denied=await Promise.race(runs);assert.equal(denied.status,409);
      assert.equal(fetches,1);assert.equal(reserves,1);
    }finally{releaseFetch();}
    try{
      await writeStarted;
      // Provider-budget reconciliation alone must not release the owner trial.
      // The shared snapshot is not yet visible: this is the exact cross-cache gap.
      assert.equal(reconciled,true);assert.equal(snapshots.size,0);
      const third=await handlers[1](request());
      assert.equal(third.status,409);assert.equal(fetches,1);assert.equal(reserves,1);
    }finally{releaseWrite();}
    const results=await Promise.all(runs);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const loser=results.findIndex(r=>r.status===409);
    const restored=await handlers[loser](request());
    assert.equal(restored.status,200);assert.equal(restored.body.cacheHit,true);
    assert.equal(restored.body.actualChargedCredits,0);assert.equal(fetches,1);assert.equal(reserves,1);
    // Game selection consumes the same retained league/market slate, not per-game fetches.
    for(const eventId of syntheticEvents.map(e=>e.id)){
      const slate=await sources[loser].getOdds('americanfootball_nfl','h2h');
      assert.equal(slate.events.filter(e=>e.id===eventId).length,1);assert.equal(slate.cacheHit,true);
    }
    assert.deepEqual([...keys],['odds:americanfootball_nfl:h2h']);assert.equal(fetches,1);
    assert.equal((await makeStore(id).status()).lifetimeUsed,2); // cached operation retains its trial reservation.
  });
  const stores=ownerId=>createOwnerSessionStores({enabled:true,pool:runtime,ownerId});
  const session=userId=>{const now=Date.now();return {userId,sessionHash:randomBytes(32).toString('hex'),csrfToken:randomBytes(32).toString('base64url'),createdAt:now,lastSeenAt:now,expiresAt:now+900000,revoked:false};};
  await check('real sessions rotate atomically; stale logout cannot revoke replacement',async()=>{
    const owner=account(),a=session(owner),b=session(owner);
    await Promise.all([stores(owner).sessionStore.replaceOwner(a),stores(owner).sessionStore.replaceOwner(b)]);
    const row=(await admin.query(`SELECT * FROM ${schema}.owner_auth_sessions WHERE owner_id=$1`,[owner])).rows[0];
    const winning=row.session_hash===a.sessionHash?a:b,old=winning===a?b:a;
    assert.equal((await stores(owner).sessionStore.revoke({sessionHash:old.sessionHash,userId:owner})).revoked,false);
    const before=Number(row.last_seen_ms);
    const seen=await stores(owner).sessionStore.readAndTouch({sessionHash:winning.sessionHash,now:Date.now(),idleMs:300000});
    assert.equal(seen.lastSeenAt,before);
    await stores(owner).sessionStore.revoke({sessionHash:winning.sessionHash,userId:owner});
    await runtime.end();runtime=connect();
    assert.equal(await stores(owner).sessionStore.readAndTouch({sessionHash:winning.sessionHash,now:Date.now(),idleMs:300000}),null);
  });
  await check('database time rejects expired idle sessions, rollback and pre-touch revival',async()=>{
    const owner=account(),r=session(owner);await stores(owner).sessionStore.replaceOwner(r);
    await admin.query(`UPDATE ${schema}.owner_auth_sessions SET created_at_ms=created_at_ms-400000,last_seen_ms=last_seen_ms-400000,expires_at_ms=expires_at_ms-400000 WHERE owner_id=$1`,[owner]);
    assert.equal(await stores(owner).sessionStore.readAndTouch({sessionHash:r.sessionHash,now:r.createdAt, idleMs:300000}),null);
    const stored=(await admin.query(`SELECT last_seen_ms,revoked,high_water_ms FROM ${schema}.owner_auth_sessions WHERE owner_id=$1`,[owner])).rows[0];
    assert.equal(Number(stored.last_seen_ms),r.lastSeenAt-400000);
    assert.equal(stored.revoked,true);assert.ok(Number(stored.high_water_ms)>=r.createdAt);
    await runtime.end();runtime=connect();
    assert.equal(await stores(owner).sessionStore.readAndTouch({sessionHash:r.sessionHash,now:r.createdAt-200000,idleMs:300000}),null);
    const owner2=account(),fresh=session(owner2);await stores(owner2).sessionStore.replaceOwner(fresh);
    assert.equal(await stores(owner2).sessionStore.readAndTouch({sessionHash:fresh.sessionHash,now:fresh.createdAt-1,idleMs:300000}),null);
    await admin.query(`UPDATE ${schema}.owner_auth_sessions SET created_at_ms=created_at_ms-1000000,last_seen_ms=last_seen_ms-1000000,expires_at_ms=expires_at_ms-1000000 WHERE owner_id=$1`,[owner2]);
    assert.equal(await stores(owner2).sessionStore.readAndTouch({sessionHash:fresh.sessionHash,now:fresh.createdAt-1000000,idleMs:300000}),null);
  });
  await check('shared rate cap serializes, expires bounded rows, survives rotation and restart',async()=>{
    const owner=account(),request={scope:'owner-access',key:createHash('sha256').update(owner).digest('hex'),limit:6,windowMs:60000};
    const results=await Promise.all(Array.from({length:20},()=>stores(owner).rateStore.consume(request)));
    assert.equal(results.filter(r=>r.allowed).length,6);
    await stores(owner).sessionStore.replaceOwner(session(owner));await runtime.end();runtime=connect();
    assert.equal((await stores(owner).rateStore.consume(request)).allowed,false);
    await admin.query(`UPDATE ${schema}.owner_auth_rate SET window_start_ms=window_start_ms-60000 WHERE owner_id=$1`,[owner]);
    assert.equal((await stores(owner).rateStore.consume(request)).allowed,true);
    const rows=await admin.query(`SELECT count(*)::int AS count FROM ${schema}.owner_auth_rate WHERE owner_id=$1`,[owner]);assert.equal(rows.rows[0].count,1);
    for(let i=0;i<20;i++)assert.throws(()=>stores(owner).rateStore.consume({...request,key:randomUUID()}));
    await admin.query(`UPDATE ${schema}.owner_auth_rate SET high_water_ms=high_water_ms+60000 WHERE owner_id=$1`,[owner]);
    await assert.rejects(stores(owner).rateStore.consume(request),{code:'OWNER_SESSION_STORAGE_UNAVAILABLE'});
    for(const query of ['DELETE FROM owner_auth_sessions','DELETE FROM owner_auth_rate','UPDATE owner_auth_sessions SET owner_id=owner_id','ALTER TABLE owner_auth_rate ADD COLUMN forbidden integer'])await assert.rejects(runtime.query(query),{code:'42501'});
  });
  console.log(`PostgreSQL 17 integration: ${passed} checks passed; synthetic local data only; no TLS or provider claim.`);
}catch{console.error('PostgreSQL integration failed (details suppressed).');process.exitCode=1;}
finally{await runtime?.end();await admin.end();}
// Disposable service teardown removes all synthetic data; runtime never gets DELETE.
