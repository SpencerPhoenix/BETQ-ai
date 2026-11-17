import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createHandler} from '../src/server.mjs';

// Browser fixtures must not hide omitted production asset routes. Read the actual
// delivered HTML, then retrieve every local script and linked resource via HTTP.
test('terminal and historical HTML resources are served with exact bytes and MIME types, without provider reads',async t=>{
  let externalCalls=0;
  const forbidden=()=>{externalCalls++;throw Error('External/provider access forbidden');};
  const server=http.createServer(createHandler({
    source:{status:()=>({configured:false}),getOdds:forbidden,getScores:forbidden},
    evidenceFeed:{getSnapshot:forbidden},injuryFeed:{get:forbidden},derivedShadowFeed:null,
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;
  const expectedTypes={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
  const resources=new Set();
  for(const page of ['/','/index.html','/historical-2025','/game-card']){
    const response=await fetch(origin+page);assert.equal(response.status,200,page);
    assert.match(response.headers.get('content-type'),/^text\/html(?:;|$)/);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const html=await response.text();
    for(const match of html.matchAll(/<(script|link)\b[^>]*>/gi)){
      const attribute=match[1].toLowerCase()==='script'?'src':'href';
      const value=match[0].match(new RegExp('\\b'+attribute+'=["\']([^"\']+)["\']','i'))?.[1];
      if(!value)continue;
      assert.ok(value.startsWith('/')&&!value.startsWith('//'),`Unexpected external resource: ${value}`);
      if(/\.(js|css)$/.test(new URL(value,origin).pathname)) {
        const bytes=readFileSync(new URL('../public'+value,import.meta.url));
        assert.equal(new URL(value,origin).searchParams.get('v'),createHash('sha256').update(bytes).digest('hex'));
        const integrity=match[0].match(/\bintegrity="([^"]+)"/)?.[1];
        assert.equal(integrity,'sha256-'+createHash('sha256').update(bytes).digest('base64'));
      }
      resources.add(value);
    }
  }
  assert.ok([...resources].some(p=>p.startsWith('/game-grades.js?v=')),'grading renderer must be referenced by delivered HTML');
  assert.ok([...resources].some(p=>p.startsWith('/historical-evaluation.js?v=')),'historical renderer must be covered');
  for(const path of resources){
    const expected=readFileSync(new URL('../public'+path,import.meta.url));
    const response=await fetch(origin+path);assert.equal(response.status,200,path);
    const pathname=new URL(path,origin).pathname;const extension=pathname.slice(pathname.lastIndexOf('.'));assert.ok(expectedTypes[extension],path);
    assert.equal(response.headers.get('content-type').split(';')[0],expectedTypes[extension],path);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected,path);
    if(path.includes('?v=')) {
      assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');
      const mismatch=await fetch(origin+pathname+'?v=wrong');
      assert.equal(mismatch.status,409);assert.equal(mismatch.headers.get('cache-control'),'no-store');
      const legacy=await fetch(origin+pathname);assert.equal(legacy.headers.get('cache-control'),'no-store');
    }
    const head=await fetch(origin+path,{method:'HEAD'});assert.equal(head.status,200,path);
    assert.equal(head.headers.get('content-type').split(';')[0],expectedTypes[extension],path);
    assert.equal((await head.arrayBuffer()).byteLength,0,path);
  }
  assert.equal(externalCalls,0);
});
