import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_STATES,classifyHealthResponse,probeDeploymentHealth}
  from '../src/deployment-health.mjs';

const shaA='a'.repeat(40),shaB='b'.repeat(40);
const expected={expectedVersion:'0.11.0',expectedCommit:shaA};
const good={status:'ok',app:'BETQ.ai',version:'0.11.0',commit:shaA};
const http=(status,body)=>({
  status,text:async()=>typeof body==='string'?body:JSON.stringify(body)
});
const probe=fetchImpl=>probeDeploymentHealth({...expected,fetchImpl,timeoutMs:1000});

test('matched version AND full deployment SHA is verified',async()=>{
  const r=await probe(async(url,opts)=>{
    assert.equal(url,'https://betq-ai.onrender.com/api/health');
    assert.equal(opts.method,'GET');
    assert.equal(opts.headers.Accept,'application/json');
    return http(200,good);
  });
  assert.equal(r.status,RELEASE_STATES.OK);
  assert.equal(r.actualCommit,shaA);
});

test('old healthy release without commit is explicitly STALE, not downtime',()=>{
  const r=classifyHealthResponse({httpStatus:200,body:{...good,version:'0.10.0',commit:null},...expected});
  assert.equal(r.status,RELEASE_STATES.STALE);
  assert.equal(r.reason,'VERSION_MISMATCH');
  assert.equal(r.actualVersion,'0.10.0');
});

test('same version at another commit is STALE, not verified current',()=>{
  const r=classifyHealthResponse({httpStatus:200,body:{...good,commit:shaB},...expected});
  assert.equal(r.status,RELEASE_STATES.STALE);
  assert.equal(r.reason,'COMMIT_MISMATCH');
  assert.equal(r.actualCommit,shaB);
});

test('missing commit at requested version is UNKNOWN rather than fabricated match',()=>{
  for(const commit of [null,undefined,'deadbeef',24]){
    const r=classifyHealthResponse({httpStatus:200,body:{...good,commit},...expected});
    assert.equal(r.status,RELEASE_STATES.UNKNOWN);
    assert.equal(r.reason,'DEPLOYED_COMMIT_UNAVAILABLE');
  }
});

test('malformed JSON and missing required fields fail SCHEMA',async()=>{
  assert.equal((await probe(async()=>http(200,'{not-json'))).status,RELEASE_STATES.SCHEMA);
  for(const body of [{...good,app:'NOT_BETQ'},{...good,status:'down'},null,[],{...good,version:'bad'}]){
    const r=classifyHealthResponse({httpStatus:200,body,...expected});
    assert.equal(r.status,RELEASE_STATES.SCHEMA);
  }
});

test('HTTP 503 and 404 are HTTP_ERROR rather than healthy stale',async()=>{
  for(const code of [503,404]){
    const r=await probe(async()=>http(code,{}));
    assert.equal(r.status,RELEASE_STATES.HTTP_ERROR);
    assert.equal(r.httpStatus,code);
  }
});

test('fetch abort or timeout gets TIMEOUT, not stale',async()=>{
  for(const name of ['AbortError','TimeoutError']){
    const r=await probe(async()=>{const e=new Error('request timed out');e.name=name;throw e});
    assert.equal(r.status,RELEASE_STATES.TIMEOUT);
  }
});

test('DNS or connection failure gets UNREACHABLE',async()=>{
  const r=await probe(async()=>{throw new TypeError('fetch failed')});
  assert.equal(r.status,RELEASE_STATES.UNREACHABLE);
});

test('reader failure, oversized response and invalid runtime metadata fail safely',async()=>{
  assert.equal((await probe(async()=>http(200,'x'.repeat(32001)))).status,RELEASE_STATES.SCHEMA);
  assert.equal((await probe(async()=>({status:200,text:async()=>{throw Error('read failed')}}))).status,RELEASE_STATES.SCHEMA);
  assert.throws(()=>classifyHealthResponse({httpStatus:200,body:good,
    expectedVersion:'latest',expectedCommit:shaA}),/INVALID_EXPECTED_RELEASE/);
});

test('release probing never contacts paid sports endpoints',async()=>{
  let urls=[];
  await probe(async(url)=>{urls.push(url);return http(200,good)});
  assert.deepEqual(urls,['https://betq-ai.onrender.com/api/health']);
});
