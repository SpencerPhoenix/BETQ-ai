import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import {emptyJournal} from '../src/evidence.mjs';
import {listRetainedForecasts,buildGameDossier} from '../src/game-dossier.mjs';
import {createHandler} from '../src/server.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {quarantineFixture} from './fixtures/quarantine-ui.mjs';
const source=readFileSync(new URL('../public/retained-forecasts.js',import.meta.url),'utf8');
const context=vm.createContext({structuredClone});vm.runInContext(source,context);
const api=context.BETQRetainedForecasts;
const NOW=Date.parse('2026-11-07T12:01:00.000Z');
function journal(n=1){
  const j=syntheticScoringJournal(n);j.provenance=emptyJournal(2026).provenance;j.settlements=[];
  for(const s of j.snapshots){s.modelVersion='nfl-elo-1';s.marketOldestQuoteAt='2026-11-07T11:59:00.000Z';}
  return j;
}
const response=(j=journal(),now=NOW)=>listRetainedForecasts(j,{now});
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};

test('Each latest retained snapshot is displayed without changing the first scoring baseline',()=>{
  const j=journal(),first=j.snapshots[0];
  j.snapshots.unshift({...first,id:'later',capturedAt:new Date(NOW).toISOString(),modelHomeProbability:.4,marketHomeProbability:.3,challengerHomeProbability:.9});
  const before=JSON.stringify(j),d=response(j),report=api.build(d,NOW),card=report.cards[0];
  assert.equal(d.available,true);assert.equal(d.games[0].latestSnapshot.id,'later');
  assert.equal(buildGameDossier(j,{gameId:first.gameId,now:NOW}).firstFrozenBaseline.id,first.id);
  assert.equal(card.selectedTeam,'LV');assert.equal(card.selectedProbability,.6);assert.equal(card.marketProbability,.7);
  assert.equal(card.rank,1);assert.equal(JSON.stringify(j),before);
  d.games[0].latestSnapshot.modelHomeProbability=.99;assert.equal(JSON.stringify(j),before);
});

test('Latest ineligible or unsupported Elo never falls back to an earlier shot or larger challenger',()=>{
  for(const change of [{modelVersion:'unsupported'},{modelVersion:null},{modelLastResultDate:null},{modelBuiltAt:null}]){
    const j=journal();j.snapshots.push({...j.snapshots[0],...change,id:'later',capturedAt:new Date(NOW).toISOString(),challengerHomeProbability:.99});
    const r=api.build(response(j),NOW);assert.equal(r.available,true);
    assert.equal(r.cards[0].selectedProbability,null);assert.equal(r.cards[0].rank,null);
    assert.match(api.html(r),/no substitute probability/);assert.doesNotMatch(api.html(r),/99\.0%/);
  }
});

test('Ranks are outright probability comparisons within a date, not edge or challenger comparisons',()=>{
  const j=journal(3);j.snapshots[0].modelHomeProbability=.8;j.snapshots[0].marketHomeProbability=.9;
  j.snapshots[1].modelHomeProbability=.7;j.snapshots[1].marketHomeProbability=.2;
  Object.assign(j.snapshots[2],{gameDate:'2026-11-09',commenceTime:'2026-11-09T18:00:00.000Z',modelHomeProbability:.6});
  const r=api.build(response(j),NOW);assert.deepEqual(Array.from(r.cards,c=>c.rank),[1,2,1]);
  assert.equal(r.cards[0].game.gameId,'fixture-game-0');
  const out=api.html(r);for(const pattern of [/not a wager recommendation/,/not value or expected profit/,/not a validated edge/,/no-vig bookmaker consensus, not an independent forecast/,/tied-game probability/,/Spread-cover and total probabilities unavailable/,/No stake recommended/,/no per-game uncertainty interval/i])assert.match(out,pattern);
  assert.doesNotMatch(out,/data-paper|data-pick|data-action="refresh"|<form|<input/);
});

test('A 50/50 Elo has no selected side and no invented tie probability',()=>{
  const j=journal();j.snapshots[0].modelHomeProbability=.5;
  const c=api.build(response(j),NOW).cards[0];assert.equal(c.selectedTeam,null);assert.equal(c.rank,null);
  assert.match(api.html(api.build(response(j),NOW)),/no preferred side \(50\/50\)/);
});

test('Missing market data does not hide a qualified Elo forecast or fabricate an edge',()=>{
  const j=journal();delete j.snapshots[0].marketHomeProbability;
  const r=api.build(response(j),NOW);assert.equal(r.available,true);assert.equal(r.cards[0].selectedProbability,.6);
  assert.equal(r.cards[0].marketProbability,null);assert.equal(r.cards[0].rank,1);
  assert.match(api.html(r),/Model minus market<\/dt><dd>Unavailable/);
});

test('Stale, passed kickoff, recorded results and known schedule conflicts stay visible but unranked',()=>{
  const original=response();
  for(const [now,mutate,reason] of [
    [NOW+86400000,()=>{},/Stale capture/],
    [Date.parse(original.games[0].commenceTime),()=>{},/Recorded kickoff passed/],
    [NOW,d=>{d.games[0].hasRecordedResult=true;},/Recorded result exists/],
    [NOW,d=>{d.games[0].scheduleReview={status:'SCHEDULE_RECONCILIATION_REQUIRED'};},/Schedule conflict/],
    [NOW,d=>{d.games[0].scheduleReview={status:'SCHEDULE_REVIEW_IDENTITY_MISMATCH'};},/Schedule conflict/],
    [NOW,d=>{d.games[0].latestSnapshot.modelBuiltAt='2026-10-01T12:00:00.000Z';d.games[0].latestSnapshot.modelLastResultDate='2026-09-30';},/Stale model vintage/]
  ]){
    const d=structuredClone(original);mutate(d);const r=api.build(d,now);assert.equal(r.available,true);
    assert.equal(r.cards[0].rank,null);assert.equal(r.cards[0].selectedProbability,.6);assert.match(r.cards[0].status,reason);
  }
});

test('Real bundled conflicting game is visibly quarantined without ranking or displaying its probabilities',()=>{
  const j=JSON.parse(readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url)));
  const now=Math.max(...j.snapshots.map(s=>Date.parse(s.capturedAt)),...j.settlements.map(s=>Date.parse(s.verifiedAt)))+3600000,r=api.build(response(j,now),now);
  assert.equal(r.available,true);assert.equal(r.cards.length,43);
  assert.equal(r.cards.find(c=>c.game.gameId==='2026_09_LV_SF'),undefined);
  const output=api.html(r);
  for(const pattern of [/Schedule conflict quarantine/,/LV @ SF/,/2026_09_LV_SF/,/2026-11-08T21:05:00.000Z/,/2026-11-08T21:25:00.000Z/,
    /Quarantined games: 1 of 44/,/Excluded snapshots: 9 of 323/,/Excluded result records: 1 of 18/,/43 games, 314 snapshots and 17 result records/,/history is preserved unchanged/])assert.match(output,pattern);
  assert.doesNotMatch(output,/SF 80\.9%|data-retained-forecast="2026_09_LV_SF"|data-dossier-game="2026_09_LV_SF"/);
  for(const c of r.cards){
    const shots=j.snapshots.filter(s=>s.gameId===c.game.gameId).sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.id.localeCompare(b.id));
    assert.equal(c.snapshot.id,shots.at(-1).id);assert.equal(c.snapshot.modelHomeProbability,shots.at(-1).modelHomeProbability);
  }
});

test('Missing, malformed, future, duplicate and contradictory payloads fail closed',()=>{
  for(const mutate of [
    d=>{d.source='DEMO';},d=>{d.generatedAt=new Date(NOW+1).toISOString();},
    d=>{d.games.push(structuredClone(d.games[0]));d.total++;},d=>{d.games[0].latestSnapshot.home='OTHER';},
    d=>{d.games[0].latestSnapshot.modelHomeProbability=1.1;},d=>{d.games[0].latestSnapshot.modelBuiltAt=null;},
    d=>{d.games[0].latestSnapshot.modelLastResultDate='2026-11-07';},
    d=>{d.games[0].latestSnapshot.sourceReceivedAt='2026-11-07T10:00:00.000Z';},
    d=>{d.games[0].latestSnapshot.marketNewestQuoteAt=new Date(NOW+1).toISOString();},
    d=>{d.games[0].latestSnapshot.marketBookCount=2;},d=>{d.limitations.wagerRecommendation=true;},
    d=>{d.games[0].latestSnapshot.labels.market='INDEPENDENT_RESEARCH_MODEL';},
    d=>{d.latestSnapshotAt='2026-11-06T00:00:00.000Z';},d=>{d.truncated=true;}
  ]){const d=response();mutate(d);const r=api.build(d,NOW);assert.equal(r.available,false);assert.match(api.html(r),/No replacement forecast or live odds request/);}
  for(const data of [null,{},undefined])assert.equal(api.build(data,NOW).available,false);
  assert.equal(api.build(response(),NaN).available,false);
});

test('Public source requires consistent digest metadata and reports retained fallback on read failure',()=>{
  const d=response();d.source='PUBLIC_RETAINED_JOURNAL';
  assert.equal(api.build(d,NOW).available,false);
  d.publication={source:'PUBLIC_JOURNAL',journalSha256:'a'.repeat(64),latestSnapshotAt:d.latestSnapshotAt,lastError:'FETCH_FAILED'};
  let r=api.build(d,NOW);assert.equal(r.available,true);assert.match(api.html(r),/Latest journal read failed; last validated retained records are shown/);
  assert.match(api.html(r),/validated public retained journal/);
  d.publication.latestSnapshotAt=null;assert.equal(api.build(d,NOW).available,false);
});

test('Oldest quote chronology is disclosed when retained and never inferred from newest',()=>{
  const d=response(),s=d.games[0].latestSnapshot;
  s.marketOldestQuoteAt=null;
  assert.match(api.html(api.build(d,NOW)),/Market oldest quote UTC<\/dt><dd>Not retained/);
  const legacy=api.build(d,NOW);assert.equal(legacy.cards[0].marketProbability,null);assert.equal(legacy.cards[0].unqualifiedMarketProbability,.55);
  assert.match(api.html(legacy),/Archived market · unqualified/);assert.match(api.html(legacy),/Model minus market<\/dt><dd>Unavailable/);
  s.marketOldestQuoteAt='2026-11-07T11:59:00.000Z';
  const r=api.build(d,NOW);assert.equal(r.available,true);assert.match(api.html(r),/Market oldest quote UTC<\/dt><dd>2026-11-07T11:59:00.000Z/);
  assert.match(r.cards[0].marketStatus,/Oldest and newest contributing quote times are retained/);
  for(const oldest of ['invalid','2026-11-07T11:59:59.000Z','2026-11-07T11:49:59.000Z',new Date(NOW+1).toISOString()]){
    s.marketOldestQuoteAt=oldest;assert.equal(api.build(d,NOW).available,false);
  }
});

test('Empty retained evidence is an honest empty state rather than demo forecasts',()=>{
  const r=api.build(response(emptyJournal(2026)),NOW);assert.equal(r.available,true);assert.equal(r.cards.length,0);
  assert.match(api.html(r),/No retained NFL forecasts are available/);
});

test('Rendering escapes retained labels and never offers wagering or networking controls',()=>{
  const d=response();d.games[0].home=d.games[0].latestSnapshot.home='<img src=x onerror="evil()">';
  const out=api.html(api.build(d,NOW));assert.match(out,/&lt;img/);assert.doesNotMatch(out,/<img|<script|<form|<input|data-paper/);
  assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|sendBeacon|WebSocket/);
});

test('Mounted forecast ages without replacing focused controls or requesting new data',()=>{
  const fields=new Map(),el={dataset:{retainedForecast:'fixture-game-0'},querySelector(key){if(!fields.has(key))fields.set(key,{});return fields.get(key);}};
  let writes=0,output='';const root={get innerHTML(){return output;},set innerHTML(v){output=v;writes++;},querySelectorAll:()=>[el]};
  const d=response();api.mount(root,d,NOW);d.games[0].latestSnapshot.modelHomeProbability=.99;
  api.refresh(root,NOW+86400000);assert.equal(writes,1);assert.match(fields.get('[data-forecast-status]').textContent,/Stale capture/);
  assert.match(fields.get('[data-forecast-rank]').textContent,/Not ranked/);assert.match(fields.get('[data-forecast-market-status]').textContent,/Archived market reference/);
  api.refresh(root,NOW-86400000);assert.equal(writes,2);assert.match(output,/Saved forecasts unavailable/);
});

test('Newer load wins over older success or failure and one failed load clears retained context',async()=>{
  for(const fail of [false,true]){
    const root={innerHTML:'',querySelectorAll:()=>[]},a=deferred(),b=deferred(),calls=[];
    const first=api.load(root,path=>{calls.push(path);return a.promise;},()=>NOW);
    const second=api.load(root,path=>{calls.push(path);return b.promise;},()=>NOW);
    const d=response();d.games[0].home=d.games[0].latestSnapshot.home='NEW';b.resolve(d);await second;
    const rendered=root.innerHTML;fail?a.reject(Error('older failure')):a.resolve(response());await first;
    assert.equal(root.innerHTML,rendered);assert.match(rendered,/NEW/);assert.deepEqual(calls,['/api/research/forecasts','/api/research/forecasts']);
    await api.load(root,()=>Promise.reject(Error('offline')),()=>NOW);const failed=root.innerHTML;
    api.refresh(root,NOW+86400000);assert.equal(root.innerHTML,failed);assert.match(failed,/Saved forecasts unavailable/);
  }
});

test('Forecast bundled fallback and static asset do not access providers or the legacy summary feed',async t=>{
  const j=journal(),before=JSON.stringify(j);let calls=0;
  const forbidden=()=>{calls++;throw Error('No external reads');};
  const server=http.createServer(createHandler({clock:()=>NOW,nflEvidenceJournal:j,
    source:{status:forbidden,getOdds:forbidden,getScores:forbidden},evidenceFeed:{get:forbidden},derivedShadowFeed:{get:forbidden}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const res=await fetch(base+'/api/research/forecasts');assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  const body=await res.json();assert.equal(body.kind,'RETAINED_NFL_OUTRIGHT_FORECASTS');assert.equal(api.build(body,NOW).available,true);
  const asset=await fetch(base+'/retained-forecasts.js');assert.equal(asset.status,200);assert.equal(await asset.text(),source);
  assert.match(asset.headers.get('content-security-policy'),/script-src 'self'/);
  for(const path of ['?refresh=true','?gameId=fixture-game-0'])assert.equal((await fetch(base+'/api/research/forecasts'+path)).status,400);
  assert.equal((await fetch(base+'/api/research/forecasts',{method:'POST'})).status,405);
  assert.equal(calls,0);assert.equal(JSON.stringify(j),before);
});

test('Invalid retained journal never produces replacement preferences from the endpoint',async t=>{
  const server=http.createServer(createHandler({clock:()=>NOW,nflEvidenceJournal:null,evidenceFeed:null}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/research/forecasts');
  assert.equal(res.status,503);assert.equal((await res.json()).error.code,'INVALID_RETAINED_JOURNAL');
});

test('Quarantine metadata is required to be complete, internally consistent and disjoint from forecasts',()=>{
  const d=response();d.quarantine=quarantineFixture({games:1,snapshots:1});
  assert.equal(api.build(d,NOW).available,true);
  for(const change of [q=>{q.policy='unknown';},q=>{q.historyPreserved=false;},q=>{q.rawGameCount=-1;},
    q=>{q.excludedGameCount++;},q=>{q.excludedSnapshotCount++;},q=>{q.excludedResultCount++;},
    q=>{q.games=[];},q=>{q.games[0].gameId=d.games[0].gameId;},q=>{q.games[0].reason='FIXED';},
    q=>{q.games[0].scoringEligible=true;},q=>{q.games[0].collectionEligible=true;},
    q=>{q.games[0].observedCommenceTimes=['bad','2026-11-08T21:00:00.000Z'];},
    q=>{q.games[0].observedCommenceTimes=['2026-11-08T18:00:00.000Z','2026-11-08T18:00:00.000Z'];},
    q=>{q.games[0].firstFrozenCommenceTime='2026-11-08T12:00:00.000Z';},q=>{q.games[0].snapshotCount=1;},
    q=>{q.rawSnapshotCount++;},q=>{q.rawGameCount++;}]){
    const broken=structuredClone(d);change(broken.quarantine);const r=api.build(broken,NOW);
    assert.equal(r.available,false);assert.doesNotMatch(api.html(r),/retained-forecast-card|<meter|data-dossier-game/);
  }
  for(const quarantine of [null,{},false])assert.equal(api.build({...d,quarantine},NOW).available,false);
  const legacy={...d};delete legacy.quarantine;assert.equal(api.build(legacy,NOW).available,true);
});

test('An all-quarantined journal is disclosed rather than silently empty and never renders probabilities',()=>{
  const d=response(emptyJournal(2026));d.quarantine=quarantineFixture();
  const r=api.build(d,NOW),out=api.html(r);assert.equal(r.available,true);
  assert.match(out,/Quarantined games: 1 of 1/);assert.match(out,/Remaining view: 0 games, 0 snapshots and 0 result records/);
  assert.match(out,/No retained NFL forecasts are available outside quarantine/);assert.match(out,/AWAY @ HOME/);
  assert.doesNotMatch(out,/retained-forecast-card|<meter|data-dossier-game/);
});

test('Quarantine labels, IDs and baseline IDs are escaped and never become actions',()=>{
  const q=quarantineFixture(),payload='<img src=x onerror="evil()">';
  q.games[0].gameId=payload;q.games[0].home=payload;q.games[0].firstFrozenSnapshotId=payload;
  const out=api.quarantineHTML(q);assert.match(out,/&lt;img/);assert.match(out,/&quot;/);
  assert.doesNotMatch(out,/<img|<script|<button|data-dossier-game|data-paper/);
});

test('Malformed quarantine warning survives a forecast failure without partial eligible cards',()=>{
  const d=response();d.quarantine={excludedGameCount:1};const root={innerHTML:''};api.mount(root,d,NOW);
  assert.match(root.innerHTML,/Schedule conflict details unavailable/);assert.match(root.innerHTML,/excluded games cannot be verified/);
  assert.doesNotMatch(root.innerHTML,/retained-forecast-card/);
});

test('Opposing challenger is explicit, timestamped and never replaces Elo or grading baseline',()=>{
  const j=journal();Object.assign(j.snapshots[0],{challengerModelVersion:'nfl-efficiency-1',challengerHomeProbability:.4});
  const before=JSON.stringify(j),r=api.build(response(j),NOW),out=api.html(r);
  assert.match(out,/Models favor opposite teams/);assert.match(out,/Frozen EPA challenger: .*40.0%/);
  assert.match(out,/Built UTC: 2026-11-07T11:00:00.000Z/);assert.match(out,/first frozen scoring baseline remain unchanged/);
  assert.equal(r.cards[0].selectedProbability,.6);assert.equal(JSON.stringify(j),before);
});
test('Challenger display rejects unsupported, future-built or missing provenance',()=>{
  const s=response().games[0].latestSnapshot;
  for(const change of [{challengerModelVersion:'unknown'},{challengerBuiltAt:'2026-11-07T12:02:00.000Z'},{challengerResearchOnly:false},{challengerHomeProbability:NaN}]){
    const out=api.comparison({...s,challengerModelVersion:'nfl-efficiency-1',...change},'Home','Away',NOW);
    assert.match(out,/challenger unavailable/);assert.doesNotMatch(out,/Models favor/);
  }
});
test('Challenger comparison handles ties, stale builds and escapes team names',()=>{
  const s=response().games[0].latestSnapshot;Object.assign(s,{challengerModelVersion:'nfl-efficiency-1',challengerHomeProbability:.5,challengerBuiltAt:'2026-10-01T00:00:00.000Z'});
  const out=api.comparison(s,'<script>','Away',NOW);
  assert.match(out,/no preferred side/);assert.match(out,/Stale challenger build/);assert.doesNotMatch(out,/<script>/);
});

test('challenger stale warning follows the seven-day runtime bound',()=>{
  const s={eligibility:{model:true,challenger:true},modelVersion:'nfl-elo-1',modelHomeProbability:.55,
    challengerResearchOnly:true,challengerModelVersion:'nfl-efficiency-1',challengerHomeProbability:.45,
    challengerBuiltAt:'2026-11-01T12:00:00.000Z',capturedAt:'2026-11-02T12:00:00.000Z',commenceTime:'2026-11-03T12:00:00.000Z'};
  assert.match(api.comparison(s,'Home','Away',Date.parse('2026-11-09T12:00:00.000Z')),/Stale challenger build/);
});

test('Compact dossier quarantine keeps exclusion counts visible and all evidence in native details',()=>{
  const q=quarantineFixture(),out=api.quarantineHTML(q,{compact:true}),before=out.split('<details')[0];
  assert.match(before,/Quarantined games: 1 of 1/);assert.match(before,/Excluded snapshots: 2 of 2/);
  assert.match(before,/excluded from rankings, scoring and collection/);
  assert.match(out,/<details class="quarantine-details"><summary>Show all 1 quarantined games and evidence<\/summary>/);
  assert.doesNotMatch(out,/<details[^>]*\bopen\b/);
  for(const value of [q.games[0].gameId,q.games[0].firstFrozenSnapshotId,...q.games[0].observedCommenceTimes])assert.ok(out.includes(value));
  assert.match(out,/Original history is preserved unchanged/);
  assert.doesNotMatch(api.quarantineHTML(q),/<details/);
  assert.doesNotMatch(api.quarantineHTML({}, {compact:true}),/<details/);
  assert.match(api.quarantineHTML({}, {compact:true}),/scoring claims are withheld/);
  assert.equal(api.quarantineHTML(undefined,{compact:true}),'');
});
