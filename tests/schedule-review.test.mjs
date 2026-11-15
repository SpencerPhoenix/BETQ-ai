import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scheduledInstant,scheduleReviewFor,eventScheduleReview} from '../src/schedule-review.mjs';
import {analyzeEvents,SPORTS} from '../src/engine.mjs';
import {demoEvents} from '../src/demo.mjs';
import {buildGameDossier,listGameDossiers} from '../src/game-dossier.mjs';
const now=Date.parse('2026-11-07T20:00:00Z');
const identity={gameId:'2026_09_LV_SF',providerEventId:'ac9d38a18d5c92814233a31aa9a48d78',season:2026,home:'SF',away:'LV',gameDate:'2026-11-08',commenceTime:'2026-11-08T21:05:00.000Z'};

test('Schedule instants require explicit UTC/offset and a real calendar date',()=>{
 for(const value of [null,undefined,0,'','2026-11-08','2026-11-08T21:25:00','11/08/2026 13:25','2026-02-30T21:25:00Z','2026-11-08T24:00:00Z','2026-11-08T21:25:60Z','2026-11-08T21:25:00+24:00','2026-11-08T21:25:00+02:60'])assert.ok(Number.isNaN(scheduledInstant(value)),String(value));
 for(const value of ['2026-11-08T21:25:00Z','2026-11-08T21:25:00.000Z','2026-11-08T13:25:00-08:00','2026-11-08T16:25:00-05:00','2026-11-09T06:25:00+09:00'])assert.equal(scheduledInstant(value),Date.parse('2026-11-08T21:25:00Z'));
 assert.ok(Number.isFinite(scheduledInstant('2028-02-29T12:00:00Z')));
 assert.ok(Number.isNaN(scheduledInstant('2026-02-29T12:00:00Z')));
});
test('Fall DST repeated local hour is disambiguated by its explicit offset',()=>{
 assert.equal(scheduledInstant('2026-11-01T01:30:00-08:00')-scheduledInstant('2026-11-01T01:30:00-07:00'),3600000);
 assert.ok(Number.isNaN(scheduledInstant('2026-11-01T01:30:00')));
});
test('All supported sports, including college football, reject ambiguous kickoff timestamps',()=>{
 for(const sport of Object.keys(SPORTS)){
   const event=demoEvents(sport,now)[0];
   for(const time of ['2026-11-08','2026-11-08T13:25:00','2026-02-30T13:25:00Z'])assert.equal(analyzeEvents([{...event,commence_time:time}],{sport,asOf:now}).events.length,0,sport);
   const output=analyzeEvents([{...event,commence_time:'2026-11-08T13:25:00-08:00'}],{sport,asOf:now});
   assert.equal(output.events.length,1);assert.equal(output.events[0].kickoffSource,'PROVIDER_REPORTED_NOT_OFFICIALLY_VERIFIED');
 }
});
test('Dated official observation never rewrites or qualifies a frozen identity',()=>{
 const before=JSON.stringify(identity),r=scheduleReviewFor(identity,now);
 assert.equal(r.status,'SCHEDULE_RECONCILIATION_REQUIRED');assert.equal(r.frozenCommenceTime,identity.commenceTime);
 assert.equal(r.publishedCommenceTime,'2026-11-08T21:25:00.000Z');
 assert.equal(r.currentScheduleVerified,false);assert.equal(r.scoringAuthorization,false);
 assert.equal(JSON.stringify(identity),before);
 r.sources[0].url='https://invalid.example';assert.match(scheduleReviewFor(identity,now).sources[0].url,/49ers.com/);
});
test('Schedule notes require exact event/team/date identity and cannot appear before observation',()=>{
 for(const patch of [{home:'KC'},{away:'KC'},{season:2025},{gameDate:'2026-11-09'},{providerEventId:'other'},{gameId:'WRONG_GAME'},{providerEventIds:'not-an-array'}]){
   const r=scheduleReviewFor({...identity,...patch},now);assert.equal(r.status,'SCHEDULE_REVIEW_IDENTITY_MISMATCH');assert.equal(r.publishedCommenceTime,null);
 }
 assert.equal(scheduleReviewFor(identity,Date.parse('2026-11-07T12:00:00Z')).status,'CURRENT_SCHEDULE_UNVERIFIED');
 assert.equal(scheduleReviewFor({...identity,commenceTime:'2026-11-08T21:25:00Z'},now).status,'MATCHES_DATED_SCHEDULE_OBSERVATION');
 assert.equal(eventScheduleReview({id:identity.providerEventId,sport_key:'americanfootball_ncaaf'},now).status,'CURRENT_SCHEDULE_UNVERIFIED');
});
test('Equivalent offset timestamps bind the same official observation across a UTC date boundary',()=>{
 const base={id:identity.providerEventId,sport_key:'americanfootball_nfl',home_team:'San Francisco 49ers',away_team:'Las Vegas Raiders'};
 for(const commence_time of ['2026-11-08T21:25:00Z','2026-11-09T00:25:00+03:00','2026-11-08T13:25:00-08:00']){
   const review=eventScheduleReview({...base,commence_time},now);
   assert.equal(review.status,'MATCHES_DATED_SCHEDULE_OBSERVATION');
   assert.equal(review.frozenCommenceTime,commence_time);
   assert.equal(review.currentScheduleVerified,false);
 }
});
test('Known conflicting provider schedule cannot produce a price WATCH or theoretical stake',()=>{
 const event={...demoEvents('americanfootball_nfl',now)[0],id:identity.providerEventId,sport_key:'americanfootball_nfl',home_team:'San Francisco 49ers',away_team:'Las Vegas Raiders',commence_time:identity.commenceTime};
 // Align the synthetic bookmaker outcome names to this exact fixture identity.
 for(const book of event.bookmakers)for(const market of book.markets)if(market.key==='h2h')market.outcomes.forEach((o,i)=>o.name=i===0?event.home_team:event.away_team);
 const result=analyzeEvents([event],{sport:'americanfootball_nfl',asOf:now});
 assert.equal(result.events[0].scheduleReview.status,'SCHEDULE_RECONCILIATION_REQUIRED');
 assert.ok(result.events[0].opportunities.length>0);
 for(const pick of result.events[0].opportunities){assert.equal(pick.status,'PASS');assert.equal(pick.theoreticalUnits,0);assert.ok(pick.reasons.includes('SCHEDULE_RECONCILIATION_REQUIRED'));}
});
test('Real LV-SF dossier quarantines all nine original observations without reconciling their kickoffs',()=>{
 const journal=JSON.parse(readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url))),before=JSON.stringify(journal);
 const readAt=Date.parse('2026-11-16T12:00:00.000Z');
 const result=buildGameDossier(journal,{gameId:identity.gameId,now:readAt});assert.equal(result.available,false);
 assert.equal(result.reason,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(result.conflict.history.total,9);
 assert.equal(result.conflict.firstFrozenCommenceTime,identity.commenceTime);
 assert.equal(result.conflict.history.snapshots.filter(s=>s.commenceTime===identity.commenceTime).length,7);
 assert.equal(result.conflict.history.snapshots.filter(s=>s.commenceTime==='2026-11-08T21:25:00.000Z').length,2);
 assert.equal(result.conflict.scoringEligible,false);assert.equal(result.result,undefined);
 // The dated published-time note remains separate and never authorizes scoring.
 assert.equal(scheduleReviewFor(identity,readAt).publishedCommenceTime,'2026-11-08T21:25:00.000Z');
 assert.equal(scheduleReviewFor(identity,readAt).scoringAuthorization,false);
 const index=listGameDossiers(journal,{now:readAt});assert.equal(index.available,true);assert.equal(index.games.length,43);
 assert.equal(index.games.some(g=>g.gameId===identity.gameId),false);assert.equal(JSON.stringify(journal),before);
});
