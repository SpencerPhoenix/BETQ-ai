import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createOwnerRefreshHandler} from '../src/owner-refresh.mjs';
const origin='https://betq.example',csrfToken='x'.repeat(40),id='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
const ready=()=>({configured:true,budget:{persistent:true,available:true,ready:true,baselineCurrent:true,unresolvedReservations:0},snapshots:{configured:true}});
const paid=()=>({cacheHit:false,events:[],receivedAt:'2026-11-18T00:00:00.000Z',quota:{remaining:451,used:49,last:1},refreshReceipt:{reconciled:true,reservationId:id2,snapshotStored:true}});
function req(body={market:'h2h',idempotencyKey:id,csrfToken},headers={}){const r=Readable.from([JSON.stringify(body)]);r.method='POST';r.url='/api/owner/refresh';r.headers={'content-type':'application/json',origin,'sec-fetch-site':'same-origin',...headers};return r;}
function fixture(overrides={}){
 const calls={claims:0,gets:0,complete:0,unknown:0,resolves:0},seen=new Set();let active=false,blocked=false;
 const store={async claim(o){calls.claims++;if(blocked||active||seen.has(o.operationId))throw Error('NO');seen.add(o.operationId);active=true;return {...o,reservedCredits:1};},async complete(o){calls.complete++;calls.charged=o.chargedCredits;active=false;return {completed:true,chargedCredits:Math.max(1,o.chargedCredits)};},async failUnknown(){calls.unknown++;blocked=true;}};
 const source={async status(){return ready();},async getOdds(s,m,o){calls.gets++;assert.equal(s,'americanfootball_nfl');assert.equal(o.allowPaid,true);return paid();}};
 const options={enabled:true,origin,ownerId:'owner',resolveSession:async()=>{calls.resolves++;return {verified:true,userId:'owner',csrfToken};},store,source,...overrides};
 return {calls,store,source,options,handler:createOwnerRefreshHandler(options)};
}
test('Disabled default and missing verified resolver cannot access providers or store',async()=>{
 for(const opts of [{},{enabled:true,origin,ownerId:'owner'}])assert.ok([404,503].includes((await createOwnerRefreshHandler(opts)(req())).status));
 const f=fixture({enabled:false});assert.equal((await f.handler(req())).status,404);assert.deepEqual(f.calls,{claims:0,gets:0,complete:0,unknown:0,resolves:0});
});
test('Exact method, fixed path, origin and Fetch Metadata reject before auth',async()=>{
 const f=fixture();for(const [key,value] of [['method','GET'],['url','/api/owner/refresh?market=totals']]){const r=req();r[key]=value;assert.notEqual((await f.handler(r)).status,200);}
 for(const h of [{origin:'https://evil.example'},{origin:'null'},{origin:[origin]},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':undefined}])assert.equal((await f.handler(req(undefined,h))).status,403);
 assert.equal(f.calls.resolves,0);assert.equal(f.calls.gets,0);
});
test('Session identity and session-bound CSRF cannot be supplied by public bearer/body',async()=>{
 for(const session of [null,{verified:false,userId:'owner',csrfToken},{verified:true,userId:'other',csrfToken},{verified:true,userId:'owner'}]){
  const f=fixture({resolveSession:async()=>session});assert.equal((await f.handler(req(undefined,{authorization:'Bearer arbitrary'}))).status,401);assert.equal(f.calls.claims,0);
 }
 const f=fixture();assert.equal((await f.handler(req({market:'h2h',idempotencyKey:id,csrfToken:'y'.repeat(40)}))).status,403);assert.equal(f.calls.claims,0);
});
test('Strict bounded JSON has one market, UUIDv4 and no extra provider/scope fields',async()=>{
 const f=fixture();for(const data of [null,[],{}, {market:'nfl',idempotencyKey:id,csrfToken},{market:'h2h',idempotencyKey:'bad',csrfToken},{market:'h2h',idempotencyKey:id,csrfToken,sport:'other'},{market:'h2h',idempotencyKey:id,csrfToken:'x'.repeat(1500)}])assert.equal((await f.handler(req(data))).status,400);
 for(const headers of [{'content-type':'text/plain'},{'content-encoding':'gzip'},{'content-length':'1025'},{'content-length':'1'}])assert.equal((await f.handler(req(undefined,headers))).status,400);
 assert.equal(f.calls.claims,0);
});
test('Real budget and snapshot readiness mandatory before claim',async()=>{
 for(const mutate of [s=>s.configured=false,s=>s.budget.persistent=false,s=>s.budget.ready=false,s=>s.budget.baselineCurrent=false,s=>s.budget.unresolvedReservations=1,s=>s.snapshots.configured=false,s=>s.snapshots.writeError='FAILED']){
  const f=fixture();f.source.status=async()=>{const s=ready();mutate(s);return s;};assert.equal((await f.handler(req())).status,503);assert.equal(f.calls.claims,0);
 }
});
test('Successful paid receipt completes exactly one market; replay cannot fetch',async()=>{
 const f=fixture();assert.equal((await f.handler(req())).body.actualChargedCredits,1);assert.equal(f.calls.complete,1);assert.equal(f.calls.unknown,0);
 assert.equal((await f.handler(req())).status,409);assert.equal(f.calls.gets,1);
});
test('Concurrent claims cannot duplicate provider calls',async()=>{
 const f=fixture();let release;f.source.getOdds=async()=>{f.calls.gets++;await new Promise(r=>release=r);return paid();};
 const first=f.handler(req());while(!release)await new Promise(r=>setTimeout(r,1));
 assert.equal((await f.handler(req({market:'spreads',idempotencyKey:id2,csrfToken}))).status,409);release();assert.equal((await first).status,200);assert.equal(f.calls.gets,1);
});
test('Cached read clearly charges zero actual but conservatively reserves one trial credit',async()=>{
 const f=fixture();f.source.getOdds=async()=>({...paid(),cacheHit:true,quota:{remaining:null,used:null,last:null},refreshReceipt:undefined});
 const r=await f.handler(req());assert.equal(r.status,200);assert.equal(r.body.actualChargedCredits,0);assert.equal(r.body.reservedCredits,1);assert.equal(f.calls.charged,0);
});
test('Unknown errors, missing quota/receipt, and failed writes stop irreversibly without retries',async()=>{
 for(const mutate of [r=>delete r.refreshReceipt,r=>r.refreshReceipt.reconciled=false,r=>r.refreshReceipt.snapshotStored=false,r=>r.quota.remaining=null,r=>r.quota.last=-1,r=>r.cacheHit=undefined]){
  const f=fixture();f.source.getOdds=async()=>{f.calls.gets++;const r=paid();mutate(r);return r;};
  const r=await f.handler(req());assert.equal(r.status,503);assert.equal(r.body.retryAllowed,false);assert.equal(f.calls.unknown,1);assert.equal(f.calls.complete,0);
  assert.equal((await f.handler(req({market:'spreads',idempotencyKey:id2,csrfToken}))).status,409);assert.equal(f.calls.gets,1);
 }
 const f=fixture();let states=0;f.source.status=async()=>{const s=ready();if(states++)s.snapshots.writeError='PRIVATE_SECRET';return s;};
 const r=await f.handler(req());assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SECRET/);assert.equal(f.calls.unknown,1);
});
test('Claim failure never runs provider or marks an unclaimed operation unknown',async()=>{
 const f=fixture();f.store.claim=async()=>{throw Error('secret');};const r=await f.handler(req());assert.equal(r.status,409);assert.equal(f.calls.gets,0);assert.equal(f.calls.unknown,0);assert.doesNotMatch(JSON.stringify(r),/secret/);
});
test('Completion uncertainty stops even if failure recording also fails',async()=>{
 const f=fixture();f.store.complete=async()=>{throw Error('secret');};f.store.failUnknown=async()=>{throw Error('secret');};assert.equal((await f.handler(req())).status,503);
 assert.equal((await f.handler(req({market:'totals',idempotencyKey:id2,csrfToken}))).status,409);assert.equal(f.calls.gets,1);
});
test('Final permitted credit can complete even when ready becomes false after debit',async()=>{
 const f=fixture();let n=0;f.source.status=async()=>{const s=ready();if(n++)s.budget.ready=false;return s;};assert.equal((await f.handler(req())).status,200);
});
test('UUID normalization matches durable store and invalid completion evidence stops',async()=>{
 const f=fixture();const upper='ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF';
 const result=await f.handler(req({market:'totals',idempotencyKey:upper,csrfToken}));
 assert.equal(result.status,200);assert.equal(result.body.operationId,upper.toLowerCase());
 const bad=fixture();bad.store.complete=async()=>({completed:false,chargedCredits:1});
 assert.equal((await bad.handler(req())).status,503);assert.equal(bad.calls.unknown,1);
});
test('Malformed JSON and invalid UTF-8 never reach durable claim',async()=>{
 const f=fixture();for(const body of [Buffer.from('{'),Buffer.from([0xff])]){
  const r=Readable.from([body]);r.method='POST';r.url='/api/owner/refresh';r.headers=req().headers;
  assert.equal((await f.handler(r)).status,400);
 }assert.equal(f.calls.claims,0);
});
