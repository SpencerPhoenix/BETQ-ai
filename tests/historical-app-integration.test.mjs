import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {createHandler} from '../src/server.mjs';
import {FROZEN_FILES} from '../src/historical-evaluation.mjs';
import {loadBundledHistoricalEvaluation,getBundledHistoricalEvaluation,HISTORICAL_BUNDLE_DIR} from '../src/historical-bundle.mjs';
import {validSummary,validGame,renderSummary,renderGame,renderProvenance} from '../public/historical-evaluation.js';

test('Bundled files decompress to the exact previously frozen bytes within a bounded payload',()=>{
  let compressed=0,original=0;
  for(const [file,hash] of Object.entries(FROZEN_FILES)){
    const bytes=readFileSync(join(HISTORICAL_BUNDLE_DIR,file+'.gz')),raw=gunzipSync(bytes);compressed+=bytes.length;original+=raw.length;
    assert.equal(createHash('sha256').update(raw).digest('hex'),hash);
  }
  assert.equal(compressed,1001272);assert.equal(original,7004844);assert.ok(compressed<1_100_000);
});
test('Bundled projection preserves all 285 actual records and 14250 existing analogs',()=>{
  const view=loadBundledHistoricalEvaluation(),summary=view.summary();assert.equal(validSummary(summary),true);
  assert.equal(summary.gameCount,285);assert.equal(summary.regularSeasonGames,272);assert.equal(summary.playoffGames,13);assert.equal(summary.pushGames,1);
  assert.equal(summary.correction.improved,130);assert.equal(summary.correction.worsened,155);
  assert.equal(summary.metrics.market.mae,9.670175438596491);assert.equal(summary.metrics.marketPlusEfficiency.rmse,12.300429494526307);
  let analogs=0;for(const entry of summary.games){const game=view.game(entry.gameId);assert.equal(validGame(game,entry.gameId),true);analogs+=game.analogs.neighbors.length;assert.doesNotMatch(renderGame(game),/NaN|undefined|Unavailable/);}
  assert.equal(analogs,14250);assert.match(renderSummary(summary),/did not beat the benchmark/);
  const first=view.game(summary.games[0].gameId);assert.equal(first.gameId,'2025_01_DAL_PHI');assert.equal(first.actual.homeScore,24);assert.equal(first.actual.awayScore,20);
  assert.equal(first.models.market.margin,8.5);assert.equal(first.models.marketPlusEfficiency.margin,8.282711166026699);
});
test('Cached bundle exposes immutable copies and never rereads a successful load',()=>{
  const first=getBundledHistoricalEvaluation(),second=getBundledHistoricalEvaluation();assert.equal(first,second);
  const summary=first.summary(),id=summary.games[0].gameId;summary.games.pop();const game=first.game(id);game.models.market.margin=999;
  assert.equal(second.summary().games.length,285);assert.equal(second.game(id).models.market.margin,8.5);
});
test('Missing, invalid, mismatched and oversized compressed inputs fail closed',()=>{
  assert.throws(()=>loadBundledHistoricalEvaluation({read(){throw Error('missing');}}),/missing/);
  assert.throws(()=>loadBundledHistoricalEvaluation({read:()=>Buffer.from('invalid gzip')}));
  assert.throws(()=>loadBundledHistoricalEvaluation({read:()=>gzipSync(Buffer.from('{}'))}),/HASH_MISMATCH/);
  assert.throws(()=>loadBundledHistoricalEvaluation({read:()=>Buffer.alloc(2_000_001)}),/TOO_LARGE/);
  assert.throws(()=>loadBundledHistoricalEvaluation({read:()=>gzipSync(Buffer.alloc(8_000_001))}));
});
async function fixture(t,overrides={}){
  let upstreamCalls=0,tick=0;const forbidden=()=>{upstreamCalls++;throw Error('No provider, database or remote feed access');};
  const server=http.createServer(createHandler({clock:()=>Date.parse('2026-11-07T00:00:00Z')+(++tick)*1000,
    source:{status:forbidden,getOdds:forbidden,getScores:forbidden},evidenceFeed:{get:forbidden},derivedShadowFeed:{get:forbidden},
    shadowStore:{capture:forbidden,status:forbidden,analysis:forbidden},...overrides}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(upstreamCalls,0);});
  const base='http://127.0.0.1:'+server.address().port;return {get:path=>fetch(base+path),base};
}
test('Production handler historical routes serve all games without provider, feed or database calls',async t=>{
  const {get}=await fixture(t);const response=await get('/api/historical-evaluation');assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');const summary=await response.json();assert.equal(summary.mode,'HISTORICAL_2025_FROZEN');
  let count=0;for(const entry of summary.games){const r=await get('/api/historical-evaluation/game?gameId='+entry.gameId);assert.equal(r.status,200);assert.equal(validGame(await r.json(),entry.gameId),true);count++;}
  assert.equal(count,285);
});
test('App assets are lazy, separate from live filters, and expose no raw artifact files',async t=>{
  let loads=0;const {get}=await fixture(t,{historicalEvaluation:()=>{loads++;return getBundledHistoricalEvaluation();}});
  const app=await(await get('/')).text();assert.match(app,/href="\/historical-2025"/);assert.match(app,/Separate from the prospective records/);
  assert.doesNotMatch(app,/<script[^>]+historical-evaluation/);
  const page=await(await get('/historical-2025')).text();assert.match(page,/Historical 2025 Evaluation/);assert.match(page,/HISTORICAL · READ ONLY/);
  assert.doesNotMatch(page,/src="\/app\.js"|styles\.css|id="sport-filters"|id="market-filters"/);
  for(const path of ['/historical-evaluation.js','/historical-evaluation.css','/historical-source-license.txt'])assert.equal((await get(path)).status,200);
  assert.equal(loads,0,'Static navigation and assets must not load data or providers');
  await get('/api/historical-evaluation');assert.equal(loads,1);
  for(const path of ['/data/historical-2025/spread-screen.json.gz','/data/historical-2025/lagged-efficiency-2023-2024-2025.json.gz','/spread-screen.json','/historical-2025/../../.env'])assert.equal((await get(path)).status,404);
});
test('Historical routes reject writes, invalid selectors and missing games without fallback',async t=>{
  const {get,base}=await fixture(t);
  for(const method of ['POST','DELETE','PUT','HEAD'])assert.equal((await fetch(base+'/api/historical-evaluation',{method})).status,405);
  for(const path of ['/api/historical-evaluation?refresh=true','/api/historical-evaluation/game','/api/historical-evaluation/game?gameId=',
    '/api/historical-evaluation/game?gameId=2025_01_DAL_PHI&gameId=2025_01_DAL_PHI','/api/historical-evaluation/game?file=../../.env',
    '/api/historical-evaluation/game?gameId=2026_01_DAL_PHI'])assert.equal((await get(path)).status,400,path);
  assert.equal((await get('/api/historical-evaluation/game?gameId=2025_99_ZZ_YY')).status,404);
});
test('Bundle failures are sanitized and do not contact a fallback source',async t=>{
  const {get}=await fixture(t,{historicalEvaluation:()=>{throw Error('PRIVATE_FILE_PATH_OR_CONTENT');}});
  for(const path of ['/api/historical-evaluation','/api/historical-evaluation/game?gameId=2025_01_DAL_PHI']){
    const response=await get(path);assert.equal(response.status,503);const body=await response.text();assert.match(body,/HISTORICAL_VIEW_UNAVAILABLE/);assert.doesNotMatch(body,/PRIVATE_FILE_PATH_OR_CONTENT/);
  }
});
test('Retained license, attribution, source links, modification and warranty notices are presented',async t=>{
  const {get}=await fixture(t),license=await(await get('/historical-source-license.txt')).text();
  assert.equal(createHash('sha256').update(license).digest('hex'),'2a82ac9bbc3e3ee066908381e8d373896db5a6025d083fbd59692fe9ccfb9111');
  assert.match(license,/Creative Commons Attribution 4.0 International/);assert.match(license,/Disclaimer of Warranties/);
  const summary=getBundledHistoricalEvaluation().summary(),html=renderProvenance(summary);
  assert.match(html,/nflverse \/ nflfastR \/ Lee Sharpe/);assert.match(html,/historical-source-license\.txt/);
  assert.match(html,/losslessly repackages/);assert.match(html,/Provided without warranties/);assert.match(html,/upstream rights and official league certification are not independently established/i);
  assert.equal((html.match(/href="https:\/\/github\.com\/nflverse\/nflverse-data\/releases\/download/g)||[]).length,4);
  summary.provenance.sources[0].url='javascript:alert(1)';assert.doesNotMatch(renderProvenance(summary),/href="javascript:/);
});
test('Historical quota is bounded separately and cannot consume the existing API allowance',async()=>{
  const handler=createHandler({clock:()=>1000000,historicalEvaluation:{summary:()=>({fixture:true}),game:()=>null}});
  const read=async url=>{
    let status,headers,body;await handler({method:'GET',url,headers:{},socket:{remoteAddress:'127.0.0.1'}},
      {setHeader(){},writeHead(s,h){status=s;headers=h;},end(b){body=b;}});return {status,headers,body};
  };
  for(let i=0;i<600;i++)assert.equal((await read('/api/historical-evaluation')).status,200);
  const limited=await read('/api/historical-evaluation');assert.equal(limited.status,429);assert.match(limited.body,/HISTORICAL_RATE_LIMIT/);assert.equal(limited.headers['Retry-After'],'600');
  for(let i=0;i<180;i++)assert.equal((await read('/api/unknown-ordinary-route')).status,404);
  const ordinary=await read('/api/unknown-ordinary-route');assert.equal(ordinary.status,429);assert.match(ordinary.body,/LOCAL_RATE_LIMIT/);
});
