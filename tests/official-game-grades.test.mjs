import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {gradeGamesWithOfficialFinals} from '../src/official-game-grades.mjs';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {emptyJournal} from '../src/evidence.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {OFFICIAL_FINALITY_POLICY} from '../src/nfl-official-finality.mjs';
const now=Date.parse('2026-11-17T18:00:00.000Z');
const context={};vm.runInNewContext(readFileSync(new URL('../public/game-grades.js',import.meta.url),'utf8'),context);const UI=context.BETQGameGrades;
function fixture(){
 const j={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};
 j.snapshots[0].gameId=j.settlements[0].gameId='2026_09_LV_KC';
 const s=j.snapshots[0];
 const receipt={schema:1,policy:OFFICIAL_FINALITY_POLICY,season:2026,week:9,sourceUrl:'https://www.nfl.com/scores/2026/week-9',observedAt:new Date(now).toISOString(),sourceBodySha256:'a'.repeat(64),aggregateScoringEligible:false,
 games:[{gameId:s.gameId,season:2026,week:9,home:s.home,away:s.away,kickoff:s.commenceTime,gameDate:s.gameDate,final:true,summaryPhase:'FINAL',summaryQuarter:'END_OF_GAME',homeScore:27,awayScore:17}]};
 return {j,receipt};
}
const run=(j,receipt)=>gradeGamesWithOfficialFinals(j,{getWeek:async()=>({available:true,receipt})},{clock:()=>now});
test('official final grades original frozen pick, leaves journal and aggregate gates unchanged',async()=>{
 const {j,receipt}=fixture(),before=JSON.stringify(j);const r=await run(j,receipt);
 assert.equal(r.coverage.officialGradedGames,1);assert.equal(r.games[0].metrics.modelCorrect,true);assert.equal(r.games[0].result.aggregateScoringEligible,false);
 assert.equal(JSON.stringify(j),before);assert.equal(gradeRetainedGames(j,{now}).coverage.gradedGames,0);
 assert.equal(UI.valid(r),true);assert.match(UI.html(r),/Official NFL final score/);assert.match(UI.html(r),/NFL result source/);
});
test('missing retained outcome can gain a sourced grade, never a reconstructed pick',async()=>{
 const {j,receipt}=fixture();j.settlements=[];let r=await run(j,receipt);assert.equal(r.games[0].status,'GRADED');assert.equal(r.coverage.recordedResults,0);assert.equal(r.coverage.availableFinalScores,1);
 delete j.snapshots[0].modelLastResultDate;r=await run(j,receipt);assert.equal(r.games[0].metrics,null);assert.equal(r.games[0].result.homeScore,27);
});
test('conflicting identity and final score withhold metrics rather than rewriting history',async()=>{
 for(const mutate of [r=>r.games[0].kickoff='2026-11-08T18:05:00.000Z',r=>r.games[0].home='BAL',r=>r.games[0].homeScore=14]){
  const {j,receipt}=fixture();mutate(receipt);const r=await run(j,receipt);assert.equal(r.games[0].status,'UNGRADED');assert.equal(r.games[0].metrics,null);assert.equal(r.games[0].officialResultCheck.status,'CONFLICT');
 }
});
test('stale future forged incomplete and ambiguous observations cannot supply grades',async()=>{
 for(const mutate of [r=>r.observedAt=new Date(now-300000).toISOString(),r=>r.observedAt=new Date(now+1).toISOString(),r=>r.sourceUrl='https://evil.test',r=>r.sourceBodySha256='bad',r=>r.aggregateScoringEligible=true,r=>r.games.push({...r.games[0]}),r=>r.games[0].summaryQuarter='Q4',r=>r.games[0].summaryPhase='LIVE',r=>r.games[0].homeScore='27']){
  const {j,receipt}=fixture();mutate(receipt);assert.equal((await run(j,receipt)).coverage.gradedGames,0);
 }
});
test('tie and no-direction forecasts do not invent wins',async()=>{
 const {j,receipt}=fixture();j.settlements=[];receipt.games[0].awayScore=27;let r=await run(j,receipt);assert.equal(r.games[0].status,'TIE_EXCLUDED');assert.equal(r.games[0].metrics,null);assert.equal(UI.valid(r),true);
 receipt.games[0].awayScore=17;j.snapshots[0].modelHomeProbability=.5;r=await run(j,receipt);assert.equal(r.games[0].metrics.modelCorrect,null);
});
test('provider failure retains honest original result state',async()=>{
 const {j}=fixture();const r=await gradeGamesWithOfficialFinals(j,{getWeek:async()=>{throw Error('offline');}},{clock:()=>now});assert.equal(r.games[0].status,'UNGRADED');assert.equal(r.officialFinals.availableWeeks,0);
});
test('fresh explicit nonfinal state withholds a previously qualified grade',async()=>{
 const {j,receipt}=fixture();const {withSyntheticCorroboration}=await import('./fixtures/source-corroborated.mjs');
 j.settlements[0]=withSyntheticCorroboration(j.settlements[0]);
 assert.equal(gradeRetainedGames(j,{now}).games[0].status,'GRADED');
 receipt.games[0].final=false;receipt.games[0].summaryPhase='LIVE';receipt.games[0].summaryQuarter='Q4';receipt.games[0].homeScore=receipt.games[0].awayScore=null;
 const r=await run(j,receipt);assert.equal(r.games[0].status,'UNGRADED');assert.equal(r.games[0].metrics,null);assert.equal(r.coverage.sourceCorroboratedV2GradedGames,0);
});
