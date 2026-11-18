import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {probeOddsQuota} from '../scripts/probe-odds-quota.mjs';
const secret='fixture-key-never-print';
const headers=()=>new Headers({'x-requests-remaining':'497','x-requests-used':'3','x-requests-last':'0'});
test('Fixed zero-credit path, private header, one call, cancellation and no ledger writes',async()=>{
 let calls=0,cancelled=false;
 const result=await probeOddsQuota({apiKey:secret,clock:()=>0,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://api.the-odds-api.com/v4/sports/');
  assert.equal(options.redirect,'error');assert.equal(options.headers['x-api-key'],secret);
  assert.equal(options.method,'GET');assert.ok(options.signal instanceof AbortSignal);
  return {status:200,headers:headers(),body:{cancel:async()=>{cancelled=true;}}};
 }});
 assert.equal(calls,1);assert.equal(cancelled,true);assert.equal(result.remaining,497);
 assert.equal(result.plan,'NOT_REPORTED');assert.equal(result.ledgerUpdated,false);
 assert.equal(result.spendingAuthorized,false);assert.ok(!JSON.stringify(result).includes(secret));
});
test('Missing and malformed keys do not call network',async()=>{
 for(const apiKey of ['',null,'bad\nkey',' space','a'.repeat(513)]){
  const result=await probeOddsQuota({apiKey,fetchImpl:()=>{throw Error('Network must not be called');}});
  assert.equal(result.requestSent,false);
 }
});
test('Redirect or transport error never leaks error or retries',async()=>{
 let calls=0;
 const result=await probeOddsQuota({apiKey:secret,fetchImpl:async()=>{calls++;throw Error(secret);}});
 assert.equal(calls,1);assert.equal(result.code,'QUOTA_PROBE_FAILED');assert.ok(!JSON.stringify(result).includes(secret));
});
test('Rejected responses and malformed quota fail without body reads',async()=>{
 for(const [status,value] of [[401,'497'],[302,'497'],[200,'-1'],[200,'1.5'],[200,'9007199254740992'],[200,null]]){
  const h=headers();if(value===null)h.delete('x-requests-remaining');else h.set('x-requests-remaining',value);
  const result=await probeOddsQuota({apiKey:secret,fetchImpl:async()=>({status,headers:h,json:()=>{throw Error(secret);},text:()=>{throw Error(secret);}})});
  assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes(secret));
 }
});
test('Workflow is manual-only, read-only and no installation/artifact publication',()=>{
 const text=readFileSync(new URL('../.github/workflows/odds-quota-diagnostic.yml',import.meta.url),'utf8');
 assert.match(text,/workflow_dispatch:/);assert.match(text,/contents: read/);
 assert.doesNotMatch(text,/schedule:|push:|pull_request:|npm install|upload-artifact|curl|paid-request/);
 assert.match(text,/persist-credentials: false/);
});
