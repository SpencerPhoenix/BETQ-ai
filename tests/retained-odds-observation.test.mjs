import test from 'node:test';import assert from 'node:assert/strict';
import {retainedOddsObservation} from '../src/retained-odds-observation.mjs';
const now=Date.parse('2026-11-18T19:20:00Z'),accountId='test-account',market='h2h';
const record={version:1,accountId,cacheId:'odds:americanfootball_nfl:h2h',receivedAt:new Date(now-300001).toISOString(),events:[]};
test('Saved observations disclose original time and staleness without promoting stale data',()=>{
 const x=retainedOddsObservation(record,{accountId,market,now});assert.equal(x.stale,true);assert.equal(x.receivedAt,record.receivedAt);assert.equal(x.actionable,false);assert.equal(x.rankingAllowed,false);assert.equal(x.refreshAuthorized,false);assert.match(x.label,/out of date/);assert.equal(x.quota,undefined);
 const fresh=retainedOddsObservation(record,{accountId,market,now:now-2});assert.equal(fresh.stale,false);assert.equal(fresh.actionable,false);assert.match(fresh.label,/not a live refresh/);
});
test('Missing and malformed saved records never become synthetic data',()=>{
 assert.equal(retainedOddsObservation(null,{accountId,market,now}).available,false);
 for(const bad of [{...record,receivedAt:new Date(now+1).toISOString()},{...record,accountId:'other'},{...record,rawPrice:'secret'}])assert.throws(()=>retainedOddsObservation(bad,{accountId,market,now}));
});
