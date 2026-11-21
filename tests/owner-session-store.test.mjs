import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerSessionStores} from '../src/owner-session-store.mjs';
const record={userId:'owner',sessionHash:'a'.repeat(64),csrfToken:'b'.repeat(43),createdAt:1000,lastSeenAt:1000,expiresAt:901000,revoked:false};
test('durable session stores disabled by default and reject unbounded rate identities before DB',async()=>{
 let calls=0;const pool={connect(){calls++;throw Error('private credential');}};
 const disabled=createOwnerSessionStores({pool,ownerId:'owner'});
 await assert.rejects(disabled.sessionStore.replaceOwner(record),{code:'OWNER_SESSION_STORAGE_UNAVAILABLE'});
 const enabled=createOwnerSessionStores({pool,ownerId:'owner',enabled:true});
 for(const bad of [{scope:'other',key:'global',limit:5,windowMs:60000},{scope:'owner-login',key:'random-ip',limit:5,windowMs:60000},{scope:'owner-login',key:'global',limit:6,windowMs:60000}])assert.throws(()=>enabled.rateStore.consume(bad));
 assert.equal(calls,0);
});
test('invalid session records, identity mismatches and idle overrides never connect',()=>{
 const pool={connect(){throw Error('must not connect');}},s=createOwnerSessionStores({enabled:true,pool,ownerId:'owner'}).sessionStore;
 for(const patch of [{createdAt:-1},{expiresAt:901001},{lastSeenAt:999},{userId:'other'},{revoked:true},{sessionHash:'cookie'}])assert.throws(()=>s.replaceOwner({...record,...patch}),{code:'OWNER_SESSION_STORAGE_UNAVAILABLE'});
 assert.throws(()=>s.readAndTouch({sessionHash:record.sessionHash,now:1000,idleMs:600000}));
 assert.throws(()=>s.revoke({sessionHash:record.sessionHash,userId:'other'}));
});
test('connection errors are sanitized without echoing database secrets',async()=>{
 const s=createOwnerSessionStores({enabled:true,ownerId:'owner',pool:{async connect(){throw Error('postgres://private-secret');}}});
 await assert.rejects(s.sessionStore.replaceOwner(record),e=>e.code==='OWNER_SESSION_STORAGE_UNAVAILABLE'&&!e.message.includes('secret'));
});
