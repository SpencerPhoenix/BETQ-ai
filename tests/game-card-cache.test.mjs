import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const js=readFileSync(new URL('../public/game-card.js',import.meta.url),'utf8');
const segment=js.slice(js.indexOf('function selectCachedLines('),js.indexOf('function renderCachedLines('));
const ctx=vm.createContext({Date});vm.runInContext(segment,ctx);
const now=Date.parse('2026-11-19T23:00:00.000Z'),stamp=new Date(now).toISOString();
const r={validUntil:'2026-11-19T23:05:00.000Z',fixture:{home:'Texans',away:'Colts',kickoff:'2026-11-20T01:15:00.000Z'}};
function slate(market='spreads'){
 const sides=market==='totals'?['over','under']:['home','away'];
 return {source:'THE_ODDS_API_V4',demo:false,cacheHit:true,sport:'americanfootball_nfl',market,receivedAt:stamp,events:[{id:'provider1',homeTeam:'Texans',awayTeam:'Colts',commenceTime:r.fixture.kickoff,demo:false,started:false,opportunities:sides.map(side=>({eventId:'provider1',market,contractId:market==='spreads'?'spread:-3.5':market==='totals'?'total:45.5':'h2h',side,point:market==='spreads'?(side==='home'?-3.5:3.5):market==='totals'?45.5:null,americanOdds:-110,bookmaker:'Book & Co',bookmakerKey:'book',lastUpdated:stamp}))}]};
}
const read=(data,r2=r,time=now)=>ctx.selectCachedLines(data,r2,time);
test('cached selected lines retain actual side, handicap, price, book and timestamps without model predictions',()=>{const a=read({spreads:slate(),totals:slate('totals'),h2h:slate('h2h')});assert.equal(a.groups.flatMap(g=>g.quotes).length,6);assert.equal(a.groups[1].quotes[0].label,'Texans -3.5');assert.equal(a.groups[1].quotes[1].label,'Colts +3.5');assert.equal(a.groups[2].quotes[0].label,'Over 45.5');assert.equal(a.groups[1].quotes[0].price,-110);assert.equal(a.expiresAt,now+300000);assert.ok(a.groups.flatMap(g=>g.quotes).every(q=>q.quoteAt===stamp&&q.receivedAt===stamp&&q.bookKey==='book'&&!('probability' in q)));});
test('cache miss, demo, wrong sport/source/market, missing cache proof and future or stale receipts fail closed',()=>{for(const mutate of [x=>x.source='SYNTHETIC_DEMO',x=>x.demo=true,x=>x.cacheHit=false,x=>x.sport='basketball_nba',x=>x.market='totals',x=>x.receivedAt='bad',x=>x.receivedAt='2026-99-19T23:00:00.000Z',x=>x.receivedAt='2026-11-19T23:01:00.000Z',x=>x.receivedAt='2026-11-19T22:55:00.000Z']){const s=slate();mutate(s);assert.equal(read({spreads:s}).groups[1].quotes.length,0);}assert.equal(read({}).groups.flatMap(x=>x.quotes).length,0);});
test('exact team/kickoff and unique event identity required; conflicting markets cannot mix games',()=>{for(const mutate of [e=>e.homeTeam='Colts',e=>e.commenceTime='2026-11-20T01:16:00.000Z',e=>e.started=true,e=>e.demo=true,e=>e.scheduleReview={status:'SCHEDULE_RECONCILIATION_REQUIRED'},e=>e.id='']){const s=slate();mutate(s.events[0]);assert.equal(read({spreads:s}).groups[1].quotes.length,0);}const s=slate();s.events.push(structuredClone(s.events[0]));assert.equal(read({spreads:s}).groups[1].quotes.length,0);const t=slate('totals');t.events[0].id='provider2';for(const q of t.events[0].opportunities)q.eventId='provider2';assert.equal(read({spreads:slate(),totals:t}).groups.flatMap(g=>g.quotes).length,0);});
test('wrong side/line/period/book/odds, duplicate contracts and invalid quote chronology reject market',()=>{for(const mutate of [q=>q.point=4,q=>q.contractId='spread:3.5',q=>q.side='over',q=>q.period='first_half',q=>q.bookmakerKey='',q=>q.bookmaker='',q=>q.americanOdds=99,q=>q.americanOdds=Infinity,q=>q.lastUpdated='bad',q=>q.lastUpdated='2026-11-19T23:00:01.000Z',q=>q.lastUpdated='2026-11-19T22:50:00.000Z',q=>q.eventId='other']){const s=slate();mutate(s.events[0].opportunities[0]);assert.equal(read({spreads:s}).groups[1].quotes.length,0);}const s=slate();s.events[0].opportunities.push({...s.events[0].opportunities[0]});assert.equal(read({spreads:s}).groups[1].quotes.length,0);});
test('quote freshness and kickoff reduce expiry; live client uses only fixed public cache reads and rejects late responses',()=>{const s=slate();for(const quote of s.events[0].opportunities)quote.lastUpdated='2026-11-19T22:52:00.000Z';assert.equal(read({spreads:s}).expiresAt,now+120000);assert.equal(read({spreads:slate()},{...r,fixture:{...r.fixture,kickoff:'2026-11-19T23:05:00.000Z'}}).groups[1].quotes.length,0);const loader=js.slice(js.indexOf('async function loadCachedLines('),js.indexOf('// Read-only analysis surface'));assert.match(loader,/credentials:'omit'/);assert.match(loader,/token!==generation\|\|current!==r/);assert.doesNotMatch(loader,/headers:|authorization|x-betq-paid-request|mode=demo/);assert.match(js,/Date.now\(\)<cachedLines.checkedAt/);});

test('actual public slate producer contracts feed the selector without schema or sign adapters',async()=>{const {analyzeEvents}=await import('../src/engine.mjs');const {demoEvents}=await import('../src/demo.mjs');for(const market of ['h2h','spreads','totals']){const produced=analyzeEvents(demoEvents('americanfootball_nfl',now),{sport:'americanfootball_nfl',market,asOf:now,demo:false});const e=produced.events[0];const evaluation={validUntil:r.validUntil,fixture:{home:e.homeTeam,away:e.awayTeam,kickoff:e.commenceTime}};const report=read({[market]:{...produced,receivedAt:stamp,cacheHit:true}},evaluation);const quotes=report.groups.find(g=>g.market===market).quotes;const expected=market==='spreads'?e.spreadQuotePair:e.opportunities;assert.equal(quotes.length,expected.length);for(let i=0;i<quotes.length;i++){assert.equal(quotes[i].price,expected[i].americanOdds);assert.equal(quotes[i].quoteAt,expected[i].lastUpdated);assert.equal(quotes[i].bookKey,expected[i].bookmakerKey);}}});

test('a provider ID reused for a different matchup invalidates the matching quote',()=>{const s=slate();s.events.push({...structuredClone(s.events[0]),homeTeam:'Other home',awayTeam:'Other away'});assert.equal(read({spreads:s}).groups[1].quotes.length,0);});


test('last-observed quotes stay visible across five-minute boundary but expire at kickoff',()=>{
 for(const delta of [300001,300000,299999,1]){
  const kickoff=new Date(now+delta).toISOString(),s=slate(),evaluation={...r,fixture:{...r.fixture,kickoff}};
  s.events[0].commenceTime=kickoff;
  const report=read({spreads:s},evaluation);
  assert.equal(report.groups[1].quotes.length,2);
  assert.equal(report.expiresAt,Math.min(now+300000,now+delta));
 }
 for(const delta of [0,-1]){
  const kickoff=new Date(now+delta).toISOString(),s=slate();s.events[0].commenceTime=kickoff;
  assert.equal(read({spreads:s},{...r,fixture:{...r.fixture,kickoff}}).groups[1].quotes.length,0);
 }
});
test('near-kickoff last-observed display never bypasses stale, started or schedule conflict gates',()=>{
 const kickoff=new Date(now+120000).toISOString(),evaluation={...r,fixture:{...r.fixture,kickoff}};
 for(const mutate of [s=>s.receivedAt=new Date(now-300000).toISOString(),s=>s.events[0].started=true,s=>s.events[0].scheduleReview={status:'SCHEDULE_RECONCILIATION_REQUIRED'},s=>s.events[0].scheduleReview={status:'SCHEDULE_REVIEW_IDENTITY_MISMATCH'}]){
  const s=slate();s.events[0].commenceTime=kickoff;mutate(s);
  assert.equal(read({spreads:s},evaluation).groups[1].quotes.length,0);
 }
 assert.match(js,/Last-observed sportsbook snapshot/);
 assert.match(js,/market may have moved, closed or been suspended/);
});


test('all public producer markets remain observational in final five pregame minutes',async()=>{
 const {analyzeEvents}=await import('../src/engine.mjs');const {demoEvents}=await import('../src/demo.mjs');
 for(const market of ['h2h','spreads','totals']){
  const events=demoEvents('americanfootball_nfl',now);events[0].commence_time=new Date(now+120000).toISOString();
  const produced=analyzeEvents(events,{sport:'americanfootball_nfl',market,asOf:now,receivedAt:stamp,demo:false});
  const e=produced.events[0],evaluation={validUntil:r.validUntil,fixture:{home:e.homeTeam,away:e.awayTeam,kickoff:e.commenceTime}};
  assert.ok(e.opportunities.length);assert.ok(e.opportunities.every(q=>q.status==='PASS'&&q.theoreticalUnits===0));
  const report=read({[market]:{...produced,receivedAt:stamp,cacheHit:true}},evaluation);
  assert.equal(report.groups.find(g=>g.market===market).quotes.length,(market==='spreads'?e.spreadQuotePair:e.opportunities).length);
  assert.ok(report.groups.flatMap(g=>g.quotes).every(q=>!('status' in q)&&!('theoreticalUnits' in q)&&!('evPercent' in q)));
  assert.equal(report.expiresAt,now+120000);
 }
});


test('spread requires complementary lines from the exact same book and timestamp; singles and mixed pairs are withheld',()=>{
 for(const modify of [
  a=>a.pop(),
  a=>a[1].bookmakerKey='other',
  a=>a[1].bookmaker='Other Book',
  a=>a[1].lastUpdated='2026-11-19T22:59:59.000Z',
  a=>{a[1].point=4;a[1].contractId='spread:-4';}
 ]){
  const s=slate();modify(s.events[0].opportunities);
  const result=read({spreads:s}).groups[1];
  assert.equal(result.quotes.length,0);
  assert.match(result.reason,/same-book spread pair/);
 }
});

test('a malformed dedicated pair cannot be hidden by fallback to the best-price list',()=>{
 const s=slate();s.events[0].spreadQuotePair=[s.events[0].opportunities[0]];
 assert.equal(read({spreads:s}).groups[1].quotes.length,0);
});

test('spread renderer labels observed prices separately and never turns win probability into a spread pick',()=>{
 const view=js.slice(js.indexOf('function renderSpreadStatus('),js.indexOf('function renderCachedLines('));
 const make=()=>({children:[],append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}});
 const place=make();
 const env=vm.createContext({document:{createElement:make},paragraph:(root,text)=>root.append({textContent:text})});
 vm.runInContext(view,env);
 env.renderSpreadStatus(place,read({spreads:slate()}).groups[1]);
 assert.ok(place.children.some(n=>n.textContent.includes('Texans -3.5')));
 assert.ok(place.children.some(n=>n.textContent.includes('No BETQ cover forecast')));
 env.renderSpreadStatus(place,{quotes:[],reason:'Cached spread expired.'});
 assert.ok(place.children.some(n=>n.textContent.includes('Cached spread expired')));
 assert.ok(!place.children.some(n=>n.textContent.includes('Texans -3.5')));
});
