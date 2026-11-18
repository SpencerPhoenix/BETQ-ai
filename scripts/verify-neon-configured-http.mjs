/** Manual hosted STAGING probe only. Never a production bootstrap or provider request. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {configuredOddsSnapshotStore} from '../src/configured-odds-snapshots.mjs';
import {createOddsSource} from '../src/odds.mjs';
import {createHandler} from '../src/server.mjs';

let server;
const timeout=setTimeout(()=>{console.error('CONFIGURED_HTTP_FAILED:DEADLINE');process.exit(1);},60000);
try{
  const url=new URL(process.env.BETQ_NEON_STAGING_DATABASE_URL);
  assert.ok(['ep-raspy-feather-bb7xepx3.c-15.us-east-1.aws.neon.tech',
    'ep-raspy-feather-bb7xepx3-pooler.c-15.us-east-1.aws.neon.tech'].includes(url.hostname));
  assert.equal(url.port||'5432','5432');assert.equal(decodeURIComponent(url.username),'betq_runtime');
  assert.equal(url.pathname,'/betq');assert.equal(url.hash,'');
  const seen=new Set();
  for(const [key,value] of url.searchParams){assert.ok(!seen.has(key));seen.add(key);assert.ok(['sslmode','channel_binding'].includes(key)&&value==='require');}
  url.search='';
  process.env.BETQ_ODDS_SNAPSHOTS_ENABLED='true';
  process.env.BETQ_ODDS_SNAPSHOT_DATABASE_URL=url.toString();
  process.env.BETQ_BUDGET_ACCOUNT_ID=`synthetic-http-${randomUUID()}`;
  delete process.env.BETQ_BUDGET_DATABASE_URL;
  delete process.env.BETQ_NEON_STAGING_DATABASE_URL;
  process.env.ODDS_API_KEY='SYNTHETIC-NOT-A-PROVIDER-KEY';
  process.env.ODDS_DAILY_CREDIT_LIMIT='0';
  const nativeFetch=globalThis.fetch;
  let providerAttempts=0;
  globalThis.fetch=(input,options)=>{
    const target=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(target.hostname!=='127.0.0.1'){providerAttempts++;throw Error('PROVIDER_FORBIDDEN');}
    return nativeFetch(input,options);
  };
  const now=Date.now(),receivedAt=new Date(now-1000).toISOString();
  const store=configuredOddsSnapshotStore();
  await store.write('odds:americanfootball_nfl:h2h',{receivedAt,events:[]});
  for(let restart=0;restart<2;restart++){
    const source=createOddsSource({clock:()=>now});
    server=http.createServer(createHandler({source,clock:()=>now}));
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(base+'/api/slate?mode=live&sport=americanfootball_nfl&market=h2h');
    assert.equal(response.status,200);
    const body=await response.json();
    // Inspect the source payload as well: the HTTP presentation may nest it.
    const restored=await source.getOdds('americanfootball_nfl','h2h');
    assert.equal(restored.receivedAt,receivedAt);assert.equal(restored.restoredFromPrivateSnapshot,true);
    assert.deepEqual(restored.quota,{remaining:null,used:null,last:null});
    assert.equal(body.events.length,0);
    await assert.rejects(source.getOdds('americanfootball_nfl','spreads',{allowPaid:true}),{code:'DURABLE_BUDGET_REQUIRED'});
    await new Promise(resolve=>server.close(resolve));server=null;
  }
  assert.equal(providerAttempts,0);
  console.log(JSON.stringify({status:'passed',httpRestarts:1,providerAttempts:0,syntheticRowsRetained:1,
    scope:'isolated staging only',actualProcessRestart:false,autosuspendObserved:false}));
}catch(error){
  const codes=new Set(['ERR_ASSERTION','EAI_AGAIN','ENOTFOUND','ETIMEDOUT','ECONNRESET','ODDS_SNAPSHOT_STORAGE_UNAVAILABLE','ODDS_SNAPSHOT_CONFIGURATION_INVALID']);
  console.error(`CONFIGURED_HTTP_FAILED:${codes.has(error?.code)?error.code:'VALIDATION_OR_CONNECTION_FAILED'}`);process.exitCode=1;
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  clearTimeout(timeout);
}
