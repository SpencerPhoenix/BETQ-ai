import test from 'node:test';import assert from 'node:assert/strict';
import {createOfficialResultFeed,OFFICIAL_RESULT_LEDGER_URL} from '../src/official-result-feed.mjs';
import {emptyOfficialResultLedger} from '../src/official-result-ledger.mjs';
const now=Date.parse('2026-11-17T18:00:00.000Z');
test('official durable feed reads only fixed public source, coalesces and preserves safe outage fallback',async()=>{
 let at=now,calls=0,offline=false;const ledger=emptyOfficialResultLedger();
 const feed=createOfficialResultFeed({clock:()=>at,fetchImpl:async(url,options)=>{calls++;assert.equal(url,OFFICIAL_RESULT_LEDGER_URL);assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);if(offline)throw Error('offline');return new Response(JSON.stringify(ledger));}});
 const [a,b]=await Promise.all([feed.get(),feed.get()]);assert.equal(calls,1);assert.equal(a.available,true);assert.deepEqual(a.ledger,b.ledger);
 a.ledger.entries.push({bad:true});assert.equal((await feed.get()).ledger.entries.length,0);
 at+=60001;offline=true;const cached=await feed.get();assert.equal(cached.available,true);assert.equal(cached.refreshFailed,true);assert.equal(calls,2);await feed.get();assert.equal(calls,2);
});
test('invalid remote history suppresses cached grades until valid append-only history returns',async()=>{
 let at=now,bad=false;const ledger=emptyOfficialResultLedger();const feed=createOfficialResultFeed({clock:()=>at,fetchImpl:async()=>new Response(JSON.stringify(bad?{...ledger,entries:[{bad:true}]}:ledger))});
 assert.equal((await feed.get()).available,true);at+=60001;bad=true;assert.equal((await feed.get()).available,false);
 bad=false;assert.equal((await feed.get()).available,true);
});
test('known ledger deletion is not a transient outage fallback',async()=>{
 let at=now,status=200;const ledger=emptyOfficialResultLedger(),feed=createOfficialResultFeed({clock:()=>at,fetchImpl:async()=>new Response(JSON.stringify(ledger),{status})});
 assert.equal((await feed.get()).available,true);at+=60001;status=404;
 assert.equal((await feed.get()).reason,'OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN');
 status=503;assert.equal((await feed.get()).available,false);
 status=200;assert.equal((await feed.get()).available,true);
});
