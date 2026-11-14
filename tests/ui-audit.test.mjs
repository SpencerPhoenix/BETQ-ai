import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
const code=(start,end)=>js.slice(js.indexOf(start),js.indexOf(end,js.indexOf(start)));
const formatting=code('  const esc =','  const persist =');
const game=(id='one')=>({id,homeTeam:'Home & <Team>',awayTeam:'Away',commenceTime:'2099-01-01T12:00:00Z',bookmakerCount:4,totalMarkets:2,
  topSignal:{id:'pick-"<x>',evPercent:3},opportunities:[]});
function render(segment,statement,state,extra={}){
  const nodes=new Map();
  const context={state,Intl,$:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:''});return nodes.get(id);},
    sportLabels:{americanfootball_nfl:'NFL'},statusTag:x=>String(x),empty:(title,detail)=>'<p>'+title+' '+detail+'</p>',...extra};
  vm.runInNewContext(formatting+segment+statement,context);
  return {nodes,context};
}
test('Game Monitor renders complete cards, counts and escaped Inspect controls',()=>{
  const {nodes}=render(code('  function renderGames()','  function renderSignals()'),'renderGames();',
    {mode:'live',sport:'americanfootball_nfl',slate:{events:[game(),{...game('two'),topSignal:null}]}});
  const out=nodes.get('game-grid').innerHTML;
  assert.equal((out.match(/<article/g)||[]).length,2);assert.equal((out.match(/<\/article>/g)||[]).length,2);
  assert.match(out,/4 sportsbooks · 2 matched contract\(s\)/);
  assert.match(out,/Inspect \+3\.0% price scenario/);assert.match(out,/data-pick="pick-&quot;&lt;x&gt;"/);
  assert.match(out,/Home &amp; &lt;Team&gt;/);assert.doesNotMatch(out,/<x>/);
  assert.match(out,/No qualifying quotes/);
});
test('Game Monitor empty state is complete and demo never invents scores',()=>{
  const {nodes}=render(code('  function renderGames()','  function renderSignals()'),'renderGames();',
    {mode:'demo',sport:'americanfootball_nfl',slate:{events:[]}});
  assert.match(nodes.get('game-grid').innerHTML,/No upcoming games/);
  assert.match(nodes.get('scores').innerHTML,/No fictitious final results/);
});
const signal=(id,status)=>({id,status,selection:id,bookmaker:'Book',americanOdds:110,fairProbability:.5,edgePoints:2,evPercent:3,
  qualityScore:70,comparatorBooks:3,quoteAgeSeconds:30,contractLabel:'Moneyline',reasons:[],event:game()});
function signals(only,saved,query=''){
  return render(code('  function renderSignals()','  function isWatched('),'renderSignals();',
    {watchOnly:only,search:query,sort:'ev',selectedId:null,slate:{executionGate:{bettingAuthorized:false}}},
    {all:()=>[signal('saved-pass','PASS'),signal('unsaved-watch','WATCH')],isWatched:id=>saved.includes(id),eventLabel:e=>e.awayTeam+' @ '+e.homeTeam}).nodes.get('signal-grid').innerHTML;
}
test('Saved only includes saved PASS and excludes unsaved algorithm WATCH',()=>{
  const out=signals(true,['saved-pass']);assert.match(out,/data-watch="saved-pass"/);
  assert.doesNotMatch(out,/data-watch="unsaved-watch"/);assert.match(out,/aria-pressed="true"/);
});
test('Saved filter composes with search and explains missing quotes without deleting saves',()=>{
  const saved=['saved-pass'];const out=signals(true,saved,'unmatched');
  assert.match(out,/No saved signals in this snapshot/);assert.match(out,/data-action="clear-watch-filter"/);
  assert.deepEqual(saved,['saved-pass']);assert.match(signals(false,saved),/data-watch="unsaved-watch"/);
});
test('Watch persistence failures do not claim a save or update the rendered state',()=>{
  let renders=0,message='';
  const context={safeGet:()=>[],localStorage:{setItem(){throw Error('blocked');}},
    renderSignals(){renders++;},renderSpotlight(){renders++;},retainQuoteFocus:fn=>fn(),toast:x=>message=x};
  vm.runInNewContext(code('  function toggleWatch(','  function stagePaper(')+"toggleWatch('x');",context);
  assert.equal(renders,0);assert.match(message,/could not be saved/);
});
test('Paper empty state explains the lock and offers supported research actions',()=>{
  const {nodes}=render(code('  function renderExecution()','  function auditRow('),'renderExecution();',
    {ledger:[],bankroll:1000,maxRisk:1});const out=nodes.get('execution-view').innerHTML;
  assert.match(out,/NEW PAPER STAGING IS LOCKED/);assert.match(out,/No paper tickets · staging locked/);
  assert.match(out,/data-tab="pricing"/);assert.match(out,/data-tab="signals"/);
  assert.doesNotMatch(out,/stage a WATCH|stage a contract|Stage paper ticket/);
});
test('Existing local paper records retain manual settlement controls and unverified labels',()=>{
  const ledger=[{id:'paper-1',status:'OPEN',selection:'Home',game:'Away @ Home',bookmaker:'Book',odds:110,stake:10,pnl:null,sourceMode:'demo'}];
  const before=JSON.stringify(ledger);
  const {nodes}=render(code('  function renderExecution()','  function auditRow('),'renderExecution();',
    {ledger,bankroll:1000,maxRisk:1});const out=nodes.get('execution-view').innerHTML;
  assert.match(out,/data-settle="paper-1"/);assert.match(out,/data-result="VOID"/);
  assert.match(out,/manually entered, not verified/);assert.equal(JSON.stringify(ledger),before);
});
test('Public requests cannot opt into paid refreshes or send authentication',async()=>{
  const calls=[];const context={fetch:async(path,init)=>{calls.push({path,init});return {ok:true,json:async()=>({})};}};
  vm.runInNewContext(code('  async function requestJSON(','  function renderBanner(')+'globalThis.request=requestJSON;',context);
  await context.request('/api/slate');await context.request('/api/slate',{paidRequest:false});
  await context.request('/api/slate',{paidRequest:true});
  assert.equal(calls[0].init.headers['x-betq-paid-request'],undefined);
  assert.equal(calls[1].init.headers['x-betq-paid-request'],undefined);
  assert.equal(calls[2].init.headers['x-betq-paid-request'],undefined);
  assert.ok(calls.every(call=>call.init.headers.Authorization===undefined));
  assert.doesNotMatch(js,/x-betq-paid-request|BETQ_OPERATOR_REFRESH_TOKEN|Bearer /);
});
test('Cached-only error propagates its code for a clear explicit-refresh prompt',async()=>{
  const context={fetch:async()=>({ok:false,status:409,json:async()=>({error:{code:'PAID_REFRESH_REQUIRED',message:'Use explicit refresh'}})})};
  vm.runInNewContext(code('  async function requestJSON(','  function renderBanner(')+'globalThis.request=requestJSON;',context);
  await assert.rejects(()=>context.request('/api/slate'),e=>e.code==='PAID_REFRESH_REQUIRED');
  const root={innerHTML:'',classList:{remove(){},add(){}}};
  vm.runInNewContext(formatting+code('  function renderBanner()','  function renderFeed()')+'renderBanner();',
    {state:{mode:'live',error:{code:'PAID_REFRESH_REQUIRED'}},$:()=>root});
  assert.match(root.innerHTML,/NO CACHED ODDS AVAILABLE/);assert.match(root.innerHTML,/authenticated operator/);
});
function element(){
  const attrs=new Map(),classes=new Set();return {attrs,classes,inert:false,hidden:false,focusCount:0,
    classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);}},
    setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),
    focus(){this.focusCount++;},querySelector(){return null;}};
}
test('Mobile drawer open/close and desktop resize preserve keyboard access and semantics',()=>{
  const nodes=Object.fromEntries(['sidebar','workspace','nav-backdrop','menu-toggle','menu-close'].map(id=>[id,element()]));
  const mobileNavigation={matches:true};const context={mobileNavigation,$:id=>nodes[id]};
  vm.runInNewContext(code('  function setNavigation(','  function retainQuoteFocus(')+'globalThis.nav=setNavigation;',context);
  context.nav(false,false);assert.equal(nodes.sidebar.inert,true);assert.equal(nodes.workspace.inert,false);
  context.nav(true);assert.equal(nodes.sidebar.inert,false);assert.equal(nodes.workspace.inert,true);
  assert.equal(nodes['menu-toggle'].attrs.get('aria-expanded'),'true');assert.equal(nodes.sidebar.attrs.get('aria-modal'),'true');
  context.nav(false);assert.equal(nodes['menu-toggle'].focusCount,1);assert.equal(nodes['nav-backdrop'].hidden,true);
  mobileNavigation.matches=false;context.nav(false);assert.equal(nodes.sidebar.inert,false);
  assert.equal(nodes.sidebar.attrs.has('aria-hidden'),false);assert.equal(nodes.workspace.inert,false);
});
test('Quote rerender restores focus or returns it to the saved filter after removal',()=>{
  let restored=0,fallback=0;const panel={querySelectorAll:()=>[{getAttribute:()=> 'saved',focus(){restored++;}}]};
  const active={closest:()=>panel,hasAttribute:name=>name==='data-watch',getAttribute:()=> 'saved'};
  const context={document:{activeElement:active},$:()=>({focus(){fallback++;}})};
  vm.runInNewContext(code('  function retainQuoteFocus(','  function setTab(')+'globalThis.retain=retainQuoteFocus;',context);
  context.retain(()=>{});assert.equal(restored,1);
  context.retain(()=>{panel.querySelectorAll=()=>[];});assert.equal(fallback,1);
});
test('Visible labels distinguish odds format, model scope, paper lock and repeated historical inspection',()=>{
  assert.match(html,/BOOK \/ AMERICAN ODDS/);assert.match(html,/Saved only/);assert.match(html,/id="capability-note"/);
  assert.match(js,/No independent outcome forecast for this selection/);
  assert.match(js,/Odds use American format/);assert.match(js,/not an in-play stream/);
  assert.doesNotMatch(js,/Untouched 2025|2025 untouched|Untouched test set|Untouched evaluation/);
});
test('Navigation and touch/reduced-motion protections are present without inline handlers',()=>{
  assert.match(html,/aria-controls="sidebar"/);assert.match(html,/class="skip-link"/);
  assert.match(js,/event.key==='Escape'/);assert.match(js,/event.key==='Tab'/);
  assert.match(js,/setAttribute\('aria-current','page'\)/);assert.match(js,/setAttribute\('aria-pressed'/);
  assert.match(css,/min-height:44px/);assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*html\{scroll-behavior:auto;/);
  assert.match(js,/if \(pick\) \{[^\n]+retainQuoteFocus\(\(\)=>\{renderSpotlight\(\); renderOpportunities\(\);\}\)/);
  assert.match(css,/\.game-bottom \.text-link\{white-space:normal/);
  assert.doesNotMatch(html,/\sonclick=|\sonchange=/);
});

test('Overview keyboard Inspect rerender retains the selected row focus',()=>{
  let focusCount=0;const row={hasAttribute:name=>name==='data-pick',getAttribute:()=> 'pick-id',focus(){focusCount++;}};
  const panel={querySelectorAll:()=>[row]};row.closest=()=>panel;
  const context={document:{activeElement:row},$:()=>({focus(){throw Error('unexpected fallback');}})};
  vm.runInNewContext(code('  function retainQuoteFocus(','  function setTab(')+'globalThis.retain=retainQuoteFocus;',context);
  context.retain(()=>{});assert.equal(focusCount,1);
});

test('Full watchlist refuses another save without silently dropping a quote',()=>{
  const original=Array.from({length:100},(_,i)=>String(i));let message='',writes=0;
  const context={safeGet:()=>original,localStorage:{setItem(){writes++;}},toast:text=>{message=text;},retainQuoteFocus(){throw Error('unexpected render');}};
  vm.runInNewContext(code('  function toggleWatch(','  function stagePaper(')+'toggleWatch("new");',context);
  assert.match(message,/Watchlist is full/);assert.equal(writes,0);assert.equal(original.length,100);
});

 test('Cache reload failures preserve the previous same-selection snapshot, but filter changes clear it',async()=>{
  const slate={events:[],receivedAt:'2026-11-07T00:00:00Z'};
  const state={sport:'americanfootball_nfl',market:'h2h',mode:'live',slate,slateSelection:'americanfootball_nfl:h2h:live'};
  const context={state,render(){},requestJSON:async()=>{throw Error('offline');},findSignal:()=>null};
  vm.runInNewContext('let loadSerial=0;'+code('  async function loadSlate(','  let scoresLoading=')+'globalThis.load=loadSlate;',context);
  await context.load();assert.equal(state.slate,slate);assert.equal(state.error.message,'offline');
  state.market='spreads';await context.load();assert.equal(state.slate,null);
});
