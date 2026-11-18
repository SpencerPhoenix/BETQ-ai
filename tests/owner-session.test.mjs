import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerSessionAdapter} from '../src/owner-session.mjs';
const origin='https://betq.example',ownerId='verified-owner';
function request(path='/api/owner/refresh',cookie){return {method:'POST',url:path,headers:{origin,'sec-fetch-site':'same-origin',...(cookie?{cookie}:{})}};}
function fixture(options={}){
 let time=1000000,rows=new Map(),rates=new Map();const calls={read:0,write:0,verify:0,rate:0};
 const sessionStore={
  async replaceOwner(row){calls.write++;for(const prior of rows.values())if(prior.userId===row.userId)prior.revoked=true;rows.set(row.sessionHash,{...row});return {stored:true};},
  async readAndTouch({sessionHash,now,idleMs}){calls.read++;const row=rows.get(sessionHash);if(!row)return null;const previous={...row};if(!row.revoked&&now>=row.lastSeenAt&&now-row.lastSeenAt<idleMs&&now<row.expiresAt)row.lastSeenAt=now;return previous;},
  async revoke({sessionHash,userId}){const r=rows.get(sessionHash);if(r?.userId!==userId)return {revoked:false};r.revoked=true;return {revoked:true};}
 };
 const rateStore={async consume({scope,key,limit,windowMs}){calls.rate++;const k=scope+key+Math.floor(time/windowMs);const n=(rates.get(k)||0)+1;rates.set(k,n);return {allowed:n<=limit};}};
 const opts={enabled:true,origin,ownerId,sessionStore,rateStore,clock:()=>time,verifyLogin:async()=>{calls.verify++;return {verified:true,subject:ownerId,challengeConsumed:true};},...options};
 const adapter=createOwnerSessionAdapter(opts);
 async function login(){const r=await adapter.establishSession(request('/api/owner/session'));assert.equal(r.status,200);return {cookie:r.headers['Set-Cookie'].split(';')[0],csrfToken:r.body.csrfToken,response:r};}
 return {adapter,login,calls,rows,sessionStore,rateStore,advance(ms){time+=ms;},setTime(v){time=v;}};
}
test('Default disabled and missing durable dependencies fail closed without writes',async()=>{
 const a=createOwnerSessionAdapter();assert.equal(await a.resolveSession(request()),null);assert.equal((await a.establishSession(request('/api/owner/session'))).status,404);
 const b=createOwnerSessionAdapter({enabled:true,origin,ownerId});assert.equal(await b.resolveSession(request()),null);assert.equal((await b.establishSession(request('/api/owner/session'))).status,503);
});
test('Only consumed verified owner identity issues opaque cookie; storage never receives raw session token',async()=>{
 const f=fixture();const s=await f.login();const h=s.response.headers['Set-Cookie'];assert.match(h,/^__Host-betq_owner=/);for(const attribute of ['Path=/','Secure','HttpOnly','SameSite=Strict','Max-Age=900'])assert.ok(h.includes(attribute));
 assert.equal(s.response.headers['Cache-Control'],'no-store');assert.ok(!JSON.stringify([...f.rows.values()]).includes(s.cookie.split('=')[1]));assert.equal(f.rows.size,1);
 const verified=await f.adapter.resolveSession(request(undefined,s.cookie));assert.deepEqual(verified,{verified:true,userId:ownerId,csrfToken:s.csrfToken});
 for(const identity of [{verified:false,subject:ownerId,challengeConsumed:true},{verified:true,subject:'other',challengeConsumed:true},{verified:true,subject:ownerId}]){
  const bad=fixture({verifyLogin:async()=>identity});assert.equal((await bad.adapter.establishSession(request('/api/owner/session'))).status,401);assert.equal(bad.calls.write,0);
 }
});
test('Cross-origin, missing metadata and attacker identity/bearer headers do not authenticate',async()=>{
 const f=fixture();const s=await f.login();for(const headers of [{origin:'https://evil.example'},{'sec-fetch-site':'same-site'},{origin:undefined}]){const r=request(undefined,s.cookie);Object.assign(r.headers,headers);assert.equal(await f.adapter.resolveSession(r),null);}
 const r=request();r.headers.authorization='Bearer '+s.cookie.split('=')[1];r.headers['x-owner-id']=ownerId;assert.equal(await f.adapter.resolveSession(r),null);
 assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie+'; '+s.cookie)),null);
});
test('Idle timeout rejects old sessions; activity never extends absolute lifetime',async()=>{
 const f=fixture();let s=await f.login();const oldLastSeen=[...f.rows.values()][0].lastSeenAt;f.advance(300000);assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie)),null);assert.equal([...f.rows.values()][0].lastSeenAt,oldLastSeen);
 const g=fixture();s=await g.login();for(let i=0;i<4;i++){g.advance(180000);assert.ok(await g.adapter.resolveSession(request(undefined,s.cookie)));}
 g.advance(180000);assert.equal(await g.adapter.resolveSession(request(undefined,s.cookie)),null);
});
test('Logout requires same-origin POST and session CSRF and revokes server-side replay',async()=>{
 const f=fixture();const s=await f.login();const r=request('/api/owner/logout',s.cookie);
 assert.equal((await f.adapter.logout(r,{csrfToken:'y'.repeat(43)})).status,403);assert.ok(await f.adapter.resolveSession(request(undefined,s.cookie)));
 const result=await f.adapter.logout(r,{csrfToken:s.csrfToken});assert.equal(result.status,200);assert.match(result.headers['Set-Cookie'],/Max-Age=0/);assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie)),null);
});
test('New authenticated login rotates session and revokes older device cookie',async()=>{
 const f=fixture();const first=await f.login(),second=await f.login();assert.notEqual(first.cookie,second.cookie);assert.equal(await f.adapter.resolveSession(request(undefined,first.cookie)),null);assert.ok(await f.adapter.resolveSession(request(undefined,second.cookie)));
});
test('Shared owner access bucket limits repeated tabs while logout remains possible',async()=>{
 const f=fixture();const s=await f.login();for(let i=0;i<6;i++)assert.ok(await f.adapter.resolveSession(request(undefined,s.cookie)));
 assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie)),null);assert.equal((await f.adapter.logout(request('/api/owner/logout',s.cookie),{csrfToken:s.csrfToken})).status,200);
});
test('Failed authentication is bounded globally and forwarded IP cannot multiply allowance',async()=>{
 const f=fixture();for(let i=0;i<35;i++){const r=request();r.headers['x-forwarded-for']='fake-'+i;assert.equal(await f.adapter.resolveSession(r),null);}assert.equal(f.calls.read,0);
 for(let i=0;i<5;i++){const r=await f.adapter.establishSession(request('/api/owner/session'));assert.equal(r.status,200);}assert.equal((await f.adapter.establishSession(request('/api/owner/session'))).status,429);assert.equal(f.calls.verify,5);
});
test('Store/rate errors and malformed records fail closed without revealing details',async()=>{
 const f=fixture();const s=await f.login();f.rateStore.consume=async()=>{throw Error('private credentials');};assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie)),null);
 const g=fixture();const x=await g.login();[...g.rows.values()][0].expiresAt+=3600000;assert.equal(await g.adapter.resolveSession(request(undefined,x.cookie)),null);
 const h=fixture();const y=await h.login();h.sessionStore.revoke=async()=>{throw Error('secret');};const result=await h.adapter.logout(request('/api/owner/logout',y.cookie),{csrfToken:y.csrfToken});assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result),/secret/);
});
test('Clock rollback does not resurrect or extend sessions',async()=>{
 const f=fixture();const s=await f.login();f.advance(1000);assert.ok(await f.adapter.resolveSession(request(undefined,s.cookie)));f.setTime(999999);assert.equal(await f.adapter.resolveSession(request(undefined,s.cookie)),null);
});
