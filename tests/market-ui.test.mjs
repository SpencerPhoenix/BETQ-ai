import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Historical Replay includes conservative, source-honest market comparison',async()=>{
  const html=await read('public/index.html');
  assert.ok(html.includes('id="market-challenge-view"'));
  assert.ok(html.includes('TERMINAL / v0.8.0'));
  assert.ok(html.includes('closing prices without a verified entry timestamp'));
});
test('Agent cockpit and challenge dashboard show past-year training and ROI separately',async()=>{
  const js=await read('public/app.js');
  assert.match(js,/async function loadMarketChallenge/);
  assert.match(js,/\/api\/research\/market/);
  assert.match(js,/renderMarketChallenge\(\)/);
  assert.match(js,/modelContributionWeight/);
  assert.match(js,/hypotheticalClosingPriceROIPercent/);
  assert.match(js,/High accuracy is not a profitable edge/);
  assert.match(js,/real money edge|REAL MONEY EDGE/i);
  assert.ok(!js.includes('verifiedProfitPercent'));
});
test('Mobile responsive market challenge cards do not require unsafe CSP',async()=>{
  const [js,html,css]=await Promise.all([
    read('public/app.js'),read('public/index.html'),read('public/styles.css')
  ]);
  assert.match(css,/\.market-compare-grid/);
  assert.match(css,/@media\(max-width:900px\)/);
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('onchange='));
  assert.match(js,/modelPriceCandidatesReviewed/);
});
