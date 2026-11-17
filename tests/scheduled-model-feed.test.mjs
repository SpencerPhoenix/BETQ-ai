import test from 'node:test';import assert from 'node:assert/strict';
import {createScheduledModelFeed,MODEL_LEDGER_URL} from '../src/scheduled-model-feed.mjs';
import {emptyModelLedger,ledgerEvent} from '../src/scheduled-model-ledger.mjs';
const now=Date.parse('2026-11-17T00:00:00.000Z');
function ledger(){const l=emptyModelLedger(now-10000);ledgerEvent(l,'RUN',null,{runKey:'1.1',failedWeeks:[]},now-1000);return l;}
test('Only fixed public scheduled ledger is read; cache preserves source time and flags missed heartbeat',async()=>{
 let at=now,calls=0;const feed=createScheduledModelFeed({clock:()=>at,fetchImpl:async(url,options)=>{calls++;assert.equal(url,MODEL_LEDGER_URL);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(JSON.stringify(ledger()));}});
 const r=await feed.get();assert.equal(r.available,true);assert.equal(r.publicationReadbackVerified,true);assert.equal(r.qualifiedScoringEligible,false);await feed.get();assert.equal(calls,1);
 at=now+31*60000;assert.equal((await feed.get()).schedulerStale,true);
});
test('Malformed, future and unavailable remote ledgers never become a saved claim',async()=>{
 for(const body of [{}, {...ledger(),events:[{...ledger().events[0],at:new Date(now+50000).toISOString()}]}]){
  const f=createScheduledModelFeed({clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(body))});assert.equal((await f.get()).publicationReadbackVerified,false);
 }
 const f=createScheduledModelFeed({clock:()=>now,fetchImpl:null});assert.equal((await f.get()).available,false);
});
