import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {configuredOwnerTrial} from '../src/configured-owner-trial.mjs';
const url='postgresql://fixture:fixture_password@localhost/fixture';
test('Owner trial defaults disabled without driver or ambient environment access',async()=>{
  let loads=0;const store=configuredOwnerTrial({accountId:'fixture',connectionString:url,clientFactory:()=>{loads++;}});
  for(const method of ['status','claim','complete','failUnknown'])await assert.rejects(store[method](),{code:'OWNER_TRIAL_DISABLED'});
  assert.equal(loads,0);
});
test('Owner trial rejects URL overrides before driver load and masks connection contents',async()=>{
  let loads=0;
  for(const connectionString of [url+'?sslmode=disable',url+'#bad','invalid']){
    await assert.rejects(configuredOwnerTrial({enabled:true,accountId:'fixture',connectionString,clientFactory:()=>{loads++;}}).status(),error=>{
      assert.equal(error.code,'OWNER_TRIAL_CONFIG_INVALID');assert.doesNotMatch(error.message,/fixture_password|sslmode/);return true;
    });
  }assert.equal(loads,0);
});
test('Owner trial pool requires verified TLS, fixed bounds and idle-error handling',async()=>{
  let options,pool,loads=0;
  class Pool extends EventEmitter {constructor(value){super();options=value;pool=this;}async connect(){throw Error('fixture_password');}}
  const store=configuredOwnerTrial({enabled:true,accountId:'fixture',connectionString:url,clientFactory:async()=>{loads++;return {Pool};}});
  await assert.rejects(store.status(),{code:'OWNER_TRIAL_STORAGE_UNAVAILABLE'});
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.connectionString,undefined);
  assert.equal(options.max,3);assert.equal(options.connectionTimeoutMillis,3000);assert.equal(options.query_timeout,5000);
  assert.equal(pool.listenerCount('error'),1);assert.doesNotThrow(()=>pool.emit('error',Error('offline')));
  await assert.rejects(store.status(),{code:'OWNER_TRIAL_STORAGE_UNAVAILABLE'});assert.equal(loads,1);
});
test('Owner trial rejects injected prebuilt unbounded pool and can retry failed driver setup',async()=>{
  let loads=0;const store=configuredOwnerTrial({enabled:true,accountId:'fixture',connectionString:url,
    clientFactory:async()=>{loads++;return {connect(){throw Error('must not connect');},query(){}};}});
  await assert.rejects(store.status(),{code:'OWNER_TRIAL_STORAGE_UNAVAILABLE'});
  await assert.rejects(store.status(),{code:'OWNER_TRIAL_STORAGE_UNAVAILABLE'});assert.equal(loads,2);
});
