import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler,loadEvidenceJournal} from '../src/server.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {emptyJournal} from '../src/evidence.mjs';
const NOW=Date.parse('2026-11-16T12:00:00Z');
function journal(){
  const result=syntheticScoringJournal(2,1);
  result.provenance=emptyJournal(2026).provenance;
  for(const [i,row] of result.snapshots.entries())row.providerEventId='offline-provider-'+i;
  return result;
}
async function fixture(t,retained=journal()){
  const before=JSON.stringify(retained);
  let unexpected=0;
  const forbidden=()=>{unexpected++;throw Error('No provider or external feed access permitted');};
  const server=http.createServer(createHandler({clock:()=>NOW,nflEvidenceJournal:retained,
    source:{status:forbidden,getOdds:forbidden,getScores:forbidden},
    evidenceFeed:{get:forbidden},derivedShadowFeed:{get:forbidden},shadowStore:{capture:forbidden,status:forbidden,analysis:forbidden}
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.close();assert.equal(unexpected,0);assert.equal(JSON.stringify(retained),before);});
  return path=>fetch('http://127.0.0.1:'+server.address().port+path);
}

test('Retained dossiers work with no live source, no remote journal call, and no journal mutation',async t=>{
  const get=await fixture(t);
  const index=await get('/api/research/games');
  assert.equal(index.status,200);
  const listing=await index.json();
  assert.equal(listing.source,'BUNDLED_RETAINED_JOURNAL');assert.equal(listing.games.length,2);
  const response=await get('/api/research/game?gameId=fixture-game-0');
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();
  assert.equal(body.game.gameId,'fixture-game-0');assert.equal(body.firstFrozenBaseline.id,'fixture-0');
  assert.equal(body.result.sourceCorroborated,true);assert.equal(body.comparableGames.available,false);
  assert.notEqual(body.generatedAt,body.firstFrozenBaseline.capturedAt);
  assert.equal((await(await get('/api/research/game?providerEventId=offline-provider-0')).json()).game.gameId,'fixture-game-0');
});

test('Dossier API requires one exact selector and rejects ambiguous or unknown query shapes',async t=>{
  const get=await fixture(t);
  for(const path of ['/api/research/game','/api/research/game?gameId=',
    '/api/research/game?gameId=fixture-game-0&providerEventId=offline-provider-0',
    '/api/research/game?gameId=fixture-game-0&gameId=fixture-game-1',
    '/api/research/game?sport=nfl','/api/research/games?refresh=true','/api/research/game?gameId=%00',
    '/api/research/game?gameId='+('a'.repeat(141))]){
    const response=await get(path);assert.equal(response.status,400,path);
    assert.equal((await response.json()).error.code,'INVALID_SELECTOR');
  }
  const missing=await get('/api/research/game?gameId=missing');
  assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'GAME_NOT_FOUND');
});

test('Reused provider identifier cannot silently choose one of conflicting games',async t=>{
  const retained=journal();retained.snapshots[1].providerEventId='offline-provider-0';
  const get=await fixture(t,retained);
  const response=await get('/api/research/game?providerEventId=offline-provider-0');
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'AMBIGUOUS_PROVIDER_EVENT_ID');
});

test('Broken retained source returns a safe unavailable state, not a manufactured dossier',async t=>{
  const retained=journal();retained.snapshots[0].capturedAt='invalid <script>private</script>';
  const get=await fixture(t,retained);
  for(const path of ['/api/research/games','/api/research/game?gameId=fixture-game-0']){
    const response=await get(path);assert.equal(response.status,503);
    const text=await response.text();assert.match(text,/INVALID_RETAINED_JOURNAL/);
    assert.doesNotMatch(text,/<script>|private|stack/);
  }
});

test('Recorded but uncorroborated result is not a qualified model outcome',async t=>{
  const get=await fixture(t);
  const body=await(await get('/api/research/game?gameId=fixture-game-1')).json();
  assert.equal(body.result.homeScore,27);assert.equal(body.result.awayScore,17);
  assert.equal(body.result.sourceCorroborated,false);assert.equal(body.result.scoringEligible,false);
});

test('Provider identifier length contract matches the pure dossier reader',async t=>{
  const retained=journal();retained.snapshots[0].providerEventId='p'.repeat(200);
  const get=await fixture(t,retained);
  assert.equal((await get('/api/research/game?providerEventId='+('p'.repeat(200)))).status,200);
  assert.equal((await get('/api/research/game?providerEventId='+('p'.repeat(201)))).status,400);
});

test('Bundled startup failure stays distinguishable from an empty but valid journal',()=>{
  let failed=false;
  const fallback=loadEvidenceJournal({read:()=>'{broken',clock:()=>NOW,onInvalid:()=>{failed=true;}});
  assert.equal(failed,true);assert.deepEqual(fallback.snapshots,[]);
  failed=false;
  const empty=emptyJournal(2026);
  const read=loadEvidenceJournal({read:()=>JSON.stringify(empty),clock:()=>NOW,onInvalid:()=>{failed=true;}});
  assert.equal(failed,false);assert.deepEqual(read,empty);
});

test('Unavailable startup journal is not reported as an empty successful index',async t=>{
  const get=await fixture(t,null);const response=await get('/api/research/games');
  assert.equal(response.status,503);assert.equal((await response.json()).error.code,'INVALID_RETAINED_JOURNAL');
});
