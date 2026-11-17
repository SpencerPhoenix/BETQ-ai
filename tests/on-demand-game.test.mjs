import test from 'node:test';import assert from 'node:assert/strict';import {syntheticDeliveryArtifact} from './fixtures/model-delivery.mjs';
import {predictNflEvent} from '../src/nfl-elo.mjs';
import {gameScope,evaluateOnDemandGame,createOfficialGameFeed} from '../src/on-demand-game.mjs';
const artifact=syntheticDeliveryArtifact('2026-11-16T21:00:00.000Z','2026-11-15'),now=Date.parse('2026-11-16T23:00:00Z');
const expected=predictNflEvent({home_team:'Baltimore Ravens',away_team:'Los Angeles Chargers',commence_time:'2026-11-17T01:15:00Z'},artifact,now).homeWinProbability;
const gameId='2026_10_LAC_BAL',fixture={gameId,providerGameId:'fixture-provider',home:'BAL',away:'LAC',kickoff:'2026-11-17T01:15:00Z',neutralSite:false,scheduleStatus:'SCHEDULED',summaryPhase:'PREGAME',final:false};
const schedule=()=>({available:true,receipt:{observedAt:new Date(now).toISOString(),games:[{...fixture}],sourceUrl:'https://www.nfl.com/scores/2026/week-10',sourceBodySha256:'a'.repeat(64)}});
test('Current artifact evaluates an official future fixture without prices or changing history',()=>{
 const r=evaluateOnDemandGame(gameId,{schedule:schedule(),artifact,now});assert.equal(r.available,true);assert.equal(r.baseline.homeWinProbability,expected);assert.equal(r.market.available,false);assert.equal(r.market.providerCreditsUsed,0);assert.equal(r.injuryAdjusted,false);assert.equal(r.durablyArchived,false);assert.equal(r.spreadProbability,null);assert.equal(r.gradeBaselineChanged,false);
});
test('Reject invalid identity, absent fixture, expired observation and kickoff',()=>{
 for(const id of ['2026_19_LAC_BAL','2026_10_BAL_BAL','http://bad','2026_10_XYZ_BAL'])assert.throws(()=>gameScope(id));
 let s=schedule();s.receipt.games=[];assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now}).reason,'OFFICIAL_MATCHUP_NOT_FOUND');
 assert.equal(evaluateOnDemandGame(gameId,{schedule:schedule(),artifact,now:now+300001}).reason,'SCHEDULE_OBSERVATION_STALE');
 s=schedule();s.receipt.games[0].kickoff=new Date(now).toISOString();assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now}).reason,'GAME_STARTED_OR_COMPLETED');
 assert.equal(evaluateOnDemandGame(gameId,{schedule:{available:false},artifact,now}).available,false);
});
test('Feed uses fixed official URL, cache and fails closed without touching paid providers',async()=>{
 let calls=0;const feed=createOfficialGameFeed({clock:()=>now,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://www.nfl.com/scores/2026/week-10');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');throw Error('offline');}});
 assert.equal((await feed.get(gameId)).available,false);await feed.get(gameId);assert.equal(calls,1);await assert.rejects(feed.get('https://malicious.example'));
});
import http from 'node:http';import {createHandler} from '../src/server.mjs';
test('On-demand HTTP endpoint serves current model without any paid-source method',async t=>{
 let calls=0;const server=http.createServer(createHandler({clock:()=>now,nflArtifact:artifact,
 officialGameFeed:{get:async()=>schedule()},source:{status:()=>({configured:true}),get:()=>{calls++;throw Error('paid forbidden');}}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const res=await fetch(base+'/api/game-evaluation?gameId='+gameId);assert.equal(res.status,200);assert.equal((await res.json()).baseline.homeWinProbability,expected);assert.equal(calls,0);
 assert.equal((await fetch(base+'/api/game-evaluation?gameId=bad')).status,400);
 for(const path of ['/game-card','/game-card.js','/game-card.css'])assert.equal((await fetch(base+path)).status,200);
});

test('Cached schedule expiry and explicit official pregame state are preserved',()=>{
 let s=schedule();s.receipt.observedAt=new Date(now-299000).toISOString();
 const r=evaluateOnDemandGame(gameId,{schedule:s,artifact,now});assert.equal(r.validUntil,new Date(now+1000).toISOString());
 assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now:now+1000}).available,false);
 for(const [status,phase] of [['CANCELLED','PREGAME'],['POSTPONED','PREGAME'],['SCHEDULED','IN_PROGRESS'],['SCHEDULED',null]]){
  s=schedule();s.receipt.games[0].scheduleStatus=status;s.receipt.games[0].summaryPhase=phase;
  assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now}).reason,'OFFICIAL_GAME_NOT_CONFIRMED_PREGAME');
 }
});
import {discoveryWeeks,discoverUpcomingGames} from '../src/on-demand-game.mjs';
test('Discovery checks bounded official weeks and sorts verified future fixtures, not local calendar date',async()=>{
 const requested=[];const result=await discoverUpcomingGames({getWeek:async(season,week)=>{requested.push(week);const s=schedule();s.receipt.games=week===10?[{...fixture},{...fixture,gameId:'2026_10_KC_LV',home:'LV',away:'KC',kickoff:'2026-11-18T01:00:00.000Z'}]:[];return s;}},{clock:()=>now});
 assert.deepEqual(requested,[9,10,11]);assert.equal(result.games[0].gameId,'2026_10_LAC_BAL');assert.equal(result.games.length,2);assert.equal(result.providerCreditsUsed,0);assert.equal(result.scheduledGeneration,false);
 assert.equal(discoveryWeeks(Date.parse('2027-01-01T00:00:00Z')).season,2026);
 assert.deepEqual(discoveryWeeks(Date.parse('2026-07-01T00:00:00Z')).weeks,[]);
});
test('Discovery rejects started, stale, nonpregame and outside-window games, reports partial failure',async()=>{
 const feed={getWeek:async(_,week)=>{if(week===9)return {available:false};const s=schedule();s.receipt.games=[{...fixture,summaryPhase:'LIVE'},{...fixture,kickoff:new Date(now-1).toISOString()}];return s;}};
 const r=await discoverUpcomingGames(feed,{clock:()=>now});assert.equal(r.available,false);assert.deepEqual(r.failedWeeks,[9]);
 const s=schedule();s.receipt.observedAt=new Date(now-300000).toISOString();
 assert.equal((await discoverUpcomingGames({getWeek:async()=>s},{clock:()=>now})).games.length,0);
});

test('Discovery lists explicit absent-summary scheduled fixtures but never enables forecasts',async()=>{
 const s=schedule();s.receipt.games=[{...fixture,summaryPhase:null,summaryState:'ABSENT',neutralSite:true}];
 const r=await discoverUpcomingGames({getWeek:async()=>s},{clock:()=>now});
 assert.equal(r.games.length,1);assert.equal(r.games[0].forecastReady,false);assert.equal(r.games[0].neutralSite,true);
 assert.equal(r.games[0].readiness,'SCHEDULED_AWAITING_PREGAME_SUMMARY');
 assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now}).available,false);
 for(const change of [{summaryState:'MALFORMED'},{summaryState:undefined},{summaryPhase:'LIVE'},{summaryPhase:'FINAL'},{scheduleStatus:'CANCELLED'},{scheduleStatus:'POSTPONED'},{kickoff:new Date(now).toISOString()},{kickoff:'bad'},{kickoff:new Date(now+8*86400000).toISOString()}]){
  s.receipt.games=[{...fixture,summaryPhase:null,summaryState:'ABSENT',...change}];
  assert.equal((await discoverUpcomingGames({getWeek:async()=>s},{clock:()=>now})).games.length,0,JSON.stringify(change));
 }
 s.receipt.games=[{...fixture,summaryPhase:'PREGAME',summaryState:'PRESENT',neutralSite:true}];
 assert.equal((await discoverUpcomingGames({getWeek:async()=>s},{clock:()=>now})).games[0].forecastReady,true);
 assert.equal(evaluateOnDemandGame(gameId,{schedule:s,artifact,now}).available,true);
});
