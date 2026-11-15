import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {analyzeEvents} from '../src/engine.mjs';
import {demoEvents} from '../src/demo.mjs';
import {scheduledInstant} from '../src/schedule-review.mjs';
import {createHandler} from '../src/server.mjs';
import {summarizeEvidence} from '../src/evidence.mjs';

const NOW=Date.parse('2026-11-07T20:00:00Z');
const strategy=readFileSync(new URL('../public/game-strategies.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const segment=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const options={mode:'live',market:'h2h',source:'THE_ODDS_API_V4',receivedAt:new Date(NOW).toISOString(),now:NOW};
const plain=()=>analyzeEvents(demoEvents('americanfootball_nfl',NOW),{sport:'americanfootball_nfl',asOf:NOW,demo:false}).events[0];
const strategyApi=()=>{const c=vm.createContext({});vm.runInContext(strategy,c);return c.BETQGameStrategies;};
const cards=result=>result.groups.flatMap(group=>group.cards);
function known(){
  const raw={...demoEvents('americanfootball_nfl',NOW)[0],id:'ac9d38a18d5c92814233a31aa9a48d78',
    home_team:'San Francisco 49ers',away_team:'Las Vegas Raiders',commence_time:'2026-11-08T21:05:00.000Z'};
  for(const book of raw.bookmakers)for(const market of book.markets)if(market.key==='h2h')market.outcomes.forEach((o,i)=>o.name=i===0?raw.home_team:raw.away_team);
  return analyzeEvents([raw],{sport:'americanfootball_nfl',asOf:NOW,demo:false}).events[0];
}

test('Combined engine and strategy preserve known schedule conflict and PASS authority',()=>{
  const event=known(),api=strategyApi();
  assert.equal(event.scheduleReview.status,'SCHEDULE_RECONCILIATION_REQUIRED');
  assert.ok(event.opportunities.every(q=>q.status==='PASS'&&q.theoreticalUnits===0));
  for(const status of ['SCHEDULE_RECONCILIATION_REQUIRED','SCHEDULE_REVIEW_IDENTITY_MISMATCH']){
    const report=api.build({...event,scheduleReview:{...event.scheduleReview,status}},options);
    assert.equal(report.recommendedUnits,0);assert.equal(report.wagerRecommendation,false);
    assert.ok(cards(report).length>0);
    for(const card of cards(report)){
      assert.equal(card.status,'PASS');assert.match(card.sourceStatus,/schedule conflict|Schedule identity mismatch/);
      assert.doesNotMatch(card.sourceStatus,/within 10 minutes/);
    }
  }
});

test('Strategy calendar and explicit-offset timestamp boundaries agree with server schedule parsing',()=>{
  const api=strategyApi(),base=plain();
  for(const value of [null,undefined,'','2026-11-08','2026-11-08T21:25:00','2026-02-30T21:25:00Z',
    '2026-11-08T24:00:00Z','2026-11-08T21:25:60Z','2026-11-08T21:25:00+24:00',
    '2026-11-08T21:25:00Z','2026-11-08T13:25:00-08:00','2026-11-09T06:25:00+09:00',
    '2026-11-01T01:30:00-07:00','2026-11-01T01:30:00-08:00']){
    const status=cards(api.build({...base,commenceTime:value},options))[0].sourceStatus;
    assert.equal(!/timestamp missing/.test(status),Number.isFinite(scheduledInstant(value)),String(value));
  }
  for(const value of ['2026-11-07','2026-11-07T20:00:00','2026-02-30T20:00:00Z']){
    assert.match(cards(api.build(base,{...options,receivedAt:value}))[0].sourceStatus,/timestamp missing/);
    const event=structuredClone(base);event.opportunities.forEach(q=>q.lastUpdated=value);
    assert.match(cards(api.build(event,options))[0].sourceStatus,/timestamp missing/);
  }
});

test('Strategy does not equate elapsed scheduled kickoff with verified in-play status',()=>{
  const api=strategyApi(),event={...plain(),commenceTime:new Date(NOW-1).toISOString(),started:false};
  const report=api.build(event,options);
  for(const card of cards(report)){
    assert.match(card.sourceStatus,/Scheduled start passed/);assert.match(card.sourceStatus,/actual game status unverified/);
    assert.equal(card.status,'PASS');
  }
});

function ui(event){
  let now=NOW,callback,interval;class Clock extends Date{static now(){return now;}}
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:''});return nodes.get(id);};
  const label={textContent:'',getAttribute:()=>event.id},body={innerHTML:''};
  const disclosure={open:true,dataset:{strategyKey:JSON.stringify([false,'live','h2h','THE_ODDS_API_V4',event.id])},querySelector:()=>body};
  const state={mode:'live',sport:'americanfootball_nfl',market:'h2h',slate:{source:'THE_ODDS_API_V4',receivedAt:options.receivedAt,events:[event]}};
  const context={Date:Clock,Intl,state,$:node,sportLabels:{americanfootball_nfl:'NFL'},empty:()=>'',
    document:{querySelectorAll:selector=>selector==='[data-schedule-event]'?[label]:[disclosure]},
    setInterval:(fn,ms)=>{callback=fn;interval=ms;},retainQuoteFocus:fn=>fn()};
  for(const name of ['renderFeed','renderResearchReadiness','renderMetrics','renderOpportunities','renderSpotlight','renderSignals'])context[name]=()=>{};
  vm.createContext(context);vm.runInContext(strategy,context);
  vm.runInContext(segment('  const esc =','  const persist =')+
    segment('  const dossierTime =','  function frozenSnapshotHTML')+
    segment('  function renderGames()','  function renderSignals()')+'renderGames();'+
    segment("  $('clock').textContent = new Date().toLocaleTimeString();",'  // All browser requests'),context);
  return {nodes,label,body,disclosure,interval,tick:ms=>{now+=ms;callback();}};
}

test('Merged game card retains schedule warning, frozen dossier opener and strategy disclosure',()=>{
  const h=ui(known()),out=h.nodes.get('game-grid').innerHTML;
  for(const text of ['Schedule conflict: reconciliation required','Published scheduled kickoff (UTC)','2026-11-08T21:25:00.000Z','data-dossier-provider=','Compare game strategies','Known schedule conflict'])assert.ok(out.includes(text),text);
  assert.match(out,/Provider-scheduled:/);assert.doesNotMatch(out,/IN PROGRESS/);
});

test('Both merged clock hooks run without replacing disclosure or scheduled-status nodes',()=>{
  const event={...plain(),commenceTime:new Date(NOW+360000).toISOString()},h=ui(event);
  const disclosure=h.disclosure,label=h.label;assert.equal(h.interval,15000);
  h.tick(360001);
  assert.equal(h.disclosure,disclosure);assert.equal(disclosure.open,true);assert.equal(h.label,label);
  assert.match(label.textContent,/SCHEDULED START PASSED.*STATUS UNVERIFIED/);
  assert.match(h.body.innerHTML,/Scheduled start passed/);assert.match(h.body.innerHTML,/actual game status unverified/);
  h.tick(300000);assert.match(h.body.innerHTML,/STALE retained quote/);
});

test('Integrated assets, original syntax targets and isolated historical navigation all remain present',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  const checks=pkg.scripts.check.split(' && ');assert.equal(new Set(checks).size,checks.length);
  for(const target of ['src/schedule-review.mjs','src/schedule-source-receipt.mjs','src/bdl-outcome-candidate.mjs',
    'public/game-strategies.js','src/historical-evaluation.mjs','src/historical-local-server.mjs',
    'public/historical-evaluation.js','scripts/verify-historical-evaluation.mjs','src/historical-bundle.mjs'])assert.ok(checks.includes('node --check '+target),target);
  assert.ok(html.indexOf('src="/game-strategies.js"')<html.indexOf('src="/app.js"'));
  assert.match(html,/href="\/historical-2025"/);assert.doesNotMatch(html,/<script[^>]+historical-evaluation/);
});

test('Historical and prospective routes coexist without provider access or journal pollution',async t=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),bytes=readFileSync(path),journal=JSON.parse(bytes);
  const readAt=Date.parse('2026-11-16T12:00:00.000Z');
  const before=JSON.stringify(journal);let unexpected=0;
  const forbidden=()=>{unexpected++;throw Error('No provider, remote feed or database access allowed');};
  const server=http.createServer(createHandler({clock:()=>readAt,nflEvidenceJournal:journal,
    source:{getOdds:forbidden,getScores:forbidden,status:forbidden},evidenceFeed:{get:forbidden},derivedShadowFeed:{get:forbidden},
    shadowStore:{capture:forbidden,status:forbidden,analysis:forbidden}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(unexpected,0);assert.equal(JSON.stringify(journal),before);assert.deepEqual(readFileSync(path),bytes);});
  const get=path=>fetch('http://127.0.0.1:'+server.address().port+path);
  for(const route of ['/','/game-strategies.js','/historical-2025','/historical-evaluation.js','/historical-evaluation.css','/historical-source-license.txt']){
    const response=await get(route);assert.equal(response.status,200,route);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  }
  const historic=await(await get('/api/historical-evaluation')).json();assert.equal(historic.gameCount,285);
  const retained=await(await get('/api/research/games')).json();assert.equal(retained.games.length,43);
  assert.ok(retained.games.every(game=>game.season===2026));
  const detail=await(await get('/api/research/game?gameId=2026_09_LV_SF')).json();
  assert.equal(detail.reason,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(detail.available,false);
  assert.equal(detail.conflict.firstFrozenCommenceTime,'2026-11-08T21:05:00.000Z');
  assert.deepEqual(detail.conflict.observedCommenceTimes,['2026-11-08T21:05:00.000Z','2026-11-08T21:25:00.000Z']);
  assert.equal(detail.conflict.history.total,9);assert.equal(detail.conflict.scoringEligible,false);
  const summary=summarizeEvidence(journal,readAt);assert.equal(summary.totalSnapshots,323);assert.equal(summary.sourceCorroboratedSettledGames,0);
});
