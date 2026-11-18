import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredOddsSnapshotStore} from '../src/configured-odds-snapshots.mjs';
import {createOddsSource} from '../src/odds.mjs';
const now=Date.parse('2026-11-18T01:00:00Z');
const cacheId='odds:americanfootball_nfl:h2h';
const env={BETQ_ODDS_SNAPSHOTS_ENABLED:'true',BETQ_BUDGET_ACCOUNT_ID:'synthetic-test',BETQ_ODDS_SNAPSHOT_DATABASE_URL:'postgresql://restricted:synthetic@db.invalid/betq'};
const record={version:1,accountId:'synthetic-test',cacheId,receivedAt:new Date(now).toISOString(),events:[]};
test('Persistence is opt-in and inactive configuration never loads a driver',()=>{
  for(const config of [{},{...env,BETQ_ODDS_SNAPSHOTS_ENABLED:undefined},{...env,BETQ_ODDS_SNAPSHOTS_ENABLED:'false'}]){
    assert.equal(configuredOddsSnapshotStore({env:config,clientFactory(){throw Error('not loaded');}}),null);
  }
});
test('Invalid switches, missing scope and unsafe database URLs fail closed without driver access',async()=>{
  const cases=[{BETQ_ODDS_SNAPSHOTS_ENABLED:''},{BETQ_ODDS_SNAPSHOTS_ENABLED:'TRUE'},
    {BETQ_ODDS_SNAPSHOTS_ENABLED:true},{BETQ_BUDGET_ACCOUNT_ID:''},{BETQ_BUDGET_ACCOUNT_ID:'wrong\n'},
    {BETQ_ODDS_SNAPSHOT_DATABASE_URL:undefined},{BETQ_ODDS_SNAPSHOT_DATABASE_URL:env.BETQ_ODDS_SNAPSHOT_DATABASE_URL+'?sslmode=require'},
    {BETQ_ODDS_SNAPSHOT_DATABASE_URL:env.BETQ_ODDS_SNAPSHOT_DATABASE_URL+'#secret'}];
  for(const change of cases){
    let loaded=0;const store=configuredOddsSnapshotStore({env:{...env,...change},clientFactory(){loaded++;}});
    assert.equal(store.configurationError,'ODDS_SNAPSHOT_CONFIGURATION_INVALID');
    await assert.rejects(store.read(cacheId),{code:'ODDS_SNAPSHOT_CONFIGURATION_INVALID'});
    await assert.rejects(store.write(cacheId,record),{code:'ODDS_SNAPSHOT_CONFIGURATION_INVALID'});
    assert.equal(loaded,0);
  }
});
test('Lazy shared pool retains verified TLS, finite limits, fixed account scope and original receipt time',async()=>{
  let loads=0,options,queries=[];
  const config={...env};
  const store=configuredOddsSnapshotStore({env:config,clock:()=>now,clientFactory:async()=>{
    loads++;return {Pool:class{constructor(o){options=o;}on(){}async query(sql,args){queries.push(args);return {rows:[{snapshot:record}],rowCount:1};}}};
  }});
  config.BETQ_BUDGET_ACCOUNT_ID='mutated';
  assert.equal(loads,0);
  const records=await Promise.all(Array.from({length:20},()=>store.read(cacheId)));
  assert.equal(loads,1);assert.deepEqual(records[0],record);
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.sslnegotiation,'postgres');
  assert.equal(options.connectionString,undefined);assert.equal(options.max,3);
  assert.equal(options.connectionTimeoutMillis,3000);assert.equal(options.query_timeout,5000);
  assert.equal(options.statement_timeout,5000);assert.equal(options.lock_timeout,3000);
  await store.write(cacheId,record);assert.ok(queries.every(args=>args[0]==='synthetic-test'));
});
test('Initialization and query failures are sanitized; failed driver init can recover without retrying queries',async()=>{
  let loads=0,calls=0;
  const store=configuredOddsSnapshotStore({env,clientFactory:async()=>{
    if(++loads===1)throw Error('postgresql://secret:password@host/db');
    return {Pool:class{on(){}async query(){calls++;throw Error('secret database failure');}}};
  }});
  for(let i=0;i<3;i++)await assert.rejects(store.read(cacheId),e=>{
    assert.equal(e.code,'ODDS_SNAPSHOT_STORAGE_UNAVAILABLE');assert.doesNotMatch(e.message,/password|postgresql|database failure/);return true;
  });
  assert.equal(loads,2);assert.equal(calls,2);
});
test('Enabled configured store restores cache only; missing state cannot spend provider credits',async()=>{
  let queries=0;
  const store=configuredOddsSnapshotStore({env,clock:()=>now+1,clientFactory:async()=>({Pool:class{
    on(){}async query(){queries++;return {rows:[{snapshot:record}]};}
  }})});
  const source=createOddsSource({apiKey:'fixture',clock:()=>now+1,snapshotStore:store,
    fetchImpl(){throw Error('provider forbidden');},budgetStore:{async status(){return {ready:false};},reserve(){throw Error('budget forbidden');}}});
  const result=await source.getOdds('americanfootball_nfl','h2h');
  assert.equal(queries,1);assert.equal(result.receivedAt,record.receivedAt);assert.equal(result.quota.remaining,null);
  const invalid=configuredOddsSnapshotStore({env:{...env,BETQ_BUDGET_ACCOUNT_ID:''}});
  const bad=createOddsSource({apiKey:'fixture',snapshotStore:invalid,fetchImpl(){throw Error('forbidden');},budgetStore:{async status(){return {};}}});
  await assert.rejects(bad.getOdds('americanfootball_nfl','h2h'),{code:'PAID_REFRESH_REQUIRED'});
  const status=await bad.status();assert.equal(status.snapshots.configured,false);
  assert.equal(status.snapshots.configurationError,'ODDS_SNAPSHOT_CONFIGURATION_INVALID');
});
test('Default source factory stays disabled without switch and reports malformed explicit switch',async()=>{
  const key='BETQ_ODDS_SNAPSHOTS_ENABLED',before=process.env[key];
  try{
    delete process.env[key];
    const budgetStore={async status(){return {};}};
    assert.equal((await createOddsSource({apiKey:'fixture',budgetStore}).status()).snapshots.configured,false);
    process.env[key]='TRUE';
    const source=createOddsSource({apiKey:'fixture',budgetStore});
    assert.equal((await source.status()).snapshots.configurationError,'ODDS_SNAPSHOT_CONFIGURATION_INVALID');
  }finally{if(before===undefined)delete process.env[key];else process.env[key]=before;}
});
test('Actual HTTP slate and health use configured factory without authorizing network refresh',async t=>{
  const http=await import('node:http');
  const {createHandler}=await import('../src/server.mjs');
  const make=async(snapshotStore)=>{
    const source=createOddsSource({apiKey:'synthetic',clock:()=>now+1,snapshotStore,
      budgetStore:{async status(){return {ready:false,reason:'BUDGET_BASELINE_REQUIRED'};},async reserve(){throw Object.assign(Error('unseeded'),{code:'BUDGET_BASELINE_REQUIRED'});}},
      fetchImpl(){throw Error('provider forbidden');}});
    const server=http.createServer(createHandler({source,clock:()=>now+1}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    return {base:`http://127.0.0.1:${server.address().port}`,source};
  };
  for(const rows of [[{snapshot:record}],[],[{snapshot:{...record,receivedAt:new Date(now-400000).toISOString()}}]]){
    const store=configuredOddsSnapshotStore({env,clock:()=>now+1,clientFactory:async()=>({Pool:class{on(){}async query(){return {rows};}}})});
    const {base,source}=await make(store);
    const response=await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h');
    assert.equal(response.status,rows[0]?.snapshot===record?200:409);
    assert.doesNotMatch(await response.text(),/postgresql|restricted|db.invalid/);
    await assert.rejects(source.getOdds('americanfootball_nfl','spreads',{allowPaid:true}),{code:'BUDGET_BASELINE_REQUIRED'});
  }
  for(const store of [configuredOddsSnapshotStore({env:{...env,BETQ_ODDS_SNAPSHOT_DATABASE_URL:'postgresql://private-secret@db.invalid/betq?sslmode=disable'}}),
    configuredOddsSnapshotStore({env,clientFactory:async()=>{throw Error('private-secret');}})]){
    const {base}=await make(store);
    assert.equal((await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h')).status,409);
    const response=await fetch(base+'/api/health');assert.equal(response.status,200);
    assert.doesNotMatch(await response.text(),/private-secret|postgresql|db.invalid/);
  }
});
test('Health and score reads never initialize the opt-in snapshot pool',async()=>{
  let loads=0;
  const store=configuredOddsSnapshotStore({env,clientFactory(){loads++;throw Error('not loaded');}});
  const source=createOddsSource({apiKey:'fixture',snapshotStore:store,budgetStore:{async status(){return {};}}});
  assert.equal((await source.status()).snapshots.configured,true);assert.equal(loads,0);
  await assert.rejects(source.getScores('americanfootball_nfl'),{code:'PAID_REFRESH_REQUIRED'});
  assert.equal(loads,0);
});
