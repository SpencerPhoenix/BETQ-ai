import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildGameDossier,listGameDossiers} from '../src/game-dossier.mjs';
import {quarantineFixture} from './fixtures/quarantine-ui.mjs';
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const forecasts=await readFile(new URL('../public/retained-forecasts.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
const journal=JSON.parse(await readFile(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8'));
const options={now:Date.parse('2027-01-01T00:00:00Z')};
const index=listGameDossiers(journal,options);
const data=id=>buildGameDossier(journal,{...options,gameId:id||index.games[0].gameId});
const segment=(start,end)=>js.slice(js.indexOf(start),js.indexOf(end,js.indexOf(start)));
function harness(request=async()=>data(),state={mode:'live',sport:'americanfootball_nfl'}){
  const nodes=new Map();let focus=null,focusCalls=0;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:true,innerHTML:'',textContent:'',isConnected:true,
    focus(){focus=this;focusCalls++;},contains(target){return target?.parent===this;}});return nodes.get(id);};
  const calls=[];const context={state,$:node,Intl,requestJSON:path=>{calls.push(path);return request(path);},
    allowedTabs:['games','evidence'],setNavigation(){},renderGames(){},renderEvidence(){},
    document:{querySelectorAll:()=>[],querySelector:()=>({hidden:false,style:{}})},
    window:{scrollTo(){},matchMedia:()=>({matches:true})}};
  for(const tab of ['games','evidence'])node('page-'+tab).querySelector=()=>node(tab+'-heading');
  vm.createContext(context);
  vm.runInContext(forecasts+segment('  const esc =','  const persist =')+segment('  // Dossiers are read only','  function renderGames()')+
    segment('  function setTab(','  async function requestJSON(')+
    'globalThis.api={openGameDossier,closeGameDossier,loadRetainedGames,validDossier,dossierHTML,setTab};',context);
  return {api:context.api,nodes,node,calls,state,get focus(){return focus;},get focusCalls(){return focusCalls;}};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
test('Real bundled index works with no slate, demo and non-NFL selections, always explicitly NFL',async()=>{
  for(const state of [{mode:'live',sport:'americanfootball_nfl',slate:null},{mode:'demo',sport:'americanfootball_nfl'},{mode:'live',sport:'basketball_nba'}]){
    const h=harness(async()=>index,state);await h.api.loadRetainedGames();
    assert.match(h.node('retained-games-list').innerHTML,/data-dossier-game=/);
    assert.match(h.node('retained-games-list').innerHTML,/NFL/);assert.equal(h.focusCalls,0);
    assert.deepEqual(h.calls,['/api/research/games']);
  }
  assert.match(html,/separate from the selected odds slate and fictional demo/);
});
test('Detail renders independent Elo separately from paired derived market and all frozen provenance',async()=>{
  const h=harness();await h.api.openGameDossier('gameId',index.games[0].gameId,h.node('opener'));
  const out=h.node('game-dossier-content').innerHTML;
  for(const text of ['Independent frozen Elo','Same-capture market-derived consensus','not an independent model','Model version','Source receipt','Source freshness when this view was opened','Missing retained fields','Result qualification','Comparable games unavailable','No verified betting edge','No verified injury','Retained capture history'])assert.ok(out.includes(text),text);
  assert.match(out,/Stale retained source/);assert.equal(h.focus.id,'game-dossier-heading');assert.equal(h.focusCalls,1);
  assert.doesNotMatch(out,/data-paper|data-mode|data-action="refresh"/);
});
test('Open focuses the stable heading, but completion never steals moved focus',async()=>{
  const pending=deferred(),h=harness(()=>pending.promise);const run=h.api.openGameDossier('gameId',index.games[0].gameId,h.node('opener'));
  assert.equal(h.focus.id,'game-dossier-heading');h.node('outside').focus();pending.resolve(data());await run;
  assert.equal(h.focus.id,'outside');assert.equal(h.focusCalls,2);
});
test('Closing invalidates an in-flight response and returns to the original opener',async()=>{
  const pending=deferred(),h=harness(()=>pending.promise),opener=h.node('opener');
  const run=h.api.openGameDossier('gameId',index.games[0].gameId,opener);h.api.closeGameDossier();
  assert.equal(h.focus,opener);pending.resolve(data());await run;
  assert.equal(h.node('game-dossier').hidden,true);assert.equal(h.node('game-dossier-content').innerHTML,'');
});
test('Removed opener falls back to the Games heading, and background closure never steals focus',async()=>{
  const h=harness(),opener=h.node('opener');await h.api.openGameDossier('gameId',index.games[0].gameId,opener);
  opener.isConnected=false;h.api.closeGameDossier();assert.equal(h.focus.id,'games-heading');
  h.node('outside').focus();h.api.closeGameDossier(false);assert.equal(h.focus.id,'outside');
});
test('Older successes and failures cannot replace a newer game',async()=>{
  for(const failure of [false,true]){
    const a=deferred(),b=deferred();let count=0;const h=harness(()=>++count===1?a.promise:b.promise);
    const first=h.api.openGameDossier('gameId',index.games[0].gameId,h.node('a'));
    const second=h.api.openGameDossier('gameId',index.games[1].gameId,h.node('b'));
    b.resolve(data(index.games[1].gameId));await second;const output=h.node('game-dossier-content').innerHTML;
    failure?a.reject(Error('late failure')):a.resolve(data());await first;
    assert.equal(h.node('game-dossier-content').innerHTML,output);assert.equal(h.focusCalls,2);
  }
});
test('Missing game is honest and never creates a fake/demo dossier',async()=>{
  const h=harness(async()=>{const e=Error('not found');e.code='GAME_NOT_FOUND';throw e;});
  await h.api.openGameDossier('providerEventId','unknown',h.node('open'));
  assert.match(h.node('game-dossier-status').textContent,/No retained NFL dossier matches/);
  assert.equal(h.node('game-dossier-content').innerHTML,'');
  for(const state of [{mode:'demo',sport:'americanfootball_nfl'},{mode:'live',sport:'basketball_nba'}]){
    const blocked=harness(undefined,state);await blocked.api.openGameDossier('providerEventId','id',blocked.node('open'));
    assert.equal(blocked.calls.length,0);assert.equal(blocked.focusCalls,0);
  }
});
test('Missing, corrupt, summary-preview and mismatched identity contracts fail closed',async()=>{
  const good=data();const broken=[null,{}, {schema:1,forecasts:[good.firstFrozenBaseline]},
    {...good,schema:2},{...good,source:'PUBLIC_JOURNAL'},{...good,limitations:{}},
    {...good,firstFrozenBaseline:null},{...good,latestSnapshot:{...good.latestSnapshot,home:'OTHER'}},
    {...good,history:{snapshots:[]}},{...good,comparableGames:{available:true}},
    {...good,firstFrozenBaseline:{...good.firstFrozenBaseline,modelHomeProbability:4}}];
  for(const value of broken){const h=harness(async()=>value);await h.api.openGameDossier('gameId',good.game.gameId,h.node('open'));
    assert.match(h.node('game-dossier-status').textContent,/Dossier unavailable/);assert.equal(h.node('game-dossier-content').innerHTML,'');}
  const h=harness();await h.api.openGameDossier('providerEventId','wrong-event',h.node('open'));
  assert.match(h.node('game-dossier-status').textContent,/Dossier unavailable/);
});
test('Missing source provenance has explicit unavailable states rather than invented values',async()=>{
  const d=data();for(const shot of [d.firstFrozenBaseline,d.latestSnapshot,...d.history.snapshots]){
    shot.sourceReceivedAt=null;shot.modelHomeProbability=null;shot.marketHomeProbability=null;
    shot.eligibility.model=false;shot.eligibility.market=false;shot.missingness=['sourceReceivedAt'];
  }
  const h=harness(async()=>d);await h.api.openGameDossier('gameId',d.game.gameId,h.node('open'));
  const out=h.node('game-dossier-content').innerHTML;assert.match(out,/receipt not retained/);assert.match(out,/required model provenance missing/);
  assert.match(out,/required paired market provenance missing/);
});
test('Retained strings and attribute IDs are escaped, never interpreted as HTML',async()=>{
  const payload='<img src=x onerror="alert(1)">';
  const h=harness(async()=>({...index,games:index.games.map((g,i)=>i?g:{...g,gameId:payload,home:payload})}));
  await h.api.loadRetainedGames();const list=h.node('retained-games-list').innerHTML;
  assert.doesNotMatch(list,/<img/);assert.match(list,/&lt;img/);assert.match(list,/&quot;/);
  const d=data();d.firstFrozenBaseline.modelVersion=payload;d.firstFrozenBaseline.missingness=[payload];
  const detail=h.api.dossierHTML(d);assert.doesNotMatch(detail,/<img/);assert.match(detail,/&lt;img/);
});
test('Index empty and error contracts are distinguishable, no preview or fallback to provider',async()=>{
  for(const [response,pattern] of [[{...index,games:[],total:0,truncated:false,quarantine:undefined},/No retained NFL game records/],[{},/index unavailable/]]){
    const h=harness(async()=>response);await h.api.loadRetainedGames();assert.match(h.node('retained-games-list').innerHTML,pattern);
    assert.deepEqual(h.calls,['/api/research/games']);
  }
});
test('Current real NFL cards have research controls even without a qualifying quote',()=>{
  const nodes=new Map();const state={mode:'live',sport:'americanfootball_nfl',slate:{events:[{id:'event"<id>',homeTeam:'Home',awayTeam:'Away'}]}};
  const context={state,$:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:''});return nodes.get(id);},sportLabels:{americanfootball_nfl:'NFL'},empty:()=>'',statusTag:String};
  vm.runInNewContext(segment('  const esc =','  const persist =')+segment('  function renderGames()','  function renderSignals()')+'renderGames();',context);
  assert.match(nodes.get('game-grid').innerHTML,/data-dossier-provider="event&quot;&lt;id&gt;"/);
  assert.match(nodes.get('game-grid').innerHTML,/No qualifying quotes/);
});
test('Inline semantics, Escape scope, touch sizes and render isolation protect keyboard focus',()=>{
  assert.match(html,/id="game-dossier"[^>]+aria-labelledby="game-dossier-heading" hidden/);
  assert.match(html,/id="game-dossier-heading" tabindex="-1"/);assert.match(html,/data-action="close-dossier"/);
  assert.match(js,/event.key === 'Escape' && dossierOpen && \$\('game-dossier'\).contains\(event.target\)/);
  assert.match(js,/if \(tab !== 'games'\) closeGameDossier\(false\)/);
  assert.doesNotMatch(segment('  function render()','  async function loadIntelligence()'),/openGameDossier|dossierHTML|loadRetainedGames/);
  assert.match(css,/\.game-dossier button[^}]+min-height:44px/);assert.match(css,/\.dossier-grid,\.retained-game-list\{grid-template-columns:1fr/);
});
test('Availability, timestamps, chronology and contradictory settlement qualification fail closed',()=>{
  const good=data(),h=harness();
  const check=d=>h.api.validDossier(d,'gameId',d.game.gameId);
  assert.equal(check(good),true);
  for(const mutation of [{available:false},{generatedAt:'bad'},
    {firstFrozenBaseline:{...good.firstFrozenBaseline,capturedAt:'2099-01-01T00:00:00Z'}},
    {firstFrozenBaseline:{...good.firstFrozenBaseline,season:1900}},
    {result:{...good.game,sourceCorroborated:false,modelQualified:true,scoringEligible:true,officialLeagueCertification:false,outcome:'HOME',homeScore:21,awayScore:10}},
    {result:{...good.game,sourceCorroborated:true,modelQualified:false,scoringEligible:true,officialLeagueCertification:false,outcome:'HOME',homeScore:21,awayScore:10}},
    {result:{...good.game,sourceCorroborated:true,modelQualified:true,scoringEligible:true,officialLeagueCertification:false,outcome:'TIE',homeScore:21,awayScore:21}},
    {result:{...good.game,home:'OTHER',sourceCorroborated:true,modelQualified:true,scoringEligible:true,officialLeagueCertification:false,outcome:'HOME',homeScore:21,awayScore:10}}])assert.equal(check({...good,...mutation}),false);
});
test('Missing model version stays visible without hiding otherwise eligible frozen research',async()=>{
  const d=data();d.firstFrozenBaseline.modelVersion=null;d.firstFrozenBaseline.missingness.push('modelVersion');
  const h=harness(async()=>d);await h.api.openGameDossier('gameId',d.game.gameId,h.node('open'));
  const out=h.node('game-dossier-content').innerHTML;assert.match(out,/Independent frozen Elo/);
  assert.match(out,/Model version \/ built \(UTC\)<\/dt><dd>Not retained/);assert.match(out,/modelVersion/);
});
test('Freshness expires immediately after ten minutes rather than rounding down',()=>{
  const d=data(),h=harness();d.firstFrozenBaseline.sourceReceivedAt=new Date(Date.now()-600100).toISOString();
  assert.match(h.api.dossierHTML(d),/Stale retained source · 10 minutes old/);
});
test('Truncated index discloses visible and total counts',async()=>{
  const h=harness(async()=>({...index,total:1001,truncated:true,games:index.games.slice(0,1),quarantine:undefined}));await h.api.loadRetainedGames();
  assert.match(h.node('retained-games-list').innerHTML,/Showing 1 of 1001 retained NFL games/);
  assert.match(h.node('retained-games-list').innerHTML,/not the complete journal/);
});

test('Validated public retained dossiers and index display source provenance without inventing a new capture',async()=>{
  const publication={source:'PUBLIC_JOURNAL',status:'PUBLIC_JOURNAL_READ',journalSha256:'a'.repeat(64),
    lastSuccessfulFetchAt:'2027-01-01T00:00:00.000Z',latestSnapshotAt:journal.snapshots.at(-1).capturedAt,lastError:null};
  const publicIndex=listGameDossiers(journal,{...options,publication});
  const h=harness(async()=>publicIndex);await h.api.loadRetainedGames();
  assert.match(h.node('retained-games-list').innerHTML,/data-dossier-game=/);
  const dossier=buildGameDossier(journal,{...options,gameId:index.games[0].gameId,publication});
  const view=harness(async()=>dossier);await view.api.openGameDossier('gameId',dossier.game.gameId,view.node('open'));
  const output=view.node('game-dossier-content').innerHTML;
  assert.match(output,/validated public retained journal/);
  assert.match(output,/this is not a new forecast capture/);
  assert.equal(dossier.firstFrozenBaseline.capturedAt,data().firstFrozenBaseline.capturedAt);
});
test('Public retained source requires a valid journal digest; failed refresh retains an explicit warning',async()=>{
  const publication={source:'PUBLIC_JOURNAL',status:'REFRESH_FAILED_USING_RETAINED_EVIDENCE',journalSha256:'b'.repeat(64),
    lastError:'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID'};
  const dossier=buildGameDossier(journal,{...options,gameId:index.games[0].gameId,publication});
  const good=harness(async()=>dossier);await good.api.openGameDossier('gameId',dossier.game.gameId,good.node('open'));
  assert.match(good.node('game-dossier-content').innerHTML,/Latest journal read failed/);
  for(const malformed of [null,{...publication,journalSha256:'invalid'}, {...publication,source:'UNREVIEWED_SOURCE'}]){
    const bad=harness(async()=>({...dossier,publication:malformed}));await bad.api.openGameDossier('gameId',dossier.game.gameId,bad.node('open'));
    assert.match(bad.node('game-dossier-status').textContent,/Dossier unavailable/);
  }
});

test('Index discloses every quarantined identity and kickoff without an eligible game button',async()=>{
  const h=harness(async()=>index);await h.api.loadRetainedGames();const out=h.node('retained-games-list').innerHTML;
  for(const pattern of [/Quarantined games: 1 of 44/,/Excluded snapshots: 9 of 323/,/Excluded result records: 1 of 18/,
    /LV @ SF/,/2026_09_LV_SF/,/2026-11-08T21:05:00.000Z/,/2026-11-08T21:25:00.000Z/,
    /excluded from forecast rankings, scoring and further collection/,/Showing 43 of 43 retained NFL games outside quarantine/])assert.match(out,pattern);
  assert.equal((out.match(/data-dossier-game=/g)||[]).length,43);
  assert.doesNotMatch(out,/data-dossier-game="2026_09_LV_SF"/);assert.equal(h.focusCalls,0);
});

test('Malformed quarantine, overlapping games and silently missing index entries fail closed',async()=>{
  for(const mutate of [d=>{d.quarantine=null;},d=>{d.quarantine.excludedSnapshotCount++;},
    d=>{d.quarantine.games[0].collectionEligible=true;},d=>{d.quarantine.games[0].observedCommenceTimes=['bad'];},
    d=>{d.games[0].gameId=d.quarantine.games[0].gameId;},d=>{d.games.pop();},
    d=>{d.total++;d.truncated=true;},d=>{d.games[0].snapshotCount++;}]){
    const d=structuredClone(index);mutate(d);const h=harness(async()=>d);await h.api.loadRetainedGames();
    const out=h.node('retained-games-list').innerHTML;assert.match(out,/index unavailable/);assert.doesNotMatch(out,/data-dossier-game=/);
  }
});

test('Conflict HTTP409 remains read only and preserves close, focus and late-response isolation',async()=>{
  const q=quarantineFixture(),error=Object.assign(Error('quarantined'),{code:'SCHEDULE_CONFLICT_QUARANTINED',
    data:{available:false,reason:'SCHEDULE_CONFLICT_QUARANTINED',quarantine:q,conflict:{history:{snapshots:[{modelHomeProbability:.99}]}}}});
  const h=harness(async()=>{throw error;});const opener=h.node('opener');
  await h.api.openGameDossier('gameId','synthetic-conflict',opener);
  assert.equal(h.focus.id,'game-dossier-heading');assert.match(h.node('game-dossier-content').innerHTML,/HOME/);
  assert.match(h.node('game-dossier-content').innerHTML,/2026-11-08T21:00:00.000Z/);
  assert.doesNotMatch(h.node('game-dossier-content').innerHTML,/99|Independent frozen Elo|meter|data-paper/);
  assert.match(h.node('game-dossier-status').textContent,/No eligible forecast is displayed/);
  h.api.closeGameDossier();assert.equal(h.focus,opener);assert.equal(h.node('game-dossier').hidden,true);
  const pending=deferred(),late=harness(()=>pending.promise),run=late.api.openGameDossier('gameId','synthetic-conflict',late.node('open'));
  late.api.closeGameDossier(false);pending.reject(error);await run;assert.equal(late.node('game-dossier-content').innerHTML,'');
  assert.match(segment('  async function requestJSON(','  function renderBanner()'),/error.data = data/);
});

test('Eligible dossier cannot include an explicitly quarantined game or malformed quarantine metadata',()=>{
  const d=data(),h=harness();
  for(const q of [null,{...index.quarantine,historyPreserved:false}])assert.equal(h.api.validDossier({...d,quarantine:q},'gameId',d.game.gameId),false);
  const q=quarantineFixture();q.games[0].gameId=d.game.gameId;
  assert.equal(h.api.validDossier({...d,quarantine:q},'gameId',d.game.gameId),false);
});

test('The real conflict response retains HTTP409 metadata but never renders historical probabilities',async()=>{
  const body=buildGameDossier(journal,{...options,gameId:'2026_09_LV_SF'});
  assert.equal(body.reason,'SCHEDULE_CONFLICT_QUARANTINED');
  const response={...body,error:{code:body.reason,message:'Conflicting retained kickoff times'}};
  const context={fetch:async()=>({ok:false,status:409,json:async()=>response})};
  vm.runInNewContext(segment('  async function requestJSON(','  function renderBanner()')+'globalThis.request=requestJSON;',context);
  await assert.rejects(()=>context.request('/api/research/game?gameId=2026_09_LV_SF'),e=>e.code===body.reason&&e.data===response);
  const h=harness(context.request);await h.api.openGameDossier('gameId','2026_09_LV_SF',h.node('open'));
  assert.match(h.node('game-dossier-content').innerHTML,/2026-11-08T21:05:00.000Z/);
  assert.match(h.node('game-dossier-content').innerHTML,/2026-11-08T21:25:00.000Z/);
  assert.doesNotMatch(h.node('game-dossier-content').innerHTML,/Independent frozen Elo|Same-capture market-derived consensus|<meter|80\.9%/);
});

test('Navigate away and back during a pending conflict cannot restore dismissed content or steal focus',async()=>{
  const pending=deferred(),h=harness(()=>pending.promise);
  const run=h.api.openGameDossier('gameId','synthetic-conflict',h.node('open'));
  h.api.setTab('evidence');assert.equal(h.node('game-dossier').hidden,true);assert.equal(h.focus.id,'evidence-heading');
  h.api.setTab('games');assert.equal(h.focus.id,'games-heading');
  pending.reject(Object.assign(Error('quarantined'),{code:'SCHEDULE_CONFLICT_QUARANTINED',data:{quarantine:quarantineFixture()}}));
  await run;assert.equal(h.node('game-dossier').hidden,true);assert.equal(h.node('game-dossier-content').innerHTML,'');
  assert.equal(h.focus.id,'games-heading');
});

test('An all-quarantined index preserves disclosure even with no eligible games',async()=>{
  const h=harness(async()=>({...index,games:[],total:0,truncated:false,quarantine:quarantineFixture()}));
  await h.api.loadRetainedGames();const out=h.node('retained-games-list').innerHTML;
  assert.match(out,/Quarantined games: 1 of 1/);assert.match(out,/AWAY @ HOME/);
  assert.match(out,/No retained NFL game records are available outside quarantine/);assert.doesNotMatch(out,/data-dossier-game=/);
});

test('Missing or malformed HTTP409 quarantine details remain visibly unavailable without a forecast',async()=>{
  for(const quarantine of [undefined,null,{}]){
    const h=harness(async()=>{throw Object.assign(Error('quarantined'),{code:'SCHEDULE_CONFLICT_QUARANTINED',data:{quarantine}});});
    await h.api.openGameDossier('gameId','synthetic-conflict',h.node('open'));
    assert.match(h.node('game-dossier-content').innerHTML,/Schedule conflict details unavailable/);
    assert.doesNotMatch(h.node('game-dossier-content').innerHTML,/<meter|data-dossier-game|Independent frozen Elo/);
  }
});
