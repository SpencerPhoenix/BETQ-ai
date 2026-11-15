import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {summarizeEvidence} from '../src/evidence.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {quarantineFixture} from './fixtures/quarantine-ui.mjs';
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const forecasts=await readFile(new URL('../public/retained-forecasts.js',import.meta.url),'utf8');
const helpers=js.slice(js.indexOf('  function evidenceScoringView('),js.indexOf('  function renderEvidence('));
const render=js.slice(js.indexOf('  function renderEvidence('),js.indexOf('  function renderAudit('));
const report=(n=30,q=n)=>summarizeEvidence(syntheticScoringJournal(n,q),Date.parse('2026-11-16T12:00:00Z'));
function html(e){
  const root={innerHTML:''};
  const context={state:{evidence:e},$:()=>root,
    esc:x=>String(x),when:x=>String(x),num:x=>String(x),pct:x=>String(x),signed:x=>String(x),
    metric:(...args)=>args.join(' '),empty:(...args)=>args.join(' ')};
  vm.runInNewContext(forecasts+helpers+render+'renderEvidence();',context);
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
test('Journal read, capture and calculation times are distinct from publication time',()=>{
  const e=report(2,0);e.publication={source:'PUBLIC_JOURNAL',lastSuccessfulFetchAt:'2026-11-16T12:00:00.000Z',
    latestSnapshotAt:'2026-11-07T12:00:00.000Z',lastError:'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID'};
  const out=html(e);
  assert.match(out,/Existing public journal last read successfully/);
  assert.match(out,/latest journal refresh failed or did not pass integrity checks/);
  assert.match(out,/Newest recorded forecast capture/);
  assert.match(out,/Summary calculated/);assert.match(out,/Source publication time is not verified/);
  assert.doesNotMatch(out,/Last evidence publication/);
  e.publication.source='BUNDLED_JOURNAL';assert.match(html(e),/Using the bundled evidence journal/);
});

test('Version1 summaries cannot revive scores under the stronger receipt binding contract',()=>{
  const e={...report(),outcomeScoringPolicy:'SOURCE_CORROBORATED_SETTLEMENT_V1'};
  assert.doesNotMatch(html(e),/Forward winner accuracy|Prospective Elo Brier|SAMPLE AVAILABLE/);
});

test('Evidence summary discloses quarantine identities, original kickoffs and raw versus excluded records',()=>{
  const e=report(30,30);e.quarantine=quarantineFixture({games:30,snapshots:30,results:30});
  const out=html(e);
  for(const pattern of [/Quarantined games: 1 of 31/,/Excluded snapshots: 2 of 32/,/Excluded result records: 1 of 31/,
    /AWAY @ HOME/,/synthetic-conflict/,/2026-11-08T18:00:00.000Z/,/2026-11-08T21:00:00.000Z/,
    /excluded from forecast rankings, scoring and further collection/,/Original history is preserved unchanged/,
    /30 of 30 source-corroborated games/])assert.match(out,pattern);
  assert.doesNotMatch(out,/data-dossier-game="synthetic-conflict"/);
});

test('Malformed, contradictory or overlapping summary quarantine withholds all forecasts and scoring claims',()=>{
  const good=report(30,30);good.quarantine=quarantineFixture({games:30,snapshots:30,results:30});
  for(const change of [e=>{e.quarantine=null;},e=>{e.quarantine.games[0].collectionEligible=true;},
    e=>{e.quarantine.excludedResultCount++;},e=>{e.totalSnapshots++;},e=>{e.prospectiveGames=32;},
    e=>{e.recentResults[0].gameId=e.quarantine.games[0].gameId;},
    e=>{e.pendingPreview=[{gameId:e.quarantine.games[0].gameId,modelHomeProbability:.99}];}]){
    const e=structuredClone(good);change(e);const out=html(e);
    assert.match(out,/Evidence unavailable/);assert.match(out,/excluded games cannot be verified/);
    assert.doesNotMatch(out,/Forward winner accuracy|Prospective Elo Brier|SAMPLE AVAILABLE|RESULTS RECORDED|evidence-row/);
  }
});

test('Quarantine metadata never injects HTML into evidence summary',()=>{
  const e=report(1,0);e.quarantine=quarantineFixture({games:1,snapshots:1,results:1});
  e.quarantine.games[0].home='<script>alert(1)</script>';
  const out=html(e);assert.match(out,/&lt;script&gt;/);assert.doesNotMatch(out,/<script>/);
});
