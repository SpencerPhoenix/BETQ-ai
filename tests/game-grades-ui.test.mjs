import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {emptyJournal} from '../src/evidence.mjs';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/game-grades.js',import.meta.url),'utf8'),context);
const ui=context.BETQGameGrades;
const fixture=()=>({schema:1,available:true,researchOnly:true,scope:'RETAINED_NFL_GAMES',coverage:{trackedGames:1,recordedResults:1,gradedGames:1,ungradedGames:0,pendingGames:0},games:[{gameId:'game-1',home:'Home',away:'Away',gameDate:'2026-11-01',commenceTime:'2026-11-01T18:00:00.000Z',status:'GRADED',reasons:[],baselineSnapshotId:'frozen-1',capturedAt:'2026-10-31T18:00:00.000Z',modelVersion:'nfl-elo-1',modelHomeProbability:.6,marketHomeProbability:.55,result:{homeScore:24,awayScore:17,outcome:'home',revision:1,verifiedAt:'2026-11-02T18:00:00.000Z',sourceCorroborated:true},metrics:{modelBrier:.16,modelLogLoss:.51,modelCorrect:true,marketBrier:.2025,marketLogLoss:.598,marketCorrect:true,brierImprovement:.0425}}],limitations:{notice:'Frozen research only.'}});
test('renders scored model and market quality separately with provenance and limits',()=>{
 const html=ui.html(fixture());
 for(const value of ['1 graded / 1 tracked games','0.160','0.203','0.043','60.0%','55.0%','Away 17','Home 24','frozen-1','not executable prices','not proven future improvement'])assert.ok(html.includes(value),value);
 assert.match(html,/<caption>/);assert.match(html,/scope="row"/);assert.match(html,/tabindex="0"/);
});
test('includes every status without manufacturing missing scores',()=>{
 const data=fixture();
 for(const status of ['UNGRADED','TIE_EXCLUDED','PENDING_RESULT','SCHEDULE_CONFLICT_QUARANTINED']){
  const g=structuredClone(data.games[0]);g.gameId=status;g.status=status;g.metrics=null;g.result=null;g.reasons=['Missing valid evidence'];data.games.push(g);
 }
 data.coverage={trackedGames:5,recordedResults:1,gradedGames:1,ungradedGames:3,pendingGames:1};
 const html=ui.html(data);
 for(const status of ['Ungraded','Tie excluded','Pending result','Schedule conflict: quarantined'])assert.ok(html.includes(status));
 assert.equal((html.match(/<tr>/g)||[]).length,6);
 assert.match(html,/Not scored/);assert.match(html,/Missing valid evidence/);
});
test('unavailable market scores stay absent rather than zero',()=>{
 const data=fixture();Object.assign(data.games[0].metrics,{marketBrier:null,marketLogLoss:null,marketCorrect:null,brierImprovement:null});data.games[0].marketHomeProbability=null;
 assert.equal(ui.valid(data),true);assert.match(ui.html(data),/Market log loss: Not scored/);assert.doesNotMatch(ui.html(data),/>0\.000</);
});
test('fails closed on invented or ineligible grading and inconsistent coverage',()=>{
 for(const mutate of [d=>d.games[0].result.sourceCorroborated=false,d=>d.games[0].result.homeScore=17,d=>d.games[0].status='UNGRADED',d=>d.games[0].metrics.modelBrier=null,d=>d.coverage.gradedGames=0,d=>d.coverage.trackedGames=2,d=>d.games[0].metrics.marketLogLoss=null,d=>d.games[0].status='toString']){
  const data=fixture();mutate(data);assert.equal(ui.valid(data),false);assert.match(ui.html(data),/Game grading unavailable/);
 }
});
test('escapes all externally supplied content',()=>{
 const data=fixture();data.games[0].home='<img src=x onerror=alert(1)>';data.games[0].reasons=['<script>bad</script>'];data.limitations.notice='<iframe>';
 const html=ui.html(data);assert.doesNotMatch(html,/<img|<script|<iframe/);assert.match(html,/&lt;img/);
});
test('reads only grade endpoint and handles unavailable response',async()=>{
 const root={innerHTML:''},calls=[];
 await ui.load(root,async url=>{calls.push(url);return fixture();});assert.deepEqual(calls,['/api/research/grades']);assert.match(root.innerHTML,/1 graded/);
 await ui.load(root,async()=>{throw Error('offline');});assert.match(root.innerHTML,/Game grading unavailable/);
});
test('older request cannot overwrite newer grades',async()=>{
 const root={innerHTML:''};let finish;
 const old=ui.load(root,()=>new Promise(resolve=>{finish=resolve;}));
 await ui.load(root,async()=>fixture());finish(null);await old;assert.match(root.innerHTML,/1 graded/);
});
test('monitor loads read-only grade script before app and mounts it',()=>{
 const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.ok(index.indexOf('/game-grades.js')<index.indexOf('/app.js'));assert.match(index,/id="game-grades"/);assert.match(app,/BETQGameGrades\?\.load/);
});

test('50/50 forecasts retain probability scores without directional claims',()=>{
 const data=fixture();data.games[0].modelHomeProbability=.5;data.games[0].marketHomeProbability=.5;data.games[0].metrics.modelCorrect=null;data.games[0].metrics.marketCorrect=null;
 assert.equal(ui.valid(data),true);assert.match(ui.html(data),/Model: No directional pick/);assert.match(ui.html(data),/Market: No directional pick/);
});

test('pinned real ledger renders all retained games including quarantine',()=>{
 const journal=JSON.parse(fs.readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8'));
 const data=gradeRetainedGames(journal,{now:Date.parse('2026-11-16T12:00:00Z')});
 assert.equal(ui.valid(data),true);const html=ui.html(data);assert.equal((html.match(/<tr>/g)||[]).length,data.games.length+1);assert.match(html,/Withheld/);
});

test('backend qualified grade with missing model version remains visible',()=>{
 const journal={...syntheticScoringJournal(1,1),provenance:emptyJournal(2026).provenance};
 delete journal.snapshots[0].modelVersion;
 const data=gradeRetainedGames(journal,{now:Date.parse('2026-11-16T12:00:00Z')});
 assert.equal(data.games[0].status,'GRADED');assert.equal(data.games[0].modelVersion,null);
 assert.equal(ui.valid(data),true);const html=ui.html(data);assert.match(html,/1 graded \/ 1 tracked games/);assert.match(html,/Model: Not retained/);assert.doesNotMatch(html,/Game grading unavailable/);
});

test('latest result is first without future games burying it or mutating evidence',()=>{
 const data=fixture(),original=data.games[0];
 const latest={...structuredClone(original),gameId:'latest',home:'BAL',away:'LAC',gameDate:'2026-11-16',commenceTime:'2026-11-17T01:15:00.000Z',modelHomeProbability:.656,result:{...original.result,homeScore:20,awayScore:23},metrics:{...original.metrics,modelCorrect:false}};
 const pending={...structuredClone(original),gameId:'pending',gameDate:'2026-11-22',commenceTime:'2026-11-22T18:00:00.000Z',status:'PENDING_RESULT',result:null,metrics:null};
 data.games.push(pending,latest);Object.assign(data.coverage,{trackedGames:3,recordedResults:2,gradedGames:2,pendingGames:1});
 const before=JSON.stringify(data),html=ui.html(data);
 assert.match(html,/Latest result · 2026-11-16/);assert.match(html,/LAC 23 · BAL 20/);assert.match(html,/Original pick: <strong>BAL<\/strong> · 65.6%/);assert.match(html,/Model: Incorrect/);
 const rows=html.slice(html.indexOf('<tbody>'));assert.ok(rows.indexOf('LAC @ BAL')<rows.indexOf('Away @ Home'));
 assert.equal(JSON.stringify(data),before);
});
test('latest result never turns an ungraded or conflicting result into a win or loss',()=>{
 const data=fixture();data.games[0].status='UNGRADED';data.games[0].metrics=null;data.games[0].result.sourceCorroborated=false;Object.assign(data.coverage,{gradedGames:0,ungradedGames:1});
 let summary=ui.html(data).split('</section>')[0];assert.match(summary,/Model: Not scored/);assert.match(summary,/Uncorroborated recorded score/);assert.doesNotMatch(summary,/Model: Correct|Original pick:/);
 data.games[0].status='SCHEDULE_CONFLICT_QUARANTINED';summary=ui.html(data).split('</section>')[0];assert.match(summary,/No final score is available yet/);assert.doesNotMatch(summary,/Home 24/);
});
test('latest result escapes labels, preserves neutral forecasts and has a direct homepage entry',()=>{
 const data=fixture();data.games[0].home='<img>';data.games[0].modelHomeProbability=.5;data.games[0].metrics.modelCorrect=null;
 const html=ui.html(data).split('</section>')[0];assert.match(html,/&lt;img&gt;/);assert.doesNotMatch(html,/<img>/);assert.match(html,/No preference/);assert.match(html,/No directional pick/);
 const index=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');assert.match(index,/data-tab="games">Latest results/);
});
