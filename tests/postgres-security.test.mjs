import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {verifiedPostgresOptions,handleIdlePoolErrors,guardPostgresClient} from '../src/postgres-security.mjs';
import {configuredProviderBudget} from '../src/configured-provider-budget.mjs';
import {createProviderBudget} from '../src/provider-budget.mjs';
import {configuredShadowStore} from '../src/shadow-store.mjs';
const plain='postgresql://offline_user:offline_password@localhost:15432/betq_fixture';
const overrides=['sslmode=disable','sslmode=no-verify','ssl=0','ssl=no-verify',
  'sslmode=require&uselibpqcompat=true','sslmode=verify-ca','sslmode=verify-full',
  'sslrootcert=%2Fnever-read-this','sslkey=%2Fnever-read-this','sslnegotiation=direct',
  '%73slmode=disable','SSLMODE=disable','sslmode=verify-full&sslmode=disable',
  'host=%2Ftmp','application_name=fixture'];

test('URL options cannot override verified TLS or trigger driver file/host options',()=>{
  for(const query of overrides){
    assert.throws(()=>verifiedPostgresOptions(plain+'?'+query),error=>{
      assert.equal(error.code,'POSTGRES_TLS_CONFIGURATION_INVALID');
      assert.doesNotMatch(error.message,/offline_password|never-read-this/);return true;
    });
  }
});

test('Explicit parsed fields preserve credentials while preventing URI reparse by pg',()=>{
  const config=verifiedPostgresOptions('postgresql://fixture%40user:pass%3Fword@localhost:15432/betq_fixture');
  assert.equal(config.user,'fixture@user');assert.equal(config.password,'pass?word');
  assert.equal(config.host,'localhost');assert.equal(config.port,15432);assert.equal(config.database,'betq_fixture');
  assert.equal(Object.hasOwn(config,'connectionString'),false);
  const client=new pg.Client(config); // Inspect driver resolution only; never connect.
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized,true);
  assert.equal(client.connectionParameters.sslnegotiation,'postgres');
  assert.equal(client.connectionParameters.isDomainSocket,false);
  assert.equal(verifiedPostgresOptions('postgresql://fixture@localhost/betq_fixture').port,5432);
  assert.equal(verifiedPostgresOptions('postgresql://fixture@[::1]:15432/betq_fixture').host,'::1');
});

test('Environment SSL downgrades cannot replace explicit verified TLS',t=>{
  const names=['PGSSLMODE','PGSSLNEGOTIATION'],previous=names.map(x=>process.env[x]);
  t.after(()=>names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];}));
  process.env.PGSSLMODE='no-verify';process.env.PGSSLNEGOTIATION='direct';
  const config=new pg.Client(verifiedPostgresOptions(plain)).connectionParameters;
  assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.sslnegotiation,'postgres');
});

test('Malformed, fragment and Unix-socket URLs fail closed without leaking their contents',()=>{
  for(const url of [null,'not a URL',plain+'#sslmode=disable','postgresql://%2Ftmp/betq_fixture',
    'socket:/tmp?db=betq_fixture','postgresql:///betq_fixture','postgresql://localhost/',
    'postgresql://fixture:private%0Avalue@localhost/betq_fixture','postgresql://fixture:%GG@localhost/betq_fixture']){
    assert.throws(()=>verifiedPostgresOptions(url),error=>{
      assert.equal(error.code,'POSTGRES_TLS_CONFIGURATION_INVALID');assert.doesNotMatch(error.message,/private|%GG/);return true;
    });
  }
});

test('Budget rejects TLS URL overrides before loading a driver or opening a connection',async()=>{
  let factories=0;
  for(const query of overrides){
    const budget=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:'fixture',BETQ_BUDGET_DATABASE_URL:plain+'?'+query},
      clientFactory:async()=>{factories++;throw Error('Must not load');}});
    await assert.rejects(budget.reserve({estimatedCredits:1}),{code:'BUDGET_DATABASE_CONFIGURATION_INVALID',status:503});
    assert.equal((await budget.status()).ready,false);
  }
  assert.equal(factories,0);
});

test('Configured budget installs an idle-error handler and preserves strict pool options',async()=>{
  let options,instance;
  class Pool extends EventEmitter {
    constructor(config){super();options=config;instance=this;}
    async connect(){throw Error('offline storage');}
  }
  const budget=configuredProviderBudget({env:{BETQ_BUDGET_ACCOUNT_ID:'fixture',BETQ_BUDGET_DATABASE_URL:plain},clientFactory:async()=>({Pool})});
  assert.equal((await budget.status()).ready,false);
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.connectionString,undefined);
  assert.equal(instance.listenerCount('error'),1);
  assert.doesNotThrow(()=>instance.emit('error',Error('offline idle failure')));
  assert.equal((await budget.status()).ready,false,'An error listener cannot authorize credit spend');
  handleIdlePoolErrors(instance);assert.equal(instance.listenerCount('error'),1,'Do not accumulate duplicate listeners');
});

test('Private runtime and CLI reject TLS URL downgrades before database use',async()=>{
  let factories=0;
  const store=configuredShadowStore({env:{BETQ_SHADOW_DATABASE_URL:plain+'?sslmode=disable',
    BETQ_SHADOW_CAPTURE_ENABLED:'true',BETQ_SHADOW_LICENSE_REVIEWED:'true'},
    clientFactory:async()=>{factories++;throw Error('Must not load');}});
  assert.equal((await store.status()).available,false);assert.equal(factories,0);
  const script=new URL('../scripts/shadow-private-cli.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[script.pathname,'status'],{encoding:'utf8',
    env:{...process.env,ODDS_API_KEY:'',BETQ_SHADOW_DATABASE_URL:plain+'?sslmode=disable',BETQ_SHADOW_LICENSE_REVIEWED:'true'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/verified TLS/);
  assert.doesNotMatch(result.stderr,/offline_password/);
});

test('Every application Pool constructor uses shared TLS and idle-error protection',async()=>{
  for(const path of ['../src/configured-provider-budget.mjs','../src/shadow-store.mjs','../scripts/shadow-private-cli.mjs']){
    const source=await readFile(new URL(path,import.meta.url),'utf8');
    assert.match(source,/verifiedPostgresOptions/);assert.match(source,/handleIdlePoolErrors/);
    assert.doesNotMatch(source,/new (?:driver\.)?Pool\(\{\s*connectionString:/);
  }
});


test('Untested native driver selection fails closed before pool construction',t=>{
  const previous=process.env.NODE_PG_FORCE_NATIVE;
  t.after(()=>{if(previous===undefined)delete process.env.NODE_PG_FORCE_NATIVE;else process.env.NODE_PG_FORCE_NATIVE=previous;});
  for(const value of ['1','true','false']){
    process.env.NODE_PG_FORCE_NATIVE=value;
    assert.throws(()=>verifiedPostgresOptions(plain),{code:'POSTGRES_TLS_CONFIGURATION_INVALID'});
  }
});

test('Checked-out client errors are handled, rejected and discarded with late-error coverage',async()=>{
  const client=new EventEmitter();let discard,rollbacks=0;
  client.release=flag=>{discard=flag;};client.query=async()=>{rollbacks++;};
  const guard=guardPostgresClient(client);
  assert.doesNotThrow(()=>client.emit('error',Error('offline transport failure')));
  assert.throws(()=>guard.assertHealthy(),/connection failed/);
  await guard.rollback();assert.equal(rollbacks,0,'Do not query a known broken connection');
  guard.release();assert.equal(discard,true);
  assert.doesNotThrow(()=>client.emit('error',Error('late offline failure')));
  guard.release();assert.equal(client.listenerCount('error'),1);
});

test('Healthy clients rollback and release normally without accumulating active listeners',async()=>{
  const client=new EventEmitter();let discard,rollbacks=0;
  client.release=flag=>{discard=flag;};client.query=async sql=>{assert.equal(sql,'ROLLBACK');rollbacks++;};
  const guard=guardPostgresClient(client);guard.assertHealthy();await guard.rollback();guard.release();
  assert.equal(discard,false);assert.equal(rollbacks,1);assert.equal(client.listenerCount('error'),0);
});

test('Uncertain budget COMMIT fails closed, discards active client and retains charge',async()=>{
  let used=0,remaining=100,discard,client;
  const pool={connect:async()=>{
    client=new EventEmitter();client.release=flag=>{discard=flag;};
    client.query=async(sql,args=[])=>{
      if(sql.startsWith('SELECT remaining_credits'))return {rows:[{remaining_credits:remaining,daily_credit_limit:12,minimum_reserve:50}]};
      if(sql.startsWith('SELECT to_char'))return {rows:[{utc_day:'2026-11-07'}]};
      if(sql.startsWith('SELECT COALESCE'))return {rows:[{used:String(used),unresolved:used?'1':'0'}]};
      if(sql.includes('INSERT INTO provider_budget_reservations'))used+=args[3];
      if(sql.includes('UPDATE provider_budget_accounts'))remaining-=args[1];
      if(sql==='COMMIT'){client.emit('error',Error('offline-secret:lost-COMMIT'));throw Error('offline-secret:terminated');}
      return {rows:[],rowCount:1};
    };return client;
  }};
  const budget=createProviderBudget({pool,accountId:'fixture',dailyCreditCap:12,reserveCredits:50});
  await assert.rejects(budget.reserve({estimatedCredits:3}),error=>{
    assert.equal(error.code,'BUDGET_STORAGE_UNAVAILABLE');assert.doesNotMatch(error.message,/offline-secret/);return true;
  });
  assert.equal(discard,true);assert.equal(used,3);assert.equal(remaining,97);
  assert.doesNotThrow(()=>client.emit('error',Error('offline late error')));
  await assert.rejects(budget.reserve({estimatedCredits:1}),{code:'BUDGET_OUTCOME_UNKNOWN'});
});
