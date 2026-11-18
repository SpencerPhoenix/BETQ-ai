import test from 'node:test';
import assert from 'node:assert/strict';
import {createOddsSnapshotStore,validateOddsSnapshot} from '../src/odds-snapshot-store.mjs';
import {createOddsSource} from '../src/odds.mjs';
import {nflMoneylineConsensus} from '../src/market-consensus.mjs';
import {analyzeEvents} from '../src/engine.mjs';
import {planOddsRefresh} from '../src/odds-refresh-plan.mjs';
const now=Date.parse('2026-11-18T01:00:00Z'),cacheId='odds:americanfootball_nfl:h2h',accountId='test-account';
const record=()=>({version:1,accountId,cacheId,receivedAt:new Date(now).toISOString(),events:[{id:'event',sport_key:'americanfootball_nfl',commence_time:'2026-11-19T01:00:00Z',home_team:'A',away_team:'B',bookmakers:[{key:'book',title:'Book',last_update:'2026-11-18T00:59:00Z',markets:[{key:'h2h',outcomes:[{name:'A',price:-110},{name:'B',price:110}]}]}]}]});
const options={accountId,cacheId,now};
test('snapshot schema is bounded, exact and preserves real receipt time',()=>{
 assert.deepEqual(validateOddsSnapshot(record(),options),record());
 for(const mutate of [r=>r.accountId='other',r=>r.cacheId='scores:americanfootball_nfl',r=>r.receivedAt='2026-11-18T02:00:00Z',r=>r.events[0].apiKey='private',r=>r.events[0].bookmakers[0].last_update='2026-11-18T02:00:00Z',r=>r.events.push(r.events[0]),r=>r.events[0].bookmakers[0].markets[0].outcomes[0].price=1]){
  const r=record();mutate(r);assert.throws(()=>validateOddsSnapshot(r,options));
 }
});
test('private adapter uses scoped parameterized SQL and monotonic writes',async()=>{
 const calls=[];const store=createOddsSnapshotStore({accountId,clock:()=>now,pool:{async query(sql,args){calls.push({sql,args});return sql.startsWith('SELECT')?{rows:[{snapshot:record()}]}:{rowCount:1};}}});
 assert.deepEqual(await store.read(cacheId),record());await store.write(cacheId,record());
 assert.deepEqual(calls[0].args,[accountId,cacheId]);assert.match(calls[1].sql,/received_at < EXCLUDED.received_at/);
});
test('restart restores fresh private snapshot with no provider or budget calls, never quota',async()=>{
 const source=createOddsSource({apiKey:'test',clock:()=>now+1000,budgetStore:{async status(){return {};},reserve(){throw Error('forbidden');}},snapshotStore:{async read(){return record();}},fetchImpl(){throw Error('forbidden');}});
 const result=await source.getOdds('americanfootball_nfl','h2h');
 assert.equal(result.receivedAt,record().receivedAt);assert.equal(result.cacheHit,true);assert.equal(result.restoredFromPrivateSnapshot,true);assert.equal(result.quota.remaining,null);
});
test('stale, future, missing and failed persisted reads never buy or relabel odds',async()=>{
 for(const read of [async()=>record(),async()=>null,async()=>{throw Error('private database url');}]){
  const source=createOddsSource({apiKey:'test',clock:()=>now+300001,snapshotStore:{read},fetchImpl(){throw Error('forbidden');}});
  await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),e=>e.code==='PAID_REFRESH_REQUIRED');
 }
 const source=createOddsSource({apiKey:'test',clock:()=>now-1,snapshotStore:{async read(){return record();}}});
 await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),e=>e.code==='PAID_REFRESH_REQUIRED');
});
test('authorized refresh writes observation once; write failure leaves diagnostic, not fake durable success',async()=>{
 let writes=0;
 const source=createOddsSource({apiKey:'test',clock:()=>now,snapshotStore:{async read(){return null;},async write(){writes++;throw Error('private');}},budgetStore:{async reserve(){return {};},async reconcile(){},async status(){return {};}},fetchImpl:async()=>new Response(JSON.stringify(record().events))});
 const result=await source.getOdds('americanfootball_nfl','h2h',{allowPaid:true});assert.equal(result.cacheHit,false);assert.equal(writes,1);
 assert.equal((await source.status()).snapshots.error,'SNAPSHOT_WRITE_FAILED');
});
test('bounded refresh planning requires explicit caps and pregame window; never executes',()=>{
 const input={enabled:true,now,intervalMs:300000,windowBeforeMs:3600000,remaining:454,dailyRemaining:12,reserve:50,maximumCycles:4,cyclesUsed:0,gameTimes:[now+1800000]};
 assert.equal(planOddsRefresh(input).estimatedCredits,3);
 for(const change of [{enabled:false},{dailyRemaining:2},{remaining:52},{cyclesUsed:4},{gameTimes:[now]},{lastCycleAt:now-1},{lastCycleAt:now+1},{remaining:null},{intervalMs:1}])assert.equal(planOddsRefresh({...input,...change}).eligible,false);
 assert.equal(planOddsRefresh().reason,'DISABLED');
});
test('healthy memory bypasses storage and retains write failure diagnostics',async()=>{
 let reads=0;
 const source=createOddsSource({apiKey:'test',clock:()=>now,snapshotStore:{async read(){reads++;return null;},async write(){throw Error('private');}},budgetStore:{async reserve(){return {};},async reconcile(){},async status(){return {};}},fetchImpl:async()=>new Response(JSON.stringify(record().events))});
 await source.getOdds('americanfootball_nfl','h2h',{allowPaid:true});
 await source.getOdds('americanfootball_nfl','h2h');
 assert.equal(reads,1);assert.equal((await source.status()).snapshots.writeError,'SNAPSHOT_WRITE_FAILED');
});
test('parallel cold reads coalesce one private restore and never call provider',async()=>{
 let reads=0;
 const source=createOddsSource({apiKey:'test',clock:()=>now,snapshotStore:{async read(){reads++;await new Promise(r=>setTimeout(r,10));return record();}},fetchImpl(){throw Error('forbidden');}});
 const results=await Promise.all(Array.from({length:50},()=>source.getOdds('americanfootball_nfl','h2h')));
 assert.equal(reads,1);assert.equal(results.length,50);
});
test('hung private restore is bounded and a late result cannot become a cache entry',async()=>{
 let finish;
 const source=createOddsSource({apiKey:'test',clock:()=>now,snapshotStore:{read:()=>new Promise(resolve=>{finish=resolve;})},budgetStore:{async status(){return {};}},fetchImpl(){throw Error('forbidden');}});
 await assert.rejects(source.getOdds('americanfootball_nfl','h2h'),e=>e.code==='PAID_REFRESH_REQUIRED');
 finish(record());await new Promise(r=>setImmediate(r));
 const status=await source.status();assert.equal(status.cacheEntries,0);assert.equal(status.snapshots.readError,'SNAPSHOT_READ_FAILED');
});

// Documented current shape; synthetic fixture, not an account/live observation.
const marketRecord=()=>{
 const r=record();
 const b=r.events[0].bookmakers[0];
 b.markets[0].last_update=b.last_update;
 delete b.last_update;
 return r;
};
test('market-only timestamps round trip exactly; legacy book-only stays unmodified',()=>{
 for(const r of [marketRecord(),record()]){
  const before=JSON.stringify(r),copy=validateOddsSnapshot(r,options);
  assert.equal(JSON.stringify(copy),before);assert.equal(JSON.stringify(r),before);
  assert.notEqual(copy,r);
 }
 const r=marketRecord();r.events[0].bookmakers[0].last_update='2026-11-18T00:59:30Z';
 assert.deepEqual(validateOddsSnapshot(r,options),r);
});
test('missing both clocks and malformed/future supplied clocks fail without fallback',()=>{
 for(const mutate of [
  b=>delete b.markets[0].last_update,
  b=>b.markets[0].last_update=null,
  b=>b.markets[0].last_update='',
  b=>b.markets[0].last_update='2026-11-18T02:00:00Z',
  b=>b.markets[0].last_update='2026-11-18T00:59:00',
  b=>b.last_update=null,
  b=>b.last_update='2026-11-18T02:00:00Z',
  b=>{b.last_update='2026-11-18T00:59:30Z';b.markets[0].last_update='bad';},
 ]){
  const r=marketRecord();mutate(r.events[0].bookmakers[0]);
  assert.throws(()=>validateOddsSnapshot(r,options),/ODDS_SNAPSHOT_INVALID/);
 }
});
test('documented market-only response persists and restores after source restart without new fetch',async()=>{
 let stored=null,fetches=0,reserves=0;
 const pool={async query(sql,args){
  if(sql.startsWith('SELECT'))return {rows:stored?[{snapshot:stored}]:[]};
  stored=JSON.parse(args[3]);return {rowCount:1};
 }};
 const snapshotStore=createOddsSnapshotStore({accountId,clock:()=>now+1000,pool});
 const first=createOddsSource({apiKey:'test',clock:()=>now,snapshotStore,
  budgetStore:{async reserve(){reserves++;return {};},async reconcile(){},async status(){return {};}},
  fetchImpl:async()=>{fetches++;return new Response(JSON.stringify(marketRecord().events));}});
 const live=await first.getOdds('americanfootball_nfl','h2h',{allowPaid:true});
 assert.equal((await first.status()).snapshots.writeError,null);
 assert.equal(stored.receivedAt,live.receivedAt);
 assert.deepEqual(stored.events,marketRecord().events);
 const second=createOddsSource({apiKey:'test',clock:()=>now+1000,snapshotStore,
  budgetStore:{reserve(){throw Error('must not reserve');}},fetchImpl(){throw Error('must not fetch');}});
 const restored=await second.getOdds('americanfootball_nfl','h2h');
 assert.equal(restored.restoredFromPrivateSnapshot,true);
 assert.equal(restored.receivedAt,live.receivedAt);
 assert.deepEqual(restored.events,live.events);
 assert.equal(fetches,1);assert.equal(reserves,1);
});
test('storage preserves stale market time; fresh bookmaker and receipt cannot qualify it',()=>{
 const r=marketRecord(),book=r.events[0].bookmakers[0];
 book.last_update=r.receivedAt;
 book.markets[0].last_update='2026-11-18T00:00:00Z';
 const copy=validateOddsSnapshot(r,options);
 assert.equal(copy.events[0].bookmakers[0].markets[0].last_update,book.markets[0].last_update);
 assert.equal(analyzeEvents(copy.events,{sport:'americanfootball_nfl',asOf:now}).summary.signals,0);
});
test('consensus after persistence requires actual fresh market timestamps, not book or receipt',()=>{
 for(const shape of ['fresh','stale','missing']){
  const r=marketRecord(),base=r.events[0].bookmakers[0];
  base.last_update=r.receivedAt;
  if(shape==='stale')base.markets[0].last_update='2026-11-18T00:00:00Z';
  if(shape==='missing')delete base.markets[0].last_update;
  r.events[0].bookmakers=Array.from({length:3},(_,i)=>({...structuredClone(base),key:`book${i}`}));
  const copy=validateOddsSnapshot(r,options);
  const result=nflMoneylineConsensus(copy.events[0],{asOf:now,receivedAt:copy.receivedAt});
  assert.equal(result.available,shape==='fresh',shape);
 }
});
