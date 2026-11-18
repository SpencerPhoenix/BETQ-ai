import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createHandler} from '../src/server.mjs';
async function server(t,options={}){const s=http.createServer(createHandler({source:{status:async()=>({configured:false}),getOdds(){throw Error('FORBIDDEN');}},...options}));await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return `http://127.0.0.1:${s.address().port}`;}
test('Owner authentication HTTP routes remain disabled without explicit injection',async t=>{
 const base=await server(t);for(const path of ['session','session-info','logout'])for(const method of ['GET','POST']){
  const r=await fetch(base+'/api/owner/'+path,{method});assert.equal(r.status,404);assert.equal((await r.json()).code,'OWNER_AUTH_DISABLED');
 }
});
test('Owner authentication response permits cookie but not CORS or cache policy override',async t=>{
 const cookie='__Host-betq_owner=fixture; Path=/; Secure; HttpOnly; SameSite=Strict';
 const base=await server(t,{ownerSessionHandler:async()=>({status:200,body:{code:'FIXTURE_ONLY'},headers:{'Set-Cookie':cookie,'Access-Control-Allow-Origin':'*','Cache-Control':'public'}})});
 const r=await fetch(base+'/api/owner/session',{method:'POST'});assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),cookie);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('Auth callback failures are sanitized without leaking error messages',async t=>{
 const base=await server(t,{ownerSessionHandler:async()=>{throw Error('secret proof');}});
 const r=await fetch(base+'/api/owner/session',{method:'POST'});assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/secret proof/);
});
