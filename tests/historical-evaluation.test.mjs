import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {historicalFixture} from './fixtures/historical-evaluation.mjs';
import {buildHistoricalEvaluation,loadHistoricalEvaluation} from '../src/historical-evaluation.mjs';
import {historicalHandler,startHistoricalLocal} from '../src/historical-local-server.mjs';
import {filterGames,validSummary,validGame,renderSummary,renderGame,renderProvenance,createGameLoader,gameIdFromHash} from '../public/historical-evaluation.js';
const fixture=()=>{const {artifact,dataset}=historicalFixture();return {artifact,dataset,view:buildHistoricalEvaluation(artifact,dataset)};};
test('Complete cohort margins and errors are recomputed from immutable input',()=>{
  const {artifact,dataset,view}=fixture(),before=JSON.stringify({artifact,dataset}),s=view.summary(),g=view.game(s.games[0].gameId);
  assert.equal(s.gameCount,285);assert.equal(s.regularSeasonGames,272);assert.equal(s.playoffGames,13);
  assert.equal(g.actual.margin,7);assert.equal(g.models.market.signedError,1);assert.equal(g.models.independentEfficiency.absoluteError,3);
  assert.equal(s.metrics.market.mae,1);assert.equal(s.metrics.marketPlusEfficiency.rmse,2);
  assert.deepEqual(s.correction,{improved:0,worsened:285,tied:0});assert.equal(g.analogs.pushes,1);assert.equal(g.analogs.neighbors.length,50);
  assert.equal(JSON.stringify({artifact,dataset}),before);g.actual.margin=99;s.games.length=0;
  assert.equal(view.summary().games.length,285);assert.equal(view.game(g.gameId).actual.margin,7);
  assert.equal(view.game('2025_01_NO_SUCH'),null);
});
test('Projection rejects corrupt, contradictory or future-neighbor artifacts',()=>{
  const mutations=[a=>a.gameBreakdowns.pop(),a=>a.gameBreakdowns[1]=a.gameBreakdowns[0],a=>a.summary.market.mae=4,
    a=>a.gameBreakdowns[0].labels.homeScore=99,a=>a.gameBreakdowns[0].models.market.pointForecastHomeMargin=NaN,
    a=>a.gameBreakdowns[0].models.market.losses.absoluteMargin=5,a=>a.gameBreakdowns[0].marketReference.decisionTimeQuoteVerified=true,
    a=>a.gameBreakdowns[0].analogs.neighbors[0].gameId='2025_01_AA_HA',a=>a.gameBreakdowns[0].analogs.neighbors.reverse(),
    a=>a.gameBreakdowns[0].analogs.counts.HOME_COVER=1,a=>a.gameBreakdowns[0].features.home.latestIncludedGameDate='2026-01-01',
    a=>a.gameBreakdowns[0].analogs.neighbors[1].gameId=a.gameBreakdowns[0].analogs.neighbors[0].gameId];
  for(const mutate of mutations){const {artifact,dataset}=historicalFixture();mutate(artifact);assert.throws(()=>buildHistoricalEvaluation(artifact,dataset),/INVALID_FROZEN/);}
});
test('Loader fails closed when exact frozen bytes are absent or changed',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'betq-historical-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await assert.rejects(loadHistoricalEvaluation(dir));
  await writeFile(join(dir,'spread-screen.json'),'{}');await assert.rejects(loadHistoricalEvaluation(dir),/HASH_MISMATCH/);
});
test('Projection allowlist does not leak extra provider or credential fields',()=>{
  const {artifact,dataset}=historicalFixture();artifact.secret='PRIVATE_SECRET';artifact.gameBreakdowns[0].operatorToken='PRIVATE_SECRET';
  artifact.gameBreakdowns[0].marketReference.rawBookmakerOdds='PRIVATE_SECRET';
  const view=buildHistoricalEvaluation(artifact,dataset);assert.doesNotMatch(JSON.stringify(view.summary())+JSON.stringify(view.game(artifact.gameBreakdowns[0].gameId)),/PRIVATE_SECRET|rawBookmakerOdds|operatorToken/);
});
async function serverFixture(t){
  const {view}=fixture();const server=http.createServer(historicalHandler(view));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));return {view,base:'http://127.0.0.1:'+server.address().port};
}
test('Loopback viewer serves frozen data and assets, never production APIs',async t=>{
  const {base,view}=await serverFixture(t);const index=await fetch(base+'/api/historical-evaluation');assert.equal(index.status,200);const s=await index.json();
  assert.equal(s.games.length,285);assert.equal(index.headers.get('cache-control'),'no-store');assert.match(index.headers.get('content-security-policy'),/default-src 'none'/);
  const detail=await fetch(base+'/api/historical-evaluation/game?gameId='+s.games[0].gameId);assert.equal(detail.status,200);assert.deepEqual(await detail.json(),view.game(s.games[0].gameId));
  for(const path of ['/','/historical-evaluation.js','/historical-evaluation.css','/favicon.svg'])assert.equal((await fetch(base+path)).status,200,path);
  for(const path of ['/api/slate','/api/scores','/api/research/games','/app.js','/data/spread-screen.json','/.env'])assert.equal((await fetch(base+path)).status,404,path);
});
test('Local server rejects non-loopback Host, write verbs and malformed selectors',async t=>{
  const {base,view}=await serverFixture(t),gameId=view.summary().games[0].gameId;
  const hostStatus=await new Promise((resolve,reject)=>{const request=http.get(base+'/',{headers:{Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(hostStatus,403);
  for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal((await fetch(base+'/api/historical-evaluation',{method})).status,405);
  for(const path of ['/api/historical-evaluation?refresh=true','/api/historical-evaluation/game','/api/historical-evaluation/game?gameId=',
    '/api/historical-evaluation/game?gameId='+gameId+'&gameId='+gameId,'/api/historical-evaluation/game?file=/etc/passwd'])assert.equal((await fetch(base+path)).status,400,path);
  assert.equal((await fetch(base+'/api/historical-evaluation/game?gameId=2025_99_ZZ_YY')).status,404);
});
test('Remote-address guard fails closed before accessing the view',async()=>{
  let status;const h=historicalHandler({summary(){throw Error('must not read');},game(){throw Error('must not read');}});
  await h({socket:{remoteAddress:'192.0.2.1'},headers:{host:'127.0.0.1'},method:'GET',url:'/'},{writeHead(n){status=n;},end(){}});assert.equal(status,403);
});
test('Game filters combine search, week and phase without mutating complete scorecard',()=>{
  const {view}=fixture(),s=view.summary();assert.equal(filterGames(s.games).length,285);
  assert.equal(filterGames(s.games,{phase:'POST'}).length,13);assert.equal(filterGames(s.games,{phase:'REG',week:'1'}).length,16);
  assert.ok(filterGames(s.games,{search:'AA'}).every(g=>g.away==='AA'));assert.equal(filterGames(s.games,{search:'not found'}).length,0);assert.equal(s.games.length,285);
});
test('Client contracts reject incorrect identity, inconsistent errors and new-season analogs',()=>{
  const {view}=fixture(),s=view.summary(),g=view.game(s.games[0].gameId);assert.equal(validSummary(s),true);assert.equal(validGame(g,g.gameId),true);
  assert.equal(validSummary({...s,mode:'LIVE'}),false);assert.equal(validSummary({...s,games:[]}),false);
  assert.equal(validGame(g,'wrong'),false);assert.equal(validGame({...g,actual:{...g.actual,margin:99}},g.gameId),false);
  g.analogs.neighbors[0].gameId='2025_01_AA_HA';assert.equal(validGame(g,g.gameId),false);
});
test('Rendering separates actual, market and two model margins, all 50 analogs and limits',()=>{
  const {view}=fixture(),s=view.summary(),g=view.game(s.games[0].gameId),html=renderGame(g),summary=renderSummary(s),provenance=renderProvenance(s);
  for(const phrase of ['ACTUAL SCORE','ACTUAL HOME MARGIN','Signed error','Absolute error','Recorded market line','Market + efficiency correction','Independent efficiency model','Inspect all 50','not a model probability','Prior-game input provenance'])assert.ok(html.includes(phrase),phrase);
  assert.equal((html.match(/<tr>/g)||[]).length,51);assert.match(summary,/did not beat the benchmark/);assert.match(summary,/All 285 games/);
  assert.match(provenance,/previously inspected/);assert.match(provenance,/not authenticated sportsbook fair probabilities/);assert.match(provenance,/qualified prospective-outcome count/);
  g.home='<img src=x onerror=alert(1)>';g.models.market.label='<script>bad</script>';
  assert.doesNotMatch(renderGame(g),/<img|<script>/);assert.match(renderGame(g),/&lt;script&gt;/);
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('Late game successes/errors cannot replace a newer selection',async()=>{
  for(const reject of [false,true]){
    const {view}=fixture(),ids=view.summary().games.slice(0,2).map(g=>g.gameId),a=deferred(),b=deferred(),updates=[];let calls=0;
    const loader=createGameLoader(()=>++calls===1?a.promise:b.promise,x=>updates.push(x));const first=loader.load(ids[0]),second=loader.load(ids[1]);
    b.resolve(view.game(ids[1]));await second;reject?a.reject(Error('late')):a.resolve(view.game(ids[0]));await first;
    assert.equal(updates.at(-1).status,'ready');assert.equal(updates.at(-1).gameId,ids[1]);assert.equal(updates.filter(x=>x.status==='ready').length,1);
  }
});
test('Empty-filter cancellation invalidates pending detail and malformed response has no fallback',async()=>{
  const {view}=fixture(),id=view.summary().games[0].gameId,pending=deferred(),updates=[];
  const loader=createGameLoader(()=>pending.promise,x=>updates.push(x));const run=loader.load(id);loader.cancel();pending.resolve(view.game(id));await run;
  assert.deepEqual(updates.map(x=>x.status),['loading']);
  await createGameLoader(async()=>({}),x=>updates.push(x)).load(id);assert.equal(updates.at(-1).status,'error');assert.equal(updates.at(-1).game,undefined);
});
test('Standalone launcher remains isolated from credentials, storage and network source clients',async()=>{
  const js=await readFile(new URL('../public/historical-evaluation.js',import.meta.url),'utf8');
  const server=await readFile(new URL('../src/historical-local-server.mjs',import.meta.url),'utf8');
  const production=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(js,/localStorage\s*[.(]|Authorization|Bearer|x-betq-paid-request|https?:\/\//);
  assert.doesNotMatch(server,/from ['"].*(?:odds|server\.mjs|shadow|evidence-feed)/);
  assert.doesNotMatch(production,/historical-local-server/);assert.match(server,/listen\(port,'127\.0\.0\.1'/);
});
test('Static controls have labels, status regions, mobile breakpoints and no inline scripts',async()=>{
  const html=await readFile(new URL('../public/historical-evaluation.html',import.meta.url),'utf8'),css=await readFile(new URL('../public/historical-evaluation.css',import.meta.url),'utf8');
  assert.match(html,/lang="en"/);assert.match(html,/class="skip-link"/);assert.match(html,/id="game-status" role="status"/);
  assert.match(html,/<label>Game<select id="game"/);assert.match(html,/<label>Find a team or game<input/);
  assert.match(css,/@media\(max-width:420px\)/);assert.match(css,/min-height:44px/);assert.match(css,/\.table-scroll\{overflow-x:auto/);
  assert.doesNotMatch(html,/\sonclick=|\sonchange=|<script>/);
});
test('Non-game fragments never request a game or replace skip-link navigation',()=>{
  const {view}=fixture(),games=view.summary().games;
  assert.equal(gameIdFromHash('#main',games),null);assert.equal(gameIdFromHash('#unknown',games),null);
  assert.equal(gameIdFromHash('#'+games[0].gameId,games),games[0].gameId);
  assert.equal(gameIdFromHash('#2025_99_ZZ_YY',games),null);
});
async function domFixture(){
  const {view}=fixture(),nodes=new Map(),listeners=new Map(),calls=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,
    listeners:new Map(),addEventListener(name,fn){this.listeners.set(name,fn);}});return nodes.get(id);};
  const location={hash:''},historyCalls=[];
  const context={document:{getElementById:node},window:{addEventListener:(name,fn)=>listeners.set(name,fn)},location,
    history:{pushState(a,b,hash){location.hash=hash;historyCalls.push(['push',hash]);},replaceState(a,b,hash){location.hash=hash;historyCalls.push(['replace',hash]);}},
    fetch:async path=>{calls.push(path);if(path==='/api/historical-evaluation')return {ok:true,json:async()=>view.summary()};
      const gameId=new URL(path,'http://127.0.0.1').searchParams.get('gameId');return {ok:true,json:async()=>view.game(gameId)};}};
  const js=await readFile(new URL('../public/historical-evaluation.js',import.meta.url),'utf8');
  vm.runInNewContext(js.replace(/^export /gm,''),context);await new Promise(resolve=>setImmediate(resolve));
  return {view,node,listeners,calls,location,historyCalls,context,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('DOM initialization, filters, empty results and retry operate without live-source paths',async()=>{
  const h=await domFixture();assert.match(h.node('index-status').textContent,/285 frozen records loaded/);
  assert.equal(h.node('browser').hidden,false);assert.match(h.node('game-detail').innerHTML,/ACTUAL SCORE/);
  h.node('phase').value='POST';h.node('phase').listeners.get('change')();await h.flush();assert.match(h.node('filter-status').textContent,/13 of 285/);
  h.node('search').value='no match';h.node('search').listeners.get('input')();await h.flush();assert.equal(h.node('game').disabled,true);
  assert.equal(h.node('game-panel').hidden,true);assert.equal(h.node('game-detail').innerHTML,'');assert.match(h.node('summary').innerHTML,/All 285 games/);
  h.node('clear-filters').listeners.get('click')();await h.flush();assert.match(h.node('filter-status').textContent,/285 of 285/);assert.equal(h.node('game-panel').hidden,false);
  h.context.fetch=async()=>({ok:false});h.node('next').listeners.get('click')();await h.flush();assert.equal(h.node('retry-game').hidden,false);assert.equal(h.node('game-detail').innerHTML,'');
  assert.ok(h.calls.every(p=>p==='/api/historical-evaluation'||p.startsWith('/api/historical-evaluation/game?gameId=')));
});
test('Skip link preserves filters and selection; Back restores the requested game',async()=>{
  const h=await domFixture();h.node('week').value='3';h.node('week').listeners.get('change')();await h.flush();
  const selected=h.node('game').value,heading=h.node('game-heading').textContent,calls=h.calls.length;
  h.location.hash='#main';h.listeners.get('popstate')();await h.flush();
  assert.equal(h.node('week').value,'3');assert.equal(h.node('game').value,selected);assert.equal(h.node('game-heading').textContent,heading);
  assert.equal(h.location.hash,'#main');assert.equal(h.calls.length,calls);
  const target=h.view.summary().games[15].gameId;h.location.hash='#'+target;h.listeners.get('popstate')();await h.flush();
  assert.equal(h.node('week').value,'');assert.equal(h.node('game').value,target);assert.match(h.node('game-detail').innerHTML,new RegExp(target));
  h.node('next').listeners.get('click')();await h.flush();assert.equal(h.node('game').value,h.view.summary().games[16].gameId);
  h.node('previous').listeners.get('click')();await h.flush();assert.equal(h.node('game').value,target);
});
test('Repeated and concurrent inspection reuses frozen records without losing latest selection',async()=>{
  const {view}=fixture(),id=view.summary().games[0].gameId,pending=deferred(),updates=[];let calls=0;
  const loader=createGameLoader(()=>{calls++;return pending.promise;},x=>updates.push(x));
  const a=loader.load(id),b=loader.load(id);pending.resolve(view.game(id));await Promise.all([a,b]);
  assert.equal(calls,1);assert.equal(updates.filter(x=>x.status==='ready').length,1);
  updates.at(-1).game.models.market.margin=999;await loader.load(id);
  assert.equal(calls,1);assert.equal(updates.at(-1).game.models.market.margin,8);
});
test('Rate-limited reads are distinguishable from missing data and can retry',async()=>{
  const {view}=fixture(),id=view.summary().games[0].gameId,updates=[];let calls=0;
  const loader=createGameLoader(async()=>{if(++calls===1)throw Object.assign(Error('rate'),{code:'RATE_LIMITED'});return view.game(id);},x=>updates.push(x));
  await loader.load(id);assert.equal(updates.at(-1).reason,'RATE_LIMITED');await loader.load(id);assert.equal(updates.at(-1).status,'ready');assert.equal(calls,2);
});
test('Filter keystrokes preserving the selection do not refetch or replace its detail',async()=>{
  const h=await domFixture(),count=h.calls.length,detail=h.node('game-detail').innerHTML;
  h.node('search').value='A';h.node('search').listeners.get('input')();await h.flush();
  h.node('search').value='AA';h.node('search').listeners.get('input')();await h.flush();
  assert.equal(h.calls.length,count);assert.equal(h.node('game-detail').innerHTML,detail);
  h.context.fetch=async()=>({ok:false,status:429});h.node('next').listeners.get('click')();await h.flush();
  assert.match(h.node('game-status').textContent,/Temporary historical read limit/);
});
test('Standalone command defaults to the verified bundle and binds loopback only',async t=>{
  const server=await startHistoricalLocal({port:0});t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal(server.address().address,'127.0.0.1');
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/historical-evaluation');assert.equal(response.status,200);
  const summary=await response.json();assert.equal(summary.gameCount,285);assert.equal(summary.mode,'HISTORICAL_2025_FROZEN');
  await assert.rejects(startHistoricalLocal({port:65536}));
});
