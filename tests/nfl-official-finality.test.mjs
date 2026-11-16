import test from 'node:test';import assert from 'node:assert/strict';
import {parseOfficialWeeklyPage,reconcileTrainingFinality,assertTrainingFinalityCoverage} from '../src/nfl-official-finality.mjs';
const context={season:2026,week:10,observedAt:'2026-11-16T20:00:00.000Z',sourceUrl:'https://www.nfl.com/scores/2026/week-10'};
const game=()=>({id:'provider-1',season:2026,seasonType:'REG',week:10,time:'2026-11-13T01:15:00Z',neutralSite:false,status:'SCHEDULED',homeTeam:{id:'h',fullName:'New York Giants'},awayTeam:{id:'a',fullName:'Washington Commanders'},summary:{gameId:'provider-1',phase:'FINAL',quarter:'END_OF_GAME',homeTeam:{teamId:'h',score:{total:21}},awayTeam:{teamId:'a',score:{total:24}}}});
const html=(games=[game()],scope={season:'2026',week:10,seasonType:'REG'})=>{
 const state={queries:[{queryKey:['useFetchFootballWeeklyGameDetails',scope],state:{status:'success',data:games}}]};
 const payload='2b:'+JSON.stringify(['$','component',null,{state}])+'\n';
 return '<script>self.__next_f.push('+JSON.stringify([1,payload])+')</script>';
};
const training=()=>({id:'2026_10_WAS_NYG',season:2026,week:10,home:'NYG',away:'WAS',date:'2026-11-12',homeScore:21,awayScore:24,neutral:false});
const options={season:2026,weeks:[10],asOf:'2026-11-16T20:01:00.000Z'};
const receipt=()=>parseOfficialWeeklyPage(html(),context);
test('Official page parser reads JSON only and binds summary teams/finality to game identity',()=>{
 const r=receipt();assert.equal(r.games[0].final,true);assert.equal(r.games[0].gameDate,'2026-11-12');assert.equal(r.games[0].homeScore,21);
 assert.equal(r.sourcePublishedAt,null);assert.equal(r.sourceUpstreamIndependenceVerified,false);assert.equal(r.aggregateScoringEligible,false);
 assert.equal(r.games[0].kickoff,'2026-11-13T01:15:00.000Z');
 const injection='<script>globalThis.__bad=1</script>'+html();parseOfficialWeeklyPage(injection,context);assert.equal(globalThis.__bad,undefined);
});
test('Official parser rejects malformed scope, ambiguous queries, partial finality, score/team conflicts',()=>{
 for(const mutate of [g=>g.summary.phase='LIVE',g=>g.summary.quarter='Q4',g=>g.summary.homeTeam.teamId='a',g=>g.summary.homeTeam.score.total=-1,g=>g.summary.gameId='wrong',g=>g.status='POSTPONED',g=>g.neutralSite='false',g=>g.homeTeam.fullName='Unknown',g=>g.time='bad']){
  const g=game();mutate(g);assert.throws(()=>parseOfficialWeeklyPage(html([g]),context));
 }
 assert.throws(()=>parseOfficialWeeklyPage(html([game(),game()]),context));
 assert.throws(()=>parseOfficialWeeklyPage(html()+html(),context));
 assert.throws(()=>parseOfficialWeeklyPage(html([game()],{season:'2025',week:10,seasonType:'REG'}),context));
 assert.throws(()=>parseOfficialWeeklyPage(html(),{...context,sourceUrl:'https://evil.test'}));
 assert.throws(()=>parseOfficialWeeklyPage('x'.repeat(8000001),context));
});
test('Pregame games remain nonfinal and never inherit zero-score completion',()=>{
 const g=game();g.time='2026-11-17T01:15:00Z';g.summary.phase='PREGAME';g.summary.quarter='Q1';
 const r=parseOfficialWeeklyPage(html([g]),context);assert.equal(r.games[0].final,false);assert.equal(r.games[0].homeScore,null);
 assert.equal(reconcileTrainingFinality([training()],[r],options).available,false);
});
test('Coverage matches official finals both directions with per-team bounded scope',()=>{
 const r=assertTrainingFinalityCoverage([training()],[receipt()],options);assert.equal(r.available,true);assert.equal(r.matchedFinalGames,1);
 assert.deepEqual(r.teams.NYG,{observedScheduled:1,observedFinal:1,matchedFinal:1});
 assert.equal(r.completeLeagueCoverageVerified,false);assert.equal(r.sourceUpstreamIndependenceVerified,false);
 assert.throws(()=>assertTrainingFinalityCoverage([],[receipt()],options),/OFFICIAL_FINAL_MISSING/);
 assert.throws(()=>assertTrainingFinalityCoverage([training()],[],options),/MISSING_WEEK/);
 assert.throws(()=>assertTrainingFinalityCoverage([training()],[receipt(),receipt()],options),/AMBIGUOUS/);
 for(const mutate of [g=>g.homeScore++,g=>g.neutral=true,g=>g.date='2026-11-13']){
  const g=training();mutate(g);assert.equal(reconcileTrainingFinality([g],[receipt()],options).available,false);
 }
});
test('Current observations cannot certify historical training time or masquerade as independent source',()=>{
 assert.throws(()=>assertTrainingFinalityCoverage([training()],[receipt()],{...options,asOf:'2026-11-16T19:59:00.000Z'}),/FUTURE/);
 assert.throws(()=>assertTrainingFinalityCoverage([training()],[receipt()],{...options,asOf:'2026-11-17T03:00:00.000Z'}),/STALE/);
 const r=receipt();r.sourceUpstreamIndependenceVerified=true;assert.throws(()=>reconcileTrainingFinality([training()],[r],options));
 assert.throws(()=>reconcileTrainingFinality([training()],[receipt()],{...options,weeks:[10,10]}));
 assert.throws(()=>reconcileTrainingFinality([training()],[receipt()],{...options,weeks:[]}));
});

test('Receipt checks cannot accept malformed counts, duplicate source games or changed fixture dates',()=>{
 const g=training();assert.equal(reconcileTrainingFinality([g,g],[receipt()],options).available,false);
 for(const mutate of [r=>r.games[0].homeScore='21',r=>r.games[0].gameDate='2026-11-13',r=>r.games[0].final='true',r=>r.games.push(r.games[0]),r=>r.sourceBodySha256='notahash']){
  const r=receipt();mutate(r);assert.throws(()=>reconcileTrainingFinality([training()],[r],options));
 }
 const out=reconcileTrainingFinality([training(),{...training(),season:2025}],[receipt()],options);
 assert.equal(out.trainingGamesOutsideScope,1);assert.equal(out.receiptIdentities[0].sourceBodySha256,receipt().sourceBodySha256);
});

import {mkdtemp,writeFile,access,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
test('Opt-in trainer receipt failure stops before fit/output and efficiency gate precedes PBP fetching',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'betq-finality-'));try{
 const csv='game_id,season,game_type,week,gameday,away_team,away_score,home_team,home_score,location\n2026_10_WAS_NYG,2026,REG,10,2026-11-12,WAS,24,NYG,21,Home\n';
 await writeFile(join(dir,'input.csv'),csv);await writeFile(join(dir,'receipts.json'),'[]');
 const target=join(dir,'model.json');const result=spawnSync(process.execPath,['scripts/train-nfl.mjs','--input',join(dir,'input.csv'),'--output',target,'--finality-receipts',join(dir,'receipts.json'),'--finality-weeks','10'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/TRAINING_FINALITY_COVERAGE_BLOCKED/);await assert.rejects(access(target));
 const source=await readFile(new URL('../scripts/train-efficiency.mjs',import.meta.url),'utf8');assert.ok(source.indexOf('const finalityCoverage=')<source.indexOf('await downloadPbpSeason'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
import {trainingReceiptOptions} from '../src/nfl-official-finality.mjs';
test('Training opt-in cannot silently bypass verification via typo, duplicate or incomplete flags',()=>{
 assert.equal(trainingReceiptOptions([]),null);
 assert.deepEqual(trainingReceiptOptions(['--finality-receipts','r.json','--finality-weeks','9,10']),{path:'r.json',weeks:[9,10]});
 for(const args of [['--finality-receipt','x'],['--finality-receipts','x'],['--finality-weeks','10'],['--finality-receipts','x','--finality-weeks','10,10'],['--finality-receipts','x','--finality-weeks','10','--finality-weeks','9'],['--finality-receipts','--finality-weeks','10']])assert.throws(()=>trainingReceiptOptions(args));
});
