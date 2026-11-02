import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {analyzeEvents,noVigPair,expectedValue,toDecimal} from '../src/engine.mjs';
import {demoEvents} from '../src/demo.mjs';
import {predictNflEvent} from '../src/nfl-elo.mjs';
import {challengerResearchForEvent} from '../src/nfl-efficiency.mjs';
import {emptyJournal,updateJournal,validateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {isValidEvidenceSummary} from '../src/evidence-feed.mjs';
import {createOddsSource} from '../src/odds.mjs';
import {createHandler} from '../src/server.mjs';
import {validDay,nflGameDate,readBoundedText} from '../src/integrity.mjs';
import {pairedWeekBootstrap} from '../src/statistical-audit.mjs';
const NOW=Date.parse('2026-11-02T03:00:00Z'),iso=n=>new Date(n).toISOString();
const event={id:'probe',home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',commence_time:iso(NOW+86400000)};
const elo={schema:1,version:'nfl-elo-1',readyForResearch:true,generatedAt:iso(NOW-60000),lastGameDate:'2026-11-01',params:{homeAdv:25,scale:1},ratings:{KC:1500,LV:1500},holdout:{n:284,brier:.22,ece:.05}};
const feature={n:8,netEPA:.1,netSuccess:.05,offEPA:.2,defEPA:.1,latestGameDate:'2026-10-25'};
const challenger={version:'nfl-efficiency-1',readyForResearch:true,generatedAt:iso(NOW-60000),teamFeatures:{KC:feature,LV:feature},coefficients:{epa:1,success:1,rest:.02},holdout:{}};
const observation={id:'valid',gameId:'g',season:2026,modelHomeProbability:.61,marketHomeProbability:.54,capturedAt:iso(NOW),commenceTime:iso(NOW+86400000),gameDate:'2026-11-03',modelBuiltAt:iso(NOW-60000)};
const final={gameId:'g',homeScore:20,awayScore:10,outcome:'HOME',resultHash:'h'};
function randGenerator(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);}

test('Audit regression: malformed bookmaker and outcome records cannot crash a slate',()=>{
  for(const book of [null,0,'bad',{}, {markets:'wrong'}, {markets:[null]},
      {markets:[{key:'h2h',outcomes:[null,null],last_update:iso(NOW)}]}]){
    const out=analyzeEvents([{...event,bookmakers:[book]}],{asOf:NOW,sport:'americanfootball_nfl'});
    assert.equal(out.summary.signals,0);
  }
});
test('Audit regression: invalid kickoff and identical opponents never receive predictions',()=>{
  const events=[{...event,commence_time:'bad',bookmakers:[]},{...event,home_team:event.away_team,bookmakers:[]}];
  assert.equal(analyzeEvents(events,{asOf:NOW}).events.length,0);
  assert.equal(predictNflEvent(events[0],elo,NOW).available,false);
  assert.equal(challengerResearchForEvent(events[0],.6,challenger,NOW).available,false);
  assert.equal(challengerResearchForEvent({...event,commence_time:iso(NOW-1)},.6,challenger,NOW).available,false);
});
test('Audit regression: refreshing a model package does not refresh its obsolete input results',()=>{
  assert.equal(predictNflEvent(event,{...elo,lastGameDate:'2026-01-01'},NOW).reason,'MODEL_RESULTS_STALE');
  const c=structuredClone(challenger);c.teamFeatures.KC.latestGameDate='2026-01-01';
  assert.equal(challengerResearchForEvent(event,.6,c,NOW).available,false);
  assert.equal(predictNflEvent(event,elo,NOW).available,true);
});
test('Audit regression: nonfinite feature values and malformed model schema fail closed',()=>{
  for(const value of [NaN,Infinity,null,'0.1',undefined]){
    const c=structuredClone(challenger);c.teamFeatures.KC.netEPA=value;
    assert.equal(challengerResearchForEvent(event,.6,c,NOW).available,false);
  }
  assert.equal(predictNflEvent(event,{...elo,params:{homeAdv:NaN,scale:1}},NOW).available,false);
  assert.equal(predictNflEvent(event,{...elo,holdout:null},NOW).available,false);
});
test('UTC-night NFL games use Eastern schedule date, with a verified game date taking precedence',()=>{
  assert.equal(nflGameDate({commence_time:'2026-11-03T01:15:00Z'}),'2026-11-02');
  assert.equal(nflGameDate({commence_time:'2026-11-03T01:15:00Z',gameDate:'2026-11-01'}),'2026-11-01');
  assert.equal(validDay('2026-02-31'),false);
  assert.equal(validDay('2024-02-29'),true);
});
test('Audit regression: invalid timestamps cannot be admitted through NaN comparison',()=>{
  for(const value of ['',null,'bad','2026-99-55',undefined]){
    assert.throws(()=>updateJournal(emptyJournal(2026),[{...observation,capturedAt:value}],[],NOW),/Invalid/);
    assert.throws(()=>updateJournal(emptyJournal(2026),[{...observation,commenceTime:value}],[],NOW),/Invalid/);
  }
  assert.throws(()=>updateJournal(emptyJournal(2026),[{...observation,sourceReceivedAt:iso(NOW+120000)}],[],NOW),/Invalid/);
});
test('Existing corrupt journal rows, duplicate IDs, and impossible outcome/score pairs are rejected',()=>{
  const j=updateJournal(emptyJournal(2026),[observation],[],NOW).journal;
  assert.throws(()=>validateJournal({...j,snapshots:[observation,observation]}),/Invalid/);
  assert.throws(()=>updateJournal(j,[],[{...final,outcome:'AWAY'}],NOW),/Invalid result/);
  assert.throws(()=>updateJournal(j,[],[{...final,homeScore:null}],NOW),/Invalid result/);
  assert.throws(()=>validateJournal({...j,settlements:[{...final,outcome:'unverified'}]}),/Invalid/);
});
test('Malformed market probabilities cannot pollute paired forward scores',()=>{
  for(const p of [NaN,Infinity,-.01,0,1,1.01,'0.5'])
    assert.throws(()=>updateJournal(emptyJournal(2026),[{...observation,marketHomeProbability:p}],[],NOW),/Invalid/);
});
test('A remote summary cannot advertise a 30-game challenger result before 30 actual finals',()=>{
  const s=summarizeEvidence(emptyJournal(2026),NOW);
  const fake={...s,prospectiveGames:40,pairedChallengerSettled:30,challengerForwardComparison:{n:30}};
  assert.equal(isValidEvidenceSummary(fake),false);
  assert.equal(isValidEvidenceSummary({...s,prospectiveGames:1,settledGames:2}),false);
  assert.equal(isValidEvidenceSummary({...s,prospectiveGames:40,settledGames:40,forwardMetrics:{n:40,brier:NaN}}),false);
});
test('Integer spread/total quotes cannot pass WATCH without modeling push probability',()=>{
  const e=demoEvents('americanfootball_nfl',NOW);
  for(const game of e)for(const b of game.bookmakers)for(const m of b.markets){
    if(m.key==='spreads')m.outcomes.forEach(o=>o.point=Math.sign(o.point)*3);
    if(m.key==='totals')m.outcomes.forEach(o=>o.point=47);
  }
  for(const market of ['spreads','totals'])for(const g of analyzeEvents(e,{market,asOf:NOW}).events)
    for(const s of g.opportunities){assert.equal(s.status,'PASS');assert.ok(s.reasons.includes('PUSH_PROBABILITY_NOT_MODELED'));assert.equal(s.theoreticalUnits,0);}
});
test('Distinct lines are never merged by rounding point values',()=>{
  const e=demoEvents('americanfootball_nfl',NOW).slice(0,1);
  e[0].bookmakers.forEach((b,i)=>b.markets.find(x=>x.key==='totals').outcomes.forEach(o=>o.point=47.50001+i*.00001));
  const report=analyzeEvents(e,{market:'totals',asOf:NOW});
  assert.equal(report.events[0].totalMarkets,4);
  assert.ok(report.events[0].opportunities.every(s=>s.status==='PASS'&&s.comparatorBooks===0));
});
test('50,000 deterministic price pairs satisfy independent mathematical invariants',()=>{
  const random=randGenerator(777133);
  for(let i=0;i<50000;i++){
    const a=(100+Math.floor(random()*2000))*(random()<.5?-1:1),b=(100+Math.floor(random()*2000))*(random()<.5?-1:1);
    const [p,q]=noVigPair(a,b),[qReverse,pReverse]=noVigPair(b,a);
    assert.ok(p>0&&p<1&&Math.abs(p+q-1)<1e-12);
    assert.equal(p,pReverse);assert.equal(q,qReverse);
    const higherP=Math.min(.999,p+.01);
    assert.ok(expectedValue(higherP,a)>=expectedValue(p,a));
    assert.ok(Math.abs(expectedValue(p,a)-(p*toDecimal(a)-1))<1e-12);
  }
});
test('10,000 adversarial mixed event records never turn malformed quotes into a WATCH',()=>{
  const random=randGenerator(58911),bad=[null,false,{},'x',42,{markets:[null]},{markets:{h2h:[]}}];
  for(let i=0;i<10000;i++){
    const out=analyzeEvents([{...event,bookmakers:[bad[Math.floor(random()*bad.length)]]},null],{asOf:NOW});
    assert.equal(out.summary.watch,0);
    assert.equal(out.summary.signals,0);
  }
});
test('1,000 simultaneous same-market requests coalesce into one provider call',async()=>{
  let calls=0;
  const s=createOddsSource({apiKey:'  TEST_ONLY  ',clock:()=>NOW,fetchImpl:async url=>{
    calls++;assert.equal(new URL(url).searchParams.get('apiKey'),'TEST_ONLY');
    return new Response('[]',{status:200});
  }});
  const results=await Promise.all(Array.from({length:1000},()=>s.getOdds('americanfootball_nfl','h2h')));
  assert.equal(calls,1);assert.equal(results.length,1000);assert.equal(s.status().budget.used,1);
});
test('Concurrent distinct-market bursts respect the total daily quota limit',async()=>{
  let calls=0;
  const s=createOddsSource({apiKey:'TEST_ONLY',clock:()=>NOW,dailyCreditCap:4,fetchImpl:async()=>{calls++;return new Response('[]');}});
  const jobs=['americanfootball_nfl','basketball_nba','baseball_mlb','icehockey_nhl','americanfootball_ncaaf'].flatMap(sp=>['h2h','spreads','totals'].map(m=>Promise.resolve().then(()=>s.getOdds(sp,m))));
  const results=await Promise.allSettled(jobs);
  assert.equal(calls,4);assert.equal(results.filter(r=>r.status==='fulfilled').length,4);
  assert.equal(s.status().budget.used,4);
});
test('NaN configuration must not disable budgets; scores cannot spend below provider reserve',async()=>{
  const s=createOddsSource({apiKey:'TEST_ONLY',clock:()=>NOW,dailyCreditCap:NaN,reserveCredits:NaN,
    fetchImpl:async()=>new Response('[]',{headers:{'x-requests-remaining':'51','x-requests-last':'1'}})});
  assert.equal(s.status().budget.limit,12);
  await s.getOdds('americanfootball_nfl','h2h');
  await assert.rejects(s.getScores('americanfootball_nfl'),{code:'PROVIDER_CREDIT_RESERVE'});
});
test('Oversize unknown-length streams are cancelled before unlimited buffering',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(600));},cancel(){cancelled=true;}});
  await assert.rejects(readBoundedText(new Response(stream),1000),/BODY_TOO_LARGE/);
  assert.equal(cancelled,true);
});
test('UTF-8 multibyte boundaries and Content-Length limits are handled correctly',async()=>{
  const bytes=new TextEncoder().encode('BETQ 🧠');
  const stream=new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}});
  assert.equal(await readBoundedText(new Response(stream),100),'BETQ 🧠');
  await assert.rejects(readBoundedText(new Response('x',{headers:{'content-length':'5001'}}),5000),/BODY_TOO_LARGE/);
});
test('Paired week resampling is deterministic and rejects duplicated/invalid observations',()=>{
  const rows=Array.from({length:80},(_,i)=>({id:'r'+i,date:new Date(Date.UTC(2026,7,1+Math.floor(i/5)*7)).toISOString().slice(0,10),outcome:i%2,baseline:.5,challenger:i%2?.7:.3}));
  const one=pairedWeekBootstrap(rows),two=pairedWeekBootstrap(rows);
  assert.deepEqual(one,two);assert.equal(one.weeks,16);assert.ok(one.lower>0);
  assert.throws(()=>pairedWeekBootstrap([...rows,rows[0]]),/duplicate/);
  assert.equal(pairedWeekBootstrap(rows.slice(0,10)).available,false);
});
test('A one-week 40-game collection is not 40 independent weeks of confidence',()=>{
  const rows=Array.from({length:40},(_,i)=>({id:'r'+i,date:'2026-11-01',outcome:1,baseline:.6,challenger:.7}));
  const ci=pairedWeekBootstrap(rows);assert.equal(ci.available,false);assert.equal(ci.lower,null);assert.equal(ci.weeks,1);
});
test('Live signals expire in the UI without buying another odds request',async()=>{
  const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(source,/CLIENT_FRESHNESS_GATE/);
  assert.match(source,/state\.slate\?\.sport!==state\.sport/);
  assert.match(source,/state\.slate=null;state\.selectedId=null/);
});
test('Load test: 500 requests yield only controlled responses; health remains reachable after rate limit',async t=>{
  const source={status:()=>({configured:false}),getOdds:async()=>({events:[],receivedAt:iso(NOW),quota:null})};
  const server=http.createServer(createHandler({source,clock:()=>NOW}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const codes=[];
  for(let group=0;group<20;group++) codes.push(...await Promise.all(Array.from({length:25},()=>fetch(base+'/api/slate?mode=demo').then(r=>r.status))));
  assert.ok(codes.includes(200)&&codes.includes(429));assert.ok(codes.every(s=>[200,429].includes(s)));
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/config')).status,200);
});
