import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorRequest } from '../scripts/operator-auth.mjs';
const env={BETQ_OPERATOR_REFRESH_TOKEN:'OFFLINE_OPERATOR_FIXTURE_0123456789'};
test('Operator request requires token, pins origin, and forbids redirect credential forwarding',()=>{
  assert.throws(()=>operatorRequest('/api/slate',{}),/OPERATOR_TOKEN_MISSING/);
  const {endpoint,options}=operatorRequest('/api/slate?mode=live',env);
  assert.equal(endpoint.origin,'https://betq-ai.onrender.com');
  assert.equal(options.headers.Authorization,'Bearer OFFLINE_OPERATOR_FIXTURE_0123456789');
  assert.equal(options.headers['x-betq-paid-request'],'true');
  assert.equal(options.redirect,'error');
  assert.throws(()=>operatorRequest('/api/slate',{...env,BETQ_PRODUCTION_URL:'https://unapproved.test'}),/NOT_APPROVED/);
  assert.throws(()=>operatorRequest('https://unapproved.test/api/slate',env),/NOT_APPROVED/);
  assert.throws(()=>operatorRequest('//unapproved.test/api/slate',env),/NOT_APPROVED/);
  assert.throws(()=>operatorRequest('/api/health',env),/NOT_APPROVED/);
});
test('Alternate origins require explicit approval and HTTPS without credentials or suffixes',()=>{
  for(const value of ['http://offline.test','https://user:pass@offline.test','https://offline.test/path','https://offline.test/?q=1','https://offline.test/#x']){
    assert.throws(()=>operatorRequest('/api/slate',{...env,BETQ_PRODUCTION_URL:value,BETQ_OPERATOR_APPROVED_ORIGIN:value}),/INVALID/);
  }
  assert.equal(operatorRequest('/api/scores',{...env,BETQ_PRODUCTION_URL:'https://offline.test',BETQ_OPERATOR_APPROVED_ORIGIN:'https://offline.test'}).endpoint.origin,'https://offline.test');
});

test('Malformed credentials are rejected locally without echoing them',()=>{
  for(const token of ['short','invalid token with spaces 01234567890123456789','line\nbreak_012345678901234567890123456789']){
    assert.throws(()=>operatorRequest('/api/slate',{BETQ_OPERATOR_REFRESH_TOKEN:token}),error=>{
      assert.equal(error.message,'OPERATOR_TOKEN_INVALID');assert.equal(error.message.includes(token),false);return true;
    });
  }
  assert.throws(()=>operatorRequest('https://user:pass@betq-ai.onrender.com/api/slate',env),/NOT_APPROVED/);
});
