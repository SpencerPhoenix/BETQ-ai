import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {summarizeEvidence} from '../src/evidence.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=js.slice(js.indexOf('  function evidenceScoringView('),js.indexOf('  function renderEvidence('));
const render=js.slice(js.indexOf('  function renderEvidence('),js.indexOf('  function renderAudit('));
const report=(n=30,q=n)=>summarizeEvidence(syntheticScoringJournal(n,q),Date.parse('2026-11-16T12:00:00Z'));
function html(e){
  const root={innerHTML:''};
  const context={state:{evidence:e},$:()=>root,
    esc:x=>String(x),when:x=>String(x),num:x=>String(x),pct:x=>String(x),signed:x=>String(x),
    metric:(...args)=>args.join(' '),empty:(...args)=>args.join(' ')};
  vm.runInNewContext(helpers+render+'renderEvidence();',context);
  return root.innerHTML;
}
test('Rendered legacy summary cannot restore scores, qualified progress, or independence claims',()=>{
  const e=report(),old={...e};delete old.outcomeScoringPolicy;
  const out=html(old);
  assert.match(out,/RESULTS RECORDED 30 0 source-corroborated/);
  assert.match(out,/0 of 30 source-corroborated games/);
  assert.match(out,/Brier: withheld/);
  assert.doesNotMatch(out,/Forward winner accuracy|Prospective Elo Brier|Model Brier<|independently settled|SAMPLE AVAILABLE/);
  assert.doesNotMatch(js,/scored against later results/);
});
test('Rendered corroborated cohort shows scores while recorded-only results remain excluded',()=>{
  const out=html(report(35,30));
  assert.match(out,/RESULTS RECORDED 35 30 source-corroborated/);
  assert.match(out,/30 of 30 source-corroborated games/);
  assert.match(out,/Forward winner accuracy/);
  assert.match(out,/Prospective Elo Brier/);
  assert.match(out,/upstream source independence is not established/);
  assert.match(out,/corroboration not established/);
  assert.match(out,/Brier: withheld/);
});
test('Rendered threshold uses corroborated cohort and rejects inconsistent metric count',()=>{
  const e=report(35,29),out=html(e);
  assert.match(out,/29 of 30 source-corroborated games/);
  assert.doesNotMatch(out,/Forward winner accuracy|Prospective Elo Brier/);
  const invalid=report();invalid.forwardMetrics.n=31;
  assert.doesNotMatch(html(invalid),/Forward winner accuracy/);
});
test('Audit and sequential UI use the same scoring contract rather than raw counts',()=>{
  const audit=js.slice(js.indexOf('  function renderAudit('),js.indexOf('  function renderAudit(')+5000);
  assert.match(audit,/evidenceScoringView\(state.evidence\)\.sample/);
  assert.match(audit,/Boolean\(evidenceScoringView\(state.evidence\)\.forward\)/);
  const start=js.indexOf('    const sequential=r.sequentialMarketEvidence;'),end=js.indexOf('    root.innerHTML=cards+leadEvidence+sequentialBox',start);
  const segment=js.slice(start,end)+'globalThis.output=sequentialBox;';
  const seq=calculateSequentialEvidence(syntheticScoringJournal()),old={...seq};delete old.outcomeScoringPolicy;
  const context={r:{sequentialMarketEvidence:old},metric:(...xs)=>xs.join(' '),num:String};
  vm.runInNewContext(segment,context);assert.equal(context.output,'');
  context.r.sequentialMarketEvidence=seq;
  vm.runInNewContext('{'+segment+'}',context);
  assert.match(context.output,/MARKET VS ELO BRIER/);
  assert.match(context.output,/Source independence is unverified/);
});
