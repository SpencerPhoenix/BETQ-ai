import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const path=x=>readFile(new URL('../'+x,import.meta.url),'utf8');
test('QB Latency Lab is a real navigation destination and is not silently a live sportsbook recommendation',async()=>{
  const html=await path('public/index.html');
  assert.match(html,/data-tab="latency"/);
  assert.match(html,/id="page-latency"/);
  for(const id of ['shadow-readiness','shadow-study-view'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/data-shadow-view="live"/);
  assert.match(html,/data-shadow-view="demo"/);
  assert.match(html,/No new paid source polling or historical backfill/);
  assert.match(html,/TERMINAL \/ v0\.10\.0/);
});
test('Shadow study is requested via free same-origin read-only APIs, not a new The Odds API fetch',async()=>{
  const js=await path('public/app.js');
  assert.match(js,/requestJSON\('\/api\/shadow\/status'\)/);
  assert.match(js,/requestJSON\('\/api\/shadow\/study'\)/);
  assert.match(js,/requestJSON\('\/api\/shadow\/demo'\)/);
  assert.match(js,/loadShadow\(\)/);
  assert.match(js,/renderShadow\(\)/);
  assert.match(js,/state\.shadowView:?\s*=?/);
  assert.match(js,/if\(shadowView&&\['live','demo'\]/);
});
test('Actual observational results cannot be confused with synthetic or incomplete research',async()=>{
  const js=await path('public/app.js');
  assert.match(js,/result\.synthetic!==true/);
  assert.match(js,/100% FICTIONAL EXAMPLE/);
  assert.match(js,/status\?\.available===true/);
  assert.match(js,/result\.eventCount>=10/);
  assert.match(js,/No actual wager or causal sportsbook repricing effect/);
  assert.match(js,/NO ELIGIBLE VERIFIED COHORT/);
});
test('Provenance UI and mobile CSS never advertise genuine CLV or app account execution',async()=>{
  const [css,js,html]=await Promise.all([
    path('public/styles.css'),path('public/app.js'),path('public/index.html')
  ]);
  assert.match(css,/\.shadow-steps/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(js,/No predictive accuracy, execution, or profitable opportunity/);
  assert.match(html,/A private durable database is required/);
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('onchange='));
});

test('Actual forward-derived market movement panel never claims QB attribution or accepted bookmaker prices',async()=>{
  const [html,js]=await Promise.all([
    path('public/index.html'),path('public/app.js')
  ]);
  assert.match(html,/id="shadow-forward-view"/);
  assert.match(js,/requestJSON\('\/api\/shadow\/derived'\)/);
  assert.match(js,/renderShadowForward\(\)/);
  assert.match(js,/QB ASSOCIATION UNVERIFIED|NOT LINKED TO QB SOURCE/);
  assert.match(js,/not a trading signal/);
});
