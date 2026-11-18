import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {configuredOwnerSessionStores} from '../src/configured-owner-session.mjs';
const connectionString='postgresql://fixture:fixture_password@localhost/fixture';
test('Owner auth factory is disabled without reading ambient configuration or loading driver',async()=>{
 let loads=0;const stores=configuredOwnerSessionStores({ownerId:'owner',connectionString,clientFactory:()=>{loads++;}});
 await assert.rejects(stores.sessionStore.readAndTouch({}),{code:'OWNER_AUTH_STORAGE_DISABLED'});
 await assert.rejects(stores.rateStore.consume({}),{code:'OWNER_AUTH_STORAGE_DISABLED'});assert.equal(loads,0);
});
test('Owner auth factory rejects URL overrides and malformed owner before driver use',async()=>{
 let loads=0;for(const settings of [{ownerId:'owner',connectionString:connectionString+'?sslmode=disable'},{ownerId:'bad\nowner',connectionString}]){
  const stores=configuredOwnerSessionStores({enabled:true,...settings,clientFactory:()=>{loads++;}});
  await assert.rejects(stores.rateStore.consume({}),error=>{assert.equal(error.code,'OWNER_AUTH_STORAGE_CONFIG_INVALID');assert.doesNotMatch(error.message,/fixture_password|sslmode/);return true;});
 }assert.equal(loads,0);
});
test('Owner auth factory shares bounded verified TLS pool across both durable adapters',async()=>{
 let pool,options,loads=0;
 class Pool extends EventEmitter{constructor(input){super();pool=this;options=input;}async connect(){throw Error('fixture_password');}}
 const stores=configuredOwnerSessionStores({enabled:true,ownerId:'owner',connectionString,clientFactory:async()=>{loads++;return {Pool};}});
 await assert.rejects(stores.sessionStore.revoke({sessionHash:'a'.repeat(64),userId:'owner'}));
 await assert.rejects(stores.rateStore.consume({scope:'owner-login',key:'global',limit:5,windowMs:60000}));
 assert.equal(loads,1);assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.connectionString,undefined);
 assert.equal(options.max,3);assert.equal(options.connectionTimeoutMillis,3000);assert.equal(options.query_timeout,5000);
 assert.equal(pool.listenerCount('error'),1);assert.doesNotThrow(()=>pool.emit('error',Error('offline')));
});
