/** Manual staging-only probe. Synthetic rows remain for audit; no provider access. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {verifiedPostgresOptions,handleIdlePoolErrors} from '../src/postgres-security.mjs';
import {createOddsSnapshotStore} from '../src/odds-snapshot-store.mjs';
import {createOddsSource} from '../src/odds.mjs';

const HOSTS=new Set([
  'ep-raspy-feather-bb7xepx3.c-15.us-east-1.aws.neon.tech',
  'ep-raspy-feather-bb7xepx3-pooler.c-15.us-east-1.aws.neon.tech'
]);
const checks=[];
let pool;
const deadline=setTimeout(()=>{ console.error('STAGING_VERIFY_FAILED:DEADLINE');process.exit(1); },660000);
function check(name){checks.push(name);console.log(`PASS ${name}`);}
function options(raw){
  assert.equal(typeof raw,'string');
  const url=new URL(raw);
  assert.ok(HOSTS.has(url.hostname));
  assert.equal(url.port||'5432','5432');
  assert.equal(decodeURIComponent(url.username),'betq_runtime');
  assert.equal(decodeURIComponent(url.pathname),'/betq');
  assert.equal(url.hash,'');
  const seen=new Set();
  for(const [key,value] of url.searchParams){
    assert.ok(!seen.has(key));seen.add(key);
    assert.ok((key==='sslmode'||key==='channel_binding')&&value==='require');
  }
  // The app explicitly enforces verified TLS, rather than URL overrides.
  url.search='';
  return verifiedPostgresOptions(url.toString());
}
function makePool(opts){return handleIdlePoolErrors(new pg.Pool({...opts,max:3,
  connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000,
  statement_timeout:5000,lock_timeout:3000}));}
async function tlsAndIdentity(p){
  const client=await p.connect();
  try{
    assert.equal(client.connection.stream.encrypted,true);
    assert.equal(client.connection.stream.authorized,true);
    const {rows:[r]}=await client.query(`SELECT current_database() AS db,current_user AS role,
      rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname=current_user`);
    assert.equal(r.db,'betq');assert.equal(r.role,'betq_runtime');
    for(const k of ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls'])assert.equal(r[k],false);
  }finally{client.release();}
}
async function privileges(p){
  const {rows:[schema]}=await p.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create");
  assert.equal(schema.can_create,false);
  const tables=['betq_odds_snapshots','provider_budget_accounts','provider_budget_reservations'];
  for(const name of tables){
    const {rows:[r]}=await p.query(`SELECT has_table_privilege(current_user,$1,'SELECT') AS read,
      has_table_privilege(current_user,$1,'DELETE') AS del,
      has_table_privilege(current_user,$1,'TRUNCATE') AS trunc,
      has_table_privilege(current_user,$1,'TRIGGER') AS trigger,
      has_table_privilege(current_user,$1,'INSERT') AS can_insert,
      pg_has_role(current_user,c.relowner,'USAGE') AS owner
      FROM pg_class c WHERE c.oid=$1::regclass`,[`public.${name}`]);
    assert.equal(r.read,true);assert.equal(r.del,false);assert.equal(r.trunc,false);
    assert.equal(r.trigger,false);assert.equal(r.owner,false);
    assert.equal(r.can_insert,name!=='provider_budget_accounts');
  }
  const permitted={
    betq_odds_snapshots:new Set(['received_at','snapshot']),
    provider_budget_accounts:new Set(['remaining_credits','updated_at']),
    provider_budget_reservations:new Set(['charged_credits','reconciled_at'])
  };
  for(const [name,allowed] of Object.entries(permitted)){
    const {rows}=await p.query(`SELECT a.attname AS name,
      has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS writable
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.oid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped`,[`public.${name}`]);
    assert.ok(rows.length>0);
    for(const r of rows)assert.equal(r.writable,allowed.has(r.name));
  }
}
async function main(){
  const opts=options(process.env.BETQ_NEON_STAGING_DATABASE_URL);
  delete process.env.BETQ_NEON_STAGING_DATABASE_URL;
  check('staging destination and URL policy');
  // Defense against accidental future provider usage. This probe never uses fetch.
  globalThis.fetch=async()=>{throw new Error('NETWORK_PROVIDER_FORBIDDEN');};
  pool=makePool(opts);
  await tlsAndIdentity(pool);check('TLS certificate and hostname authorized; restricted identity');
  await privileges(pool);check('read-only privilege matrix verifies exact runtime grants');
  const accountId=`synthetic-neon-ci-${randomUUID()}`;
  const cacheId='odds:americanfootball_nfl:h2h';
  const now=Date.now();
  const payload=(offset,label='SYNTHETIC Home')=>({receivedAt:new Date(now+offset).toISOString(),events:[{
    id:'SYNTHETIC-NOT-A-REAL-GAME',sport_key:'americanfootball_nfl',
    commence_time:new Date(now+86400000).toISOString(),home_team:label,away_team:'SYNTHETIC Away',
    bookmakers:[]
  }]});
  const store=createOddsSnapshotStore({pool,accountId});
  assert.equal(await store.read(cacheId),null);
  assert.deepEqual(await store.write(cacheId,payload(-2000)),{stored:true});
  const first=await store.read(cacheId);
  assert.equal(first.receivedAt,payload(-2000).receivedAt);
  assert.deepEqual(await store.write(cacheId,payload(-2000,'SYNTHETIC Equal Conflict')),{stored:false});
  assert.deepEqual(await store.write(cacheId,payload(-3000,'SYNTHETIC Older Conflict')),{stored:false});
  assert.deepEqual(await store.read(cacheId),first);
  assert.deepEqual(await store.write(cacheId,payload(-1000)),{stored:true});
  const expected=await store.read(cacheId);
  check('snapshot round trip; equal and older writes cannot replace newer receipt');
  const isolated=createOddsSnapshotStore({pool,accountId:`${accountId}-other`});
  assert.equal(await isolated.read(cacheId),null);check('account-scoped adapter isolation');
  const source=createOddsSource({apiKey:'SYNTHETIC-NOT-A-SECRET',snapshotStore:store,
    budgetStore:{reserve(){throw Error('BUDGET_FORBIDDEN');},status(){throw Error('BUDGET_FORBIDDEN');}},
    fetchImpl(){throw Error('PROVIDER_FORBIDDEN');}});
  const restored=await source.getOdds('americanfootball_nfl','h2h');
  assert.equal(restored.receivedAt,expected.receivedAt);
  assert.equal(restored.restoredFromPrivateSnapshot,true);
  assert.deepEqual(restored.quota,{remaining:null,used:null,last:null});
  check('app cache-only restore retains timestamp and unknown quota without provider access');
  const stale=createOddsSource({apiKey:'SYNTHETIC-NOT-A-SECRET',snapshotStore:store,
    clock:()=>now+301000,fetchImpl(){throw Error('PROVIDER_FORBIDDEN');}});
  await assert.rejects(stale.getOdds('americanfootball_nfl','h2h'),e=>e.code==='PAID_REFRESH_REQUIRED');
  check('stale retained quotes rejected without refresh');
  await pool.end();pool=null;
  const idle=process.env.BETQ_NEON_IDLE_PROBE==='true';
  if(idle){console.log('Waiting 330 seconds without database clients; suspension itself is not observed.');await new Promise(r=>setTimeout(r,330000));}
  pool=makePool(opts);await tlsAndIdentity(pool);
  const reopened=createOddsSnapshotStore({pool,accountId});
  assert.deepEqual(await reopened.read(cacheId),expected);
  check(idle?'fresh verified-TLS client reconnect after 330 seconds; retained bytes unchanged':'fresh verified-TLS client reconnect; retained bytes unchanged');
  console.log(JSON.stringify({status:'passed',checks:checks.length,providerRequests:0,
    idleWaitSeconds:idle?330:0,autosuspendObserved:false,productionModified:false,
    syntheticRowsRetained:1}));
}
try{await main();}catch(error){
  const allowed=new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ETIMEDOUT','ECONNRESET',
    'ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT','ERR_ASSERTION','42501','42P01','28P01',
    'POSTGRES_TLS_CONFIGURATION_INVALID','ODDS_SNAPSHOT_INVALID']);
  console.error(`STAGING_VERIFY_FAILED:${allowed.has(error?.code)?error.code:'VALIDATION_OR_CONNECTION_FAILED'}`);
  process.exitCode=1;
}finally{if(pool)await pool.end().catch(()=>{});clearTimeout(deadline);}
