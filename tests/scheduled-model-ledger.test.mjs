import test from 'node:test';import assert from 'node:assert/strict';
import {syntheticDeliveryArtifact} from './fixtures/model-delivery.mjs';
import {evaluateOnDemandGame} from '../src/on-demand-game.mjs';
import {emptyModelLedger,reserveModelGames,appendModelCapture,confirmModelPublication,modelLedgerSummary,validateModelLedger,assertLedgerAppend,ledgerEvent,NFLVERSE_SCHEDULE,sameOfficialFinal} from '../src/scheduled-model-ledger.mjs';
const now=Date.parse('2026-11-17T00:00:00.000Z'),iso=n=>new Date(n).toISOString(),id='2026_10_LAC_BAL';
const artifact=syntheticDeliveryArtifact('2026-11-16T21:00:00.000Z','2026-11-15');
const game=()=>({gameId:id,providerGameId:'official-1',season:2026,week:10,home:'BAL',away:'LAC',kickoff:iso(now+75*60000),gameDate:'2026-11-16',neutralSite:false,scheduleStatus:'SCHEDULED',summaryPhase:'PREGAME',final:false,homeScore:null,awayScore:null});
const receipt=()=>({observedAt:iso(now-1000),sourceUrl:'https://www.nfl.com/scores/2026/week-10',sourceBodySha256:'a'.repeat(64),games:[game()]});
function reserved(){return reserveModelGames(emptyModelLedger(now-2*3600000),[receipt()],{now,runKey:'1.1'});}
function captured(){const l=reserved(),r=evaluateOnDemandGame(id,{artifact,now:now+2000,schedule:{available:true,receipt:receipt()}});return appendModelCapture(l,id,r,{artifact,requestStartedAt:iso(now+1000),receivedAt:iso(now+3000),runKey:'1.1'});}
const confirmed=()=>confirmModelPublication(captured(),{remoteCommit:'a'.repeat(40),serverDate:iso(now+4000),now:now+4000});
test('Fixed90–45 window reserves all admissible official fixtures once, never retrospectively',()=>{
 const l=reserved();assert.equal(l.events.filter(e=>e.type==='RESERVED').length,1);
 const again=reserveModelGames(l,[receipt()],{now:now+1000,runKey:'2.1'});assert.equal(again.events.filter(e=>e.type==='RESERVED').length,1);assert.equal(modelLedgerSummary(again,now+1000).games[0].status,'RESERVATION_UNRESOLVED');
 const r=receipt();r.games[0].kickoff=iso(now+44*60000);assert.equal(modelLedgerSummary(reserveModelGames(emptyModelLedger(now-3600000),[r],{now,runKey:'1.1'}),now).games[0].status,'WINDOW_ELAPSED');
 assert.equal(modelLedgerSummary(reserveModelGames(emptyModelLedger(now),[r],{now,runKey:'1.1'}),now).games[0].status,'POLICY_STARTED_AFTER_WINDOW');
 r.games[0].kickoff=iso(now+91*60000);assert.equal(reserveModelGames(emptyModelLedger(now),[r],{now,runKey:'1.1'}).events.filter(e=>e.type==='RESERVED').length,0);
});
test('Capture requires original reservation run, frozen artifact and unchanged official provider identity',()=>{
 const r=evaluateOnDemandGame(id,{artifact,now:now+2000,schedule:{available:true,receipt:receipt()}}),opts={artifact,requestStartedAt:iso(now+1000),receivedAt:iso(now+3000),runKey:'2.1'};
 assert.throws(()=>appendModelCapture(reserved(),id,r,opts));opts.runKey='1.1';r.fixture.providerGameId='other';assert.throws(()=>appendModelCapture(reserved(),id,r,opts));
 const l=captured();validateModelLedger(l);assert.equal(modelLedgerSummary(l,now+3000).games[0].status,'CAPTURED_CUSTODY_UNCONFIRMED');assert.throws(()=>appendModelCapture(l,id,r,opts));
});
test('Remote receipt custody needs fresh server Date before kickoff, not commit authored time',()=>{
 const l=captured();assert.throws(()=>confirmModelPublication(l,{remoteCommit:'a'.repeat(40),serverDate:iso(now-300000),now}));
 const after=confirmModelPublication(l,{remoteCommit:'a'.repeat(40),serverDate:iso(now+76*60000),now:now+76*60000});assert.equal(after.events.filter(e=>e.type==='CUSTODY').length,0);
 const c=confirmed();assert.equal(modelLedgerSummary(c,now+5000).games[0].status,'REMOTE_PREGAME_CUSTODY_RECORDED');assert.equal(c.events.at(-1).payload.timestampBasis,'GITHUB_DATE_UPPER_BOUND_1S');
});
function final(l,homeScore=20,awayScore=10){const at=now+5*3600000,g={...game(),final:true,summaryPhase:'FINAL',homeScore,awayScore};ledgerEvent(l,'FINAL',id,{officialGame:g,officialSource:{url:receipt().sourceUrl,bodySha256:'b'.repeat(64),observedAt:iso(at-1000)},nflverse:{url:NFLVERSE_SCHEDULE,bodySha256:'c'.repeat(64),receivedAt:iso(at-1000),gameId:id,home:'BAL',away:'LAC',date:g.gameDate,homeScore,awayScore}},at);return l;}
test('Only custody-confirmed frozen probabilities can receive separately labeled provisional two-source grades',()=>{
 assert.throws(()=>validateModelLedger(final(captured())));
 const l=final(confirmed());validateModelLedger(l);const s=modelLedgerSummary(l,now+5*3600000);assert.equal(s.games[0].grade.pickWon,true);assert.equal(s.qualifiedScoringEligible,false);assert.equal(s.verifiedROI,null);
 const tie=modelLedgerSummary(final(confirmed(),20,20),now+5*3600000);assert.equal(tie.games[0].grade.pickWon,null);assert.equal(tie.games[0].grade.brier,null);assert.equal(tie.games[0].grade.logLoss,null);
});
test('Outcome and artifact revisions cannot rewrite original capture or delete history',()=>{
 const l=confirmed(),changed=structuredClone(l);changed.events[0].payload.runKey='9.9';assert.throws(()=>assertLedgerAppend(l,changed));
 const f=final(structuredClone(l));assertLedgerAppend(l,f);const revised=final(structuredClone(f),10,20);assertLedgerAppend(f,revised);assert.equal(modelLedgerSummary(revised).games[0].grade.revisions,2);
 const bad=final(confirmed());bad.events.at(-1).payload.officialGame.kickoff=iso(now+76*60000);assert.throws(()=>validateModelLedger(bad));
});
test('Late reservation with no capture remains an explicit missed slot rather than a new forecast',()=>{
 const l=reserveModelGames(reserved(),[receipt()],{now:now+180000,runKey:'2.1'});const r=evaluateOnDemandGame(id,{artifact,now:now+180000,schedule:{available:true,receipt:{...receipt(),observedAt:iso(now+180000)}}});
 assert.throws(()=>appendModelCapture(l,id,r,{artifact,requestStartedAt:iso(now+180000),receivedAt:iso(now+180001),runKey:'2.1'}));
});
test('Known final conflict withholds prior grade until a new corroborated final observation resolves it',()=>{
 const l=final(confirmed()),at=now+6*3600000;ledgerEvent(l,'RESULT_CONFLICT',id,{reason:'FINAL_SOURCES_DISAGREE_OR_MISSING'},at);validateModelLedger(l);
 assert.equal(modelLedgerSummary(l,at).games[0].grade,null);
 ledgerEvent(l,'RUN',null,{runKey:'3.1',failedWeeks:[],resultConflicts:[]},at+1000);assert.equal(modelLedgerSummary(l,at+1000).games[0].grade,null);
 const payload=structuredClone(l.events.find(e=>e.type==='FINAL').payload);payload.officialSource.observedAt=iso(at+2000);payload.nflverse.receivedAt=iso(at+2000);ledgerEvent(l,'FINAL',id,payload,at+3000);validateModelLedger(l);assert.notEqual(modelLedgerSummary(l,at+3000).games[0].grade,null);
});

test('Final no-op comparison cannot skip venue, identity or date corrections',()=>{
 const a={...game(),final:true,summaryPhase:'FINAL',homeScore:20,awayScore:10};
 assert.equal(sameOfficialFinal(a,{...a}),true);
 for(const [key,value] of Object.entries({neutralSite:true,home:'NYG',away:'PHI',gameDate:'2026-11-17',providerGameId:'other',kickoff:iso(now+76*60000)}))assert.equal(sameOfficialFinal(a,{...a,[key]:value}),false,key);
 const l=final(confirmed()),candidate=structuredClone(l),payload=structuredClone(l.events.at(-1).payload);payload.officialGame.neutralSite=true;ledgerEvent(candidate,'FINAL',id,payload,now+6*3600000);assert.throws(()=>assertLedgerAppend(l,candidate));
 ledgerEvent(l,'RESULT_CONFLICT',id,{reason:'FINAL_IDENTITY_OR_KICKOFF_CONFLICT'},now+6*3600000);assert.equal(modelLedgerSummary(l).games[0].grade,null);
});


test('cold-start health delay crossing reservation cutoff records a miss, never a late reservation',()=>{
 const r=receipt();r.games[0].kickoff=iso(now+45*60000+30000);
 const l=reserveModelGames(emptyModelLedger(now-3600000),[r],{now:now+60000,runKey:'1.1'});
 assert.equal(l.events.filter(e=>e.type==='RESERVED').length,0);
 assert.equal(l.events.find(e=>e.type==='MISSED').payload.reason,'WINDOW_ELAPSED');
});

test('incompatible release records known closed windows, not in-window misses or reservations',()=>{
 const source=receipt(),first=emptyModelLedger(now-3600000);
 const blocked=at=>reserveModelGames(first,[{...source,observedAt:iso(at)}],{now:at,runKey:'1.1',allowReservations:false});
 const close=Date.parse(source.games[0].kickoff)-45*60000;
 assert.deepEqual(blocked(close).events.filter(e=>e.gameId===id),[]);
 const late=blocked(close+1),miss=late.events.find(e=>e.gameId===id);
 assert.equal(miss.type,'MISSED');
 assert.equal(miss.payload.reason,'WINDOW_ELAPSED');
 assert.equal(late.events.filter(e=>e.gameId===id).length,1);
 assert.equal(reserveModelGames(late,[{...source,observedAt:iso(close+1)}],{now:close+1,runKey:'2.1'}).events.filter(e=>e.gameId===id).length,1);
 assert.equal(reserveModelGames(first,[source],{now,runKey:'1.1'}).events.find(e=>e.gameId===id).type,'RESERVED');
});
