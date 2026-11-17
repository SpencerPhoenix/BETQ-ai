import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {emptyOfficialResultLedger,appendOfficialResultObservations} from '../src/official-result-ledger.mjs';
import {gradeGamesWithOfficialFinals} from '../src/official-game-grades.mjs';
import {parseOfficialWeeklyPage} from '../src/nfl-official-finality.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';import {emptyJournal} from '../src/evidence.mjs';
const at=Date.parse('2026-11-17T18:00:00.000Z');
function fixture(){const j={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};j.snapshots[0].gameId=j.settlements[0].gameId='2026_09_LV_KC';return j;}
function receipt({now=at,final=true,homeScore=27}={}){
 const g={id:'synthetic-provider',season:2026,week:9,seasonType:'REG',status:'SCHEDULED',time:'2026-11-08T18:00:00.000Z',neutralSite:false,
 homeTeam:{id:'h',fullName:'Kansas City Chiefs'},awayTeam:{id:'a',fullName:'Las Vegas Raiders'},summary:{gameId:'synthetic-provider',phase:final?'FINAL':'LIVE',quarter:final?'END_OF_GAME':'Q4',homeTeam:{teamId:'h',score:{total:homeScore}},awayTeam:{teamId:'a',score:{total:17}}}};
 const state={queries:[{queryKey:['useFetchFootballWeeklyGameDetails',{season:'2026',week:9,seasonType:'REG'}],state:{status:'success',data:[g]}}]};
 return parseOfficialWeeklyPage('<script>self.__next_f.push('+JSON.stringify([1,'2b:'+JSON.stringify(['$','component',null,{state}])+'\n'])+')</script>',{season:2026,week:9,sourceUrl:'https://www.nfl.com/scores/2026/week-9',observedAt:new Date(now).toISOString()});
}
const offline={getWeek:async()=>({available:false})};
const ui={};vm.runInNewContext(readFileSync(new URL('../public/game-grades.js',import.meta.url),'utf8'),ui);
test('saved official final survives later source outage without changing original journal or aggregate',async()=>{
 const j=fixture(),before=JSON.stringify(j),ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at});
 const r=await gradeGamesWithOfficialFinals(j,offline,{clock:()=>at+86400000,durableLedger:ledger});
 assert.equal(r.coverage.gradedGames,1);assert.equal(r.officialFinals.savedGrades,1);assert.equal(r.games[0].result.verifiedAt,new Date(at).toISOString());
 assert.equal(r.games[0].result.aggregateScoringEligible,false);assert.equal(r.games[0].officialPersistence.usingSavedObservation,true);assert.equal(JSON.stringify(j),before);assert.equal(ui.BETQGameGrades.valid(r),true);assert.match(ui.BETQGameGrades.html(r),/Showing the saved official observation/);
});
test('newly saved withdrawn-final and score conflicts suppress older durable wins',async()=>{
 for(const options of [{final:false},{homeScore:14}]){
  const j=fixture();let ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at});
  ledger=appendOfficialResultObservations(ledger,j,[receipt({...options,now:at+60000})],{now:at+60000});
  const r=await gradeGamesWithOfficialFinals(j,offline,{clock:()=>at+86400000,durableLedger:ledger});assert.equal(r.coverage.gradedGames,0);assert.equal(r.games[0].metrics,null);
 }
});
test('fresh identity-matched finals take priority without losing saved-result disclosure',async()=>{
 const j=fixture(),ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at});
 const r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:receipt({now:at+60000})})},{clock:()=>at+60000,durableLedger:ledger});
 assert.equal(r.games[0].officialPersistence.saved,true);assert.equal(r.games[0].officialPersistence.usingSavedObservation,false);assert.equal(r.games[0].result.verifiedAt,new Date(at+60000).toISOString());
});
test('fresh provider identity cannot bypass a saved structural conflict',async()=>{
 const j=fixture(),a=receipt();let ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[a],{now:at});
 const changed=receipt({now:at+60000});changed.games[0].providerGameId='changed-provider';ledger=appendOfficialResultObservations(ledger,j,[changed],{now:at+60000});
 const r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:changed})},{clock:()=>at+60000,durableLedger:ledger});assert.equal(r.coverage.gradedGames,0);assert.ok(r.games[0].reasons.includes('SAVED_OFFICIAL_IDENTITY_CONFLICT'));
});
test('fresh conflict remains withheld through subsequent source outage until newer valid resolution',async()=>{
 const j=fixture(),ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at}),memory=new Map();
 const changed=receipt({now:at+60000,homeScore:14});
 let r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:changed})},{clock:()=>at+60000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
 r=await gradeGamesWithOfficialFinals(j,offline,{clock:()=>at+86400000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
 const resolved=receipt({now:at+86400000});r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:resolved})},{clock:()=>at+86400000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,1);
});
test('invalid durable history cannot silently become a fresh live-only grade',async()=>{
 const j=fixture(),live={getWeek:async()=>({available:true,receipt:receipt()})};
 assert.equal((await gradeGamesWithOfficialFinals(j,live,{clock:()=>at,durableLedger:{bad:true}})).available,false);
 assert.equal((await gradeGamesWithOfficialFinals(j,live,{clock:()=>at,durableStatus:{reason:'OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN'}})).available,false);
});
test('fresh corrected score without a retained settlement cannot revive the old saved winner on outage',async()=>{
 const j=fixture();j.settlements=[];const ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at}),memory=new Map();
 const changed=receipt({now:at+60000,homeScore:14});
 let r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:changed})},{clock:()=>at+60000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
 r=await gradeGamesWithOfficialFinals(j,offline,{clock:()=>at+86400000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
});
test('fresh absent final summary withholds a saved final rather than reviving it after outage',async()=>{
 const j=fixture(),ledger=appendOfficialResultObservations(emptyOfficialResultLedger(),j,[receipt()],{now:at}),memory=new Map();const changed=receipt({now:at+60000,final:false});
 changed.games[0].summaryPhase=null;changed.games[0].summaryQuarter=null;changed.games[0].summaryState='ABSENT';
 let r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt:changed})},{clock:()=>at+60000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
 r=await gradeGamesWithOfficialFinals(j,offline,{clock:()=>at+86400000,durableLedger:ledger,conflictMemory:memory});assert.equal(r.coverage.gradedGames,0);
});
