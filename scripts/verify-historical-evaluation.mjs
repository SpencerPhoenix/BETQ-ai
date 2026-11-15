/** Real-artifact verification, restricted to a temporary loopback server. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {FROZEN_FILES} from '../src/historical-evaluation.mjs';
import {startHistoricalLocal} from '../src/historical-local-server.mjs';
import {validSummary,validGame,renderSummary,renderGame,renderProvenance} from '../public/historical-evaluation.js';

if(process.argv.length!==3)throw Error('Usage: node scripts/verify-historical-evaluation.mjs LOCAL_ARTIFACT_DIRECTORY');
const directory=resolve(process.argv[2]);
const server=await startHistoricalLocal({directory,port:0});
const origin='http://127.0.0.1:'+server.address().port;
let requests=0,neighbors=0;const originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{
  assert.equal(new URL(url).origin,origin,'External network request prohibited');requests++;
  return originalFetch(url,options);
};
try{
  const response=await fetch(origin+'/api/historical-evaluation');assert.equal(response.status,200);
  const summary=await response.json();assert.equal(validSummary(summary),true);assert.ok(renderSummary(summary));assert.ok(renderProvenance(summary));
  for(const item of summary.games){
    const response=await fetch(origin+'/api/historical-evaluation/game?gameId='+item.gameId);assert.equal(response.status,200);
    const game=await response.json();assert.equal(validGame(game,item.gameId),true);
    const html=renderGame(game);assert.doesNotMatch(html,/NaN|undefined|Unavailable/);assert.equal((html.match(/<tr>/g)||[]).length,51);
    assert.equal(game.analogs.neighbors.length,50);neighbors+=game.analogs.neighbors.length;
  }
  for(const path of ['/','/historical-evaluation.js','/historical-evaluation.css'])assert.equal((await fetch(origin+path)).status,200);
  for(const [name,expected] of Object.entries(FROZEN_FILES))assert.equal(createHash('sha256').update(await readFile(join(directory,name))).digest('hex'),expected);
  console.log(JSON.stringify({passed:true,mode:'LOCAL_API_AND_RENDER_FUNCTIONS_NOT_BROWSER',games:summary.gameCount,neighbors,requests,
    sourceFilesUnchanged:true,externalRequests:0,metrics:summary.metrics,correction:summary.correction,
    visualStatus:'Not run: browser access remains restricted. No 360/390px, screenshot or assistive-technology certification.'},null,2));
}finally{
  globalThis.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
}
