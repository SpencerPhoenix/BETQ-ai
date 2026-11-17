import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStaticRelease} from '../src/static-release.mjs';
const assets = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/app.js',['app.js','text/javascript; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']]
]);
const url = path => new URL(path,'https://betq.example');
const html = '<link rel="stylesheet" href="/styles.css"><script defer src="/app.js"></script>';
function release(js='old',css='old css',page=html) {
  const files={'index.html':page,'app.js':js,'styles.css':css};
  return {files,view:createStaticRelease(assets, name=>files[name])};
}
function refs(view) {return [...view.get(url('/')).body.toString().matchAll(/(?:src|href)="([^"]+)" integrity="([^"]+)"/g)];}

test('ordinary reload avoids fresh legacy caches and pins every script/style to exact bytes',()=>{
  const old=release(),next=release('new','new css');
  const browserCache = new Map([['/app.js','old'],['/styles.css','old css']]);
  for (const [,path,integrity] of refs(next.view)) {
    assert.equal(browserCache.has(path),false);
    const asset=next.view.get(url(path));
    assert.equal(asset.status,200);
    assert.equal(integrity,'sha256-'+createHash('sha256').update(asset.body).digest('base64'));
    assert.match(asset.cache,/immutable/);
  }
  assert.notDeepEqual(refs(old.view).map(x=>x[1]),refs(next.view).map(x=>x[1]));
  for (const path of ['/','/app.js','/styles.css']) assert.equal(next.view.get(url(path)).cache,'no-store');
});
test('deploy races and rollback reject mismatched versions rather than mix builds',()=>{
  const old=release(),next=release('new','new css');
  for (const [a,b] of [[old,next],[next,old]]) {
    for (const [,path] of refs(a.view)) {
      const response=b.view.get(url(path));
      assert.equal(response.status,409);assert.equal(response.cache,'no-store');
      assert.match(response.body.toString(),/Reload/);
    }
  }
});
test('startup snapshot survives disk edits and HTML-only edits safely reuse unchanged bytes',()=>{
  const first=release();first.files['app.js']='changed after startup';
  const path=refs(first.view)[1][1];assert.equal(first.view.get(url(path)).body.toString(),'old');
  const next=release('old','old css',html+'<p>new markup</p>');
  assert.equal(refs(next.view)[1][1],path);
});
test('strict allowlist, duplicate/malformed version rejection and no private file exposure',()=>{
  const {view}=release();
  for (const path of ['/app.js?v=','/app.js?v=invalid','/app.js?v=a&v=b']) {
    assert.equal(view.get(url(path)).status,409);
  }
  for (const path of ['/package.json','/src/server.mjs','/unknown.js','/service-worker.js']) assert.equal(view.get(url(path)),null);
});
