import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const ROOT=new URL('../',import.meta.url);
const file=path=>readFile(new URL(path,ROOT),'utf8');

test('ROI/CLV Lab has a reachable navigation tab and accessible, named form controls',async()=>{
  const html=await file('public/index.html');
  assert.match(html,/data-tab="pricing"/);
  assert.match(html,/id="page-pricing"/);
  assert.match(html,/id="pricing-form"/);
  for(const id of ['pricing-entry','pricing-close','pricing-opposite',
    'pricing-stake','pricing-result','pricing-overview','pricing-calculation']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/VERIFICATION REQUIRED/);
  assert.match(html,/illustrative calculations|HYPOTHETICAL MATH ONLY/i);
  assert.ok(!html.includes('**Not supported yet:**'));
});

test('Frontend price calculator uses dedicated free pricing route, never odds-provider fetch',async()=>{
  const js=await file('public/app.js');
  const start=js.indexOf('async function calculateIllustrativePricing()');
  const end=js.indexOf('function renderExecution()',start);
  const fn=js.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.ok(fn.includes('/api/price/illustration?'));
  assert.ok(!fn.includes('/api/slate'));
  assert.ok(!fn.includes('ODDS_API_KEY'));
  assert.ok(js.includes("$('pricing-form').addEventListener('submit'"));
  assert.ok(js.includes('state.priceVerification'));
  assert.match(js,/VERIFIED REAL-MONEY ROI/);
});

test('Manual paper metrics cannot be presented as independently verified ROI/CLV',async()=>{
  const js=await file('public/app.js');
  const start=js.indexOf('function renderPricing()'),end=js.indexOf('async function loadPriceVerification()',start);
  const fragment=js.slice(start,end);
  assert.ok(fragment.includes("t.manualSettlement!==true"));
  assert.ok(fragment.includes("['WIN','LOSS','PUSH']"));
  assert.ok(fragment.includes("t.status==='VOID'"));
  assert.ok(fragment.includes("metric('VERIFIED REAL-MONEY ROI','—'"));
  assert.ok(fragment.includes("metric('VERIFIED CLOSING VALUE','—'"));
  assert.ok(fragment.includes("manualRoi===null?'—'"));
});

test('Pricing Lab remains responsive and uses no inline-script policy exception',async()=>{
  const css=await file('public/styles.css');
  const html=await file('public/index.html');
  assert.match(css,/\.pricing-columns/);
  assert.match(css,/@media\(max-width:540px\)/);
  assert.ok(!html.includes('oninput='));
  assert.ok(!html.includes('onclick='));
});
