import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {createOwnerSessionHttpHandler} from '../src/owner-session-http.mjs';
import {createOwnerSessionAdapter} from '../src/owner-session.mjs';
import {createHandler} from '../src/server.mjs';
const origin='https://betq.example',csrfToken='x'.repeat(43),setCookie='__Host-betq_owner='+'z'.repeat(43)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900';
function req(url='/api/owner/session',data={proof:'one-use-proof'},extra={}){const r=Readable.from([typeof data==='string'?data:JSON.stringify(data)]);r.method='POST';r.url=url;r.headers={origin,'sec-fetch-site':'same-origin','content-type':'application/json',...extra};return r;}
function fixture(){const calls=[];const adapter={async establishSession(r,input){calls.push(['login',input]);return {status:200,body:{csrfToken,expiresAt:9999999999},headers:{'Set-Cookie':setCookie,'Location':'https://evil.example','X-Secret':'private'}};},async resolveSession(){calls.push(['read']);return {verified:true,userId:'owner',csrfToken};},async logout(){calls.push(['logout']);return {status:200,headers:{'Set-Cookie':'__Host-betq_owner=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'}};}};return {adapter,calls,handler:createOwnerSessionHttpHandler({enabled:true,origin,adapter})};}
test('Auth HTTP defaults disabled and cannot be activated by request or environment',async()=>{
 const f=fixture();const h=createOwnerSessionHttpHandler({origin,adapter:f.adapter});assert.equal((await h(req())).status,404);assert.equal(f.calls.length,0);
 assert.equal((await createOwnerSessionHttpHandler({enabled:true,origin})(req())).status,503);
});
test('Exact same-origin POST routes only; no GET, query redirect, CORS or missing metadata',async()=>{
 const f=fixture();for(const url of ['/api/owner/session?next=https://evil.example','/api/owner/other','https://betq.example/api/owner/session'])assert.equal((await f.handler(req(url))).status,404);
 const get=req();get.method='GET';assert.equal((await f.handler(get)).status,405);
 for(const h of [{origin:'https://evil.example'},{origin:undefined},{'sec-fetch-site':'same-site'},{'sec-fetch-site':undefined}])assert.equal((await f.handler(req(undefined,undefined,h))).status,403);assert.equal(f.calls.length,0);
});
test('Bounded typed JSON rejects malformed/prototype/extra identity fields before verifier',async()=>{
 const f=fixture();for(const data of ['{','null','[]','{"__proto__":{"verified":true},"proof":"x"}',{proof:'x',verified:true},{proof:'x',subject:'owner'},{proof:'x'.repeat(4097)},{proof:'bad\nproof'},{proof:1}])assert.equal((await f.handler(req(undefined,data))).status,400);
 for(const headers of [{'content-type':'text/plain'},{'content-length':'4097'},{'content-length':'1'},{'content-encoding':'gzip'}])assert.equal((await f.handler(req(undefined,undefined,headers))).status,400);assert.equal(f.calls.length,0);
});
test('Login passes proof only to trusted adapter and forwards only exact hardened cookie',async()=>{
 const f=fixture();const r=await f.handler(req());assert.equal(r.status,200);assert.deepEqual(f.calls,[['login',{proof:'one-use-proof'}]]);assert.equal(r.headers['Set-Cookie'],setCookie);
 assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers.Pragma,'no-cache');assert.equal(r.headers.Vary,'Cookie, Origin');assert.equal(r.headers.Location,undefined);assert.equal(r.headers['X-Secret'],undefined);assert.equal(r.headers['Access-Control-Allow-Origin'],undefined);assert.doesNotMatch(JSON.stringify(r.body),/proof|private/);
 for(const cookie of [setCookie+'; Domain=evil.example',setCookie+'\r\nX-Secret: secret',setCookie.replace('; HttpOnly',''),undefined]){f.adapter.establishSession=async()=>({status:200,body:{csrfToken,expiresAt:1},headers:{'Set-Cookie':cookie}});assert.equal((await f.handler(req())).status,503);}
});
test('Session bootstrap returns only CSRF after verified session; malformed/unverified states denied',async()=>{
 const f=fixture();const r=await f.handler(req('/api/owner/session-info',{}));assert.deepEqual(r.body,{code:'OWNER_SESSION_ACTIVE',csrfToken});assert.equal(r.headers['Set-Cookie'],undefined);
 for(const value of [null,{verified:false,csrfToken},{verified:true,csrfToken:'bad'}]){f.adapter.resolveSession=async()=>value;assert.equal((await f.handler(req('/api/owner/session-info',{}))).status,401);}
 assert.equal((await f.handler(req('/api/owner/session-info',{owner:'arbitrary'}))).status,400);
});
test('Logout only accepts bounded CSRF body and exact cookie removal response',async()=>{
 const f=fixture();const r=await f.handler(req('/api/owner/logout',{csrfToken}));assert.equal(r.status,200);assert.match(r.headers['Set-Cookie'],/Max-Age=0$/);
 assert.equal((await f.handler(req('/api/owner/logout',{}))).status,400);
});
test('No verifier/storage error or response text leaks across auth boundary',async()=>{
 const f=fixture();f.adapter.establishSession=async()=>{throw Error('PRIVATE_CLIENT_SECRET');};assert.equal((await f.handler(req())).status,503);assert.doesNotMatch(JSON.stringify(await f.handler(req())),/PRIVATE/);
 f.adapter.establishSession=async()=>({status:401,body:{code:'PRIVATE_CLIENT_SECRET'},headers:{'X-Secret':'PRIVATE'}});const r=await f.handler(req());assert.equal(r.status,401);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('Actual local HTTP integration restores and revokes adapter session with no network identity provider',async t=>{
 const rows=new Map();const store={async replaceOwner(r){for(const old of rows.values())old.revoked=true;rows.set(r.sessionHash,{...r});return {stored:true};},async readAndTouch({sessionHash}){return rows.get(sessionHash);},async revoke({sessionHash}){rows.get(sessionHash).revoked=true;return {revoked:true};}};
 let calls=0;const adapter=createOwnerSessionAdapter({enabled:true,origin,ownerId:'test-owner',sessionStore:store,rateStore:{consume:async()=>({allowed:true})},verifyLogin:async(_req,{proof})=>{calls++;return {verified:proof==='synthetic-consumed-proof',subject:'test-owner',challengeConsumed:proof==='synthetic-consumed-proof'};}});
 const handler=createOwnerSessionHttpHandler({enabled:true,origin,adapter});
 const server=http.createServer(createHandler({ownerSessionHandler:handler}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base='http://127.0.0.1:'+server.address().port;const send=(path,data,cookie)=>fetch(base+path,{method:'POST',headers:{origin,'sec-fetch-site':'same-origin','content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)});
 const login=await send('/api/owner/session',{proof:'synthetic-consumed-proof'});assert.equal(login.status,200);const body=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
 const bootstrap=await send('/api/owner/session-info',{},cookie);assert.equal(bootstrap.status,200);assert.equal((await bootstrap.json()).csrfToken,body.csrfToken);
 const logout=await send('/api/owner/logout',{csrfToken:body.csrfToken},cookie);assert.equal(logout.status,200);assert.equal((await send('/api/owner/session-info',{},cookie)).status,401);assert.equal(calls,1);
});
