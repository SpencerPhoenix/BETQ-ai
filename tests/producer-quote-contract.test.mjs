import test from 'node:test';
import {modelHealthFixture} from './fixtures/model-delivery.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nflMoneylineConsensus,selectUnambiguousProviderEvents} from '../src/market-consensus.mjs';
import {createHandler} from '../src/server.mjs';
import {createTestOddsSource} from './helpers/mock-budget.mjs';
import {observationsFromSlate,emptyJournal,updateJournal} from '../src/evidence.mjs';
import {buildGameDossier} from '../src/game-dossier.mjs';

const NOW=Date.parse('2026-11-07T12:00:00.000Z'),iso=n=>new Date(n).toISOString();
const TOKEN='OFFLINE_OPERATOR_FIXTURE_0123456789';
const PAID={headers:{'x-betq-paid-request':'true',authorization:'Bearer '+TOKEN}};
const home='Kansas City Chiefs',away='Las Vegas Raiders';
function event(oldest=NOW-599000){return {id:'offline-provider-event',sport_key:'americanfootball_nfl',
  home_team:home,away_team:away,commence_time:'2026-11-08T18:00:00.000Z',
  bookmakers:[0,1,2].map(i=>({key:'book-'+i,last_update:iso(NOW),markets:[{key:'h2h',
    last_update:iso(i===0?oldest:NOW-10000),outcomes:[{name:home,price:-110},{name:away,price:100}]}]}))};}
const elo={source:{project:'nflverse/nflverse-data'},schema:1,version:'nfl-elo-1',readyForResearch:true,generatedAt:iso(NOW-3600000),lastGameDate:'2026-11-06',
  params:{homeAdv:25,scale:1.1},holdout:{n:284,brier:.223,ece:.053},ratings:{KC:1550,LV:1450,BUF:1700,MIA:1400}};
const rows=[{game_id:'2026_09_LV_KC',season:2026,game_type:'REG',gameday:'2026-11-08',home_team:'KC',away_team:'LV'}];
async function fixture(t,{events=[event()],cap=12,delay=0,receipt=iso(NOW),realSource=true,maxAgeMs=600000,injuryDelay=0,failCapture=false}={}){
  let now=NOW,calls=0,captures=0,captured;
  const source=realSource?createTestOddsSource({apiKey:'OFFLINE_SYNTHETIC_KEY',clock:()=>now,dailyCreditCap:cap,
    fetchImpl:async()=>{calls++;return Response.json(events,{headers:{'x-requests-remaining':'10000','x-requests-last':'1'}});}}):
    {status:()=>({configured:true}),getOdds:async()=>({events,receivedAt:receipt,cacheHit:false,quota:null})};
  const server=http.createServer(createHandler({source,operatorRefreshToken:TOKEN,clock:()=>now,maxAgeMs,
    nflArtifact:elo,nflEfficiency:null,nflInjuries:null,injuryFeed:{get:async()=>{now+=injuryDelay;return {artifact:null};}},
    shadowStore:{capture:async(snapshot,options)=>{captures++;captured={snapshot,options};now+=delay;if(failCapture)throw Error('Offline capture failed');return {captured:true,inserted:1};}}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {get:(options)=>fetch('http://127.0.0.1:'+server.address().port+'/api/slate?mode=live',options),
    advance:ms=>now+=ms,calls:()=>calls,captures:()=>captures,captured:()=>captured,source};
}

test('Authenticated actual source and HTTP producer preserve absolute source quote bounds without mutation',async t=>{
  const raw=event(),before=structuredClone(raw),f=await fixture(t,{events:[raw]});
  assert.equal((await f.get()).status,409);
  assert.equal((await f.get({headers:{'x-betq-paid-request':'true'}})).status,401);
  assert.equal(f.calls(),0);
  const response=await f.get(PAID);assert.equal(response.status,200);const slate=await response.json();
  const c=slate.events[0].marketConsensus;
  assert.equal(c.available,true);assert.equal(c.oldestQuoteAt,iso(NOW-599000));assert.equal(c.latestQuoteAt,iso(NOW-10000));
  assert.equal(slate.receivedAt,iso(NOW));assert.equal(f.calls(),1);assert.equal(f.captures(),1);
  assert.deepEqual(raw,before);assert.deepEqual(f.captured().snapshot.events,[before]);
  const shot=observationsFromSlate(slate,rows,NOW,2026).accepted[0];
  const journal=updateJournal(emptyJournal(2026),[shot],[],NOW).journal;
  const dossier=buildGameDossier(journal,{gameId:shot.gameId,now:NOW});
  assert.equal(dossier.latestSnapshot.marketOldestQuoteAt,c.oldestQuoteAt);
  assert.equal(dossier.latestSnapshot.marketNewestQuoteAt,c.latestQuoteAt);
  assert.equal(dossier.latestSnapshot.eligibility.market,true);
  const cached=await (await f.get()).json();assert.equal(cached.cacheHit,true);assert.equal(f.calls(),1);assert.equal(f.captures(),1);
});

test('Actual collector entry retains HTTP quote proof, and delay loses only market eligibility',async t=>{
  const f=await fixture(t),slate=await (await f.get(PAID)).json();
  for(const delay of [0,10000]){
    const directory=await mkdtemp(join(tmpdir(),'betq-producer-contract-'));
    t.after(()=>rm(directory,{recursive:true,force:true}));
    await mkdir(join(directory,'data'),{recursive:true});await writeFile(join(directory,'data/nfl_elo.json'),JSON.stringify(elo));
    const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
    const csv='game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\n2026_09_LV_KC,2026,REG,2026-11-08,KC,LV,,,Home\n';
    const code=`let calls=0;Date.now=()=>${NOW+delay};globalThis.fetch=async(input,options)=>{
      calls++;const u=String(input);
      if(u==='https://offline-betq.test/api/health')return Response.json(${JSON.stringify(modelHealthFixture(elo,NOW+delay))});
      if(u==='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')return new Response(${JSON.stringify(csv)});
      if(!u.startsWith('https://offline-betq.test/api/slate?')||options.headers.Authorization!=='Bearer ${TOKEN}'||options.headers['x-betq-paid-request']!=='true')throw Error('Unexpected request');
      return Response.json(${JSON.stringify(slate)});};await import(${JSON.stringify(entry)});if(calls!==3)throw Error('Unexpected request count');`;
    const output=execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000,
      env:{PATH:process.env.PATH,BETQ_PRODUCTION_URL:'https://offline-betq.test',BETQ_OPERATOR_APPROVED_ORIGIN:'https://offline-betq.test',BETQ_OPERATOR_REFRESH_TOKEN:TOKEN}});
    assert.match(output,/"appended": 1/);
    const j=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8')),s=j.snapshots[0];
    assert.equal(s.capturedAt,iso(NOW+delay));assert.ok(s.modelHomeProbability>0);
    assert.equal(s.marketOldestQuoteAt,delay?null:iso(NOW-599000));assert.equal(s.marketHomeProbability,delay?null:.511628);
  }
  assert.equal(f.calls(),1);
});

test('A quote after original receipt cannot become valid during delayed analysis',()=>{
  const e=event(NOW-10000);e.bookmakers[0].markets[0].last_update=iso(NOW+1);
  const c=nflMoneylineConsensus(e,{asOf:NOW+10000,receivedAt:iso(NOW)});
  assert.equal(c.available,false);assert.equal(c.books,2);
});
test('Exact quote age uses milliseconds and cannot be loosened by display configuration',()=>{
  const e=event();
  assert.equal(nflMoneylineConsensus(e,{asOf:NOW+1000,receivedAt:iso(NOW)}).available,true);
  assert.equal(nflMoneylineConsensus(e,{asOf:NOW+1001,receivedAt:iso(NOW),maxAgeMs:9999999}).available,false);
});
for(const value of [null,'bad','2026-11-07T12:00:00Z',iso(NOW+1),iso(NOW-600001)])test('Invalid source receipt fails closed: '+value,()=>{
  assert.equal(nflMoneylineConsensus(event(),{asOf:NOW,receivedAt:value}).reason,'INVALID_PROVIDER_RECEIPT_TIME');
});
for(const value of [undefined,null,'2026-11-07T11:59:58','2026-11-07 11:59:58Z','2026/11/07T11:59:58Z','2026-11-31T11:59:58Z','2026-11-07T11:59:58.1234Z'])
  test('Market timestamp cannot be replaced by bookmaker time or permissive parsing: '+value,()=>{
    const e=event();e.bookmakers[0].markets[0].last_update=value;
    const c=nflMoneylineConsensus(e,{asOf:NOW,receivedAt:iso(NOW)});assert.equal(c.available,false);assert.equal(c.books,2);
  });
test('Explicit offset market timestamp preserves the exact UTC millisecond instant',()=>{
  const e=event();e.bookmakers[0].markets[0].last_update='2026-11-07T06:50:01.123-05:00';
  const c=nflMoneylineConsensus(e,{asOf:NOW,receivedAt:iso(NOW)});
  assert.equal(c.available,true);assert.equal(c.oldestQuoteAt,'2026-11-07T11:50:01.123Z');
});
test('Fresh bookmaker time never rejuvenates stale market-specific quote',()=>{
  const e=event(NOW-600001);assert.equal(nflMoneylineConsensus(e,{asOf:NOW}).available,false);
});
for(const options of [{minBooks:2},{minBooks:3.5},{maxAgeMs:-1},{maxAgeMs:Infinity}])test('Consensus configuration cannot relax provenance gates: '+JSON.stringify(options),()=>{
  assert.equal(nflMoneylineConsensus(event(),{asOf:NOW,...options}).reason,'INVALID_CONSENSUS_CONFIGURATION');
});
test('Missing HTTP source receipt does not silently become response time',async t=>{
  const f=await fixture(t,{realSource:false,receipt:null});
  const c=(await (await f.get()).json()).events[0].marketConsensus;
  assert.equal(c.available,false);assert.equal(c.reason,'INVALID_PROVIDER_RECEIPT_TIME');
});
test('Cached analysis keeps original source and quote times, never renewing freshness',async t=>{
  const f=await fixture(t);const first=await (await f.get(PAID)).json();f.advance(1001);
  const next=await (await f.get()).json();assert.equal(next.receivedAt,first.receivedAt);
  assert.equal(next.events[0].marketConsensus.available,false);assert.equal(f.calls(),1);assert.equal(f.captures(),1);
});
test('Private persistence delay uses a fresh analysis clock at the response boundary',async t=>{
  const f=await fixture(t,{delay:2000}),slate=await (await f.get(PAID)).json();
  assert.equal(f.captured().options.now,NOW);assert.equal(slate.events[0].marketConsensus.available,false);
  assert.equal(slate.events[0].independentModel.available,true);assert.equal(f.calls(),1);
});
test('Private persistence crossing kickoff cannot return pregame model or market availability',async t=>{
  const e=event();e.commence_time=iso(NOW+1000);const f=await fixture(t,{events:[e],delay:2000});
  const g=(await (await f.get(PAID)).json()).events[0];
  assert.equal(g.started,true);assert.equal(g.independentModel.reason,'GAME_ALREADY_STARTED');assert.equal(g.marketConsensus.available,false);
});
test('Zero budget still prevents every upstream request',async t=>{
  const f=await fixture(t,{cap:0});assert.equal((await f.get(PAID)).status,429);assert.equal(f.calls(),0);assert.equal(f.captures(),0);
});
test('Duplicate raw provider IDs are all rejected before analysis, enrichment or private capture',async t=>{
  const a=event(),b=event();b.home_team='Buffalo Bills';b.away_team='Miami Dolphins';
  b.bookmakers=b.bookmakers.map(book=>({...book,markets:[{...book.markets[0],outcomes:[{name:b.home_team,price:-400},{name:b.away_team,price:300}]}]}));
  const f=await fixture(t,{events:[a,b]}),slate=await (await f.get(PAID)).json();
  assert.deepEqual(slate.events,[]);assert.equal(slate.producerIntegrity.excludedEvents,2);
  assert.equal(slate.producerIntegrity.duplicateProviderEventIds,1);assert.equal(f.captures(),0);
  assert.equal(slate.shadowCapture.reason,'PROVIDER_EVENT_IDENTITY_REJECTED');
  assert.deepEqual(observationsFromSlate(slate,rows,NOW,2026).accepted,[]);
});
test('An otherwise filtered duplicate still poisons its ID, leaving unrelated original objects intact',()=>{
  const a=event(),bad={id:a.id},good={...event(),id:'unrelated'},input=[a,bad,good],before=structuredClone(input);
  for(const order of [input,[bad,good,a],[good,a,bad]]){
    const selected=selectUnambiguousProviderEvents(order);assert.deepEqual(selected.events,[good]);
    assert.equal(selected.events[0],good);assert.equal(selected.integrity.excludedEvents,2);
  }
  assert.deepEqual(input,before);
});
test('Invalid raw provider identity is not coerced into a capture-compatible string',async t=>{
  const invalid=[123,null,'',' provider','provider ','x\n','x'.repeat(201)];
  const good={...event(),id:'unrelated'};const events=[...invalid.map(id=>({...event(),id})),good];
  const f=await fixture(t,{events}),slate=await (await f.get(PAID)).json();
  assert.deepEqual(slate.events.map(g=>g.id),['unrelated']);assert.equal(slate.producerIntegrity.invalidProviderEventIds,invalid.length);
  assert.equal(f.captures(),0);assert.equal(slate.events[0].marketConsensus.available,true);
});

test('Awaited injury feed delay also expires market proof before response and capture',async t=>{
  const f=await fixture(t,{injuryDelay:2000}),slate=await (await f.get(PAID)).json();
  assert.equal(f.captured().options.now,NOW+2000);assert.equal(slate.events[0].marketConsensus.available,false);
  assert.equal(slate.events[0].independentModel.available,true);assert.equal(f.calls(),1);
});
test('A delayed private capture failure still re-evaluates response freshness and kickoff',async t=>{
  const e=event();e.commence_time=iso(NOW+1000);
  const f=await fixture(t,{events:[e],delay:2000,failCapture:true}),slate=await (await f.get(PAID)).json();
  assert.equal(slate.shadowCapture.reason,'PRIVATE_CAPTURE_REJECTED');assert.equal(slate.events[0].started,true);
  assert.equal(slate.events[0].independentModel.reason,'GAME_ALREADY_STARTED');
  assert.equal(slate.events[0].marketConsensus.available,false);assert.equal(f.calls(),1);
});
