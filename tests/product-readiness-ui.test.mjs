import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {summarizeEvidence} from '../src/evidence.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
const segment=(start,end)=>js.slice(js.indexOf(start),js.indexOf(end,js.indexOf(start)));
const code=segment('  const esc =','  const persist =')+
  segment('  function evidenceScoringView(','  function renderEvidence(')+'renderResearchReadiness();';
const report=(n=2,q=0)=>summarizeEvidence(syntheticScoringJournal(n,q),Date.parse('2026-11-16T12:00:00Z'));
function render(evidence,overrides={}){
  const root={innerHTML:'',contains:()=>false};
  const state={evidence,mode:'live',sport:'americanfootball_nfl',market:'h2h',slate:null,...overrides};
  vm.runInNewContext(code,{state,$:()=>root,Intl,document:{activeElement:null},sportLabels:{americanfootball_nfl:'NFL',basketball_nba:'NBA'},
    marketLabels:{h2h:'Moneyline',spreads:'Spread'},fetch(){throw Error('Rendering must never fetch');}});
  return root.innerHTML;
}
test('Readiness works without odds and separates recorded from corroborated outcomes',()=>{
  const out=render(report());
  assert.match(out,/No snapshot loaded/);assert.match(out,/2 frozen games · 2 recorded results/);
  assert.match(out,/0 source-corroborated for scoring/);assert.match(out,/Source independence is unverified/);
  assert.match(out,/No verified betting edge/);assert.match(out,/Paper staging and real wagering stay locked/);
  assert.doesNotMatch(out,/Forward winner accuracy|verified win probability|ready to bet/i);
});
test('Even a valid reporting sample never claims a validated strategy or unlocks actions',()=>{
  const out=render(report(35,30));
  assert.match(out,/30 source-corroborated for scoring/);assert.match(out,/initial 30-game reporting gate is met, not a validation/);
  assert.match(out,/No verified betting edge/);assert.doesNotMatch(out,/data-paper=|data-action="refresh"/);
});
test('Counts below the gate do not masquerade as performance evidence',()=>{
  const out=render(report(35,29));assert.match(out,/29 source-corroborated/);
  assert.match(out,/Accuracy reporting needs at least 30/);assert.doesNotMatch(out,/reporting gate is met/);
});
test('Legacy, contradictory, error and wrong-schema summaries fail closed',()=>{
  const base=report(35,30);
  for(const mutation of [{outcomeScoringPolicy:undefined},{schema:2},{error:'UNAVAILABLE'},
    {sourceIndependenceVerified:true},{sourceCorroboratedSettledGames:99},
    {marketBeatingEdgeEstablished:true},{realizedROI:0.5}]){
    const out=render({...base,...mutation});assert.match(out,/Evidence unavailable/);
    assert.doesNotMatch(out,/35 frozen games|30 source-corroborated/);assert.match(out,/No verified betting edge/);
  }
});
test('Missing metrics despite a count of30 keeps the reporting gate closed',()=>{
  const out=render({...report(30,30),forwardMetrics:null});
  assert.match(out,/compatible metrics/);assert.doesNotMatch(out,/reporting gate is met/);
});
test('Initial loading and unavailable evidence are distinguishable',()=>{
  assert.match(render(null),/Checking evidence/);
  assert.match(render({error:'EVIDENCE_ENDPOINT_UNAVAILABLE'}),/Evidence unavailable/);
});
test('Bundled or retained evidence is identified without inventing publication freshness',()=>{
  const out=render({...report(),publication:{source:'BUNDLED_JOURNAL',lastError:'FAILED'}});
  assert.match(out,/Showing bundled evidence/);assert.match(out,/Latest journal refresh failed; retained evidence is shown/);
  assert.doesNotMatch(out,/published today|live verified/i);
});
test('Demo and non-NFL filters cannot relabel NFL real-world research as selected-market evidence',()=>{
  const demo=render(report(),{mode:'demo'});assert.match(demo,/Fictional demo/);
  assert.match(demo,/separate real-world research/);
  const nba=render(report(),{sport:'basketball_nba',market:'spreads'});
  assert.match(nba,/NBA \/ Spread/);assert.match(nba,/NFL PROSPECTIVE RESEARCH/);
});
test('Quote receipt timestamps never imply streaming or override freshness gates',()=>{
  for(const date of ['bad','2020-01-01T00:00:00Z','2099-01-01T00:00:00Z']){
    const out=render(report(),{slate:{receivedAt:date}});assert.match(out,/Snapshot expired/);
    assert.match(out,/Quote age and kickoff checks still apply/);assert.match(out,/Not an in-play feed/);
  }
  assert.match(render(report(),{slate:{receivedAt:new Date().toISOString()}}),/Snapshot loaded/);
});
test('Retained snapshot is marked on read failure; provider strings are not interpolated',()=>{
  const out=render(report(),{slate:{receivedAt:'2020-01-01',provider:'<img onerror=x>'},error:{message:'<script>secret</script>'}});
  assert.match(out,/Snapshot retained; refresh failed/);assert.doesNotMatch(out,/<img|<script>|secret/);
});
test('Readiness navigation is explicit, keyboard-operable and carries no spending action',()=>{
  const out=render(report());
  for(const tab of ['games','evidence','model'])assert.match(out,new RegExp('type="button" class="text-link" data-tab="'+tab+'"'));
  assert.equal((out.match(/<article/g)||[]).length,3);assert.equal((out.match(/<\/article>/g)||[]).length,3);
  assert.match(html,/aria-labelledby="readiness-heading"/);assert.match(html,/id="readiness-view" aria-live="polite"/);
  assert.match(css,/@media\(max-width:950px\)\{\.readiness-grid\{grid-template-columns:1fr;/);
  assert.match(css,/\.readiness-card \.text-link[^}]*min-height:44px/);
  assert.doesNotMatch(html,/See the <em>edge|Historical proof/);
});
test('Evidence refresh and ordinary renders update readiness without adding a fetch path',()=>{
  assert.match(segment('  async function loadEvidence()','  async function loadHealth()'),/renderResearchReadiness\(\)/);
  assert.match(segment('  function render()','  async function loadIntelligence()'),/renderResearchReadiness\(\)/);
  assert.doesNotMatch(segment('  function renderResearchReadiness()','  function renderEvidence()'),/requestJSON|fetch\(|Authorization|paidRequest/);
});

test('Readiness preserves focused navigation across changed and unchanged timer renders',()=>{
  let writes=0,focus=0,content='';
  const active={getAttribute:()=> 'evidence'};
  const root={contains:node=>node===active,querySelectorAll:()=>[{getAttribute:()=> 'evidence',focus:()=>focus++}],
    get innerHTML(){return content;},set innerHTML(value){content=value;writes++;}};
  const state={evidence:report(),mode:'live',sport:'americanfootball_nfl',market:'h2h',slate:null};
  const context={state,$:()=>root,Intl,document:{activeElement:active},sportLabels:{americanfootball_nfl:'NFL'},marketLabels:{h2h:'Moneyline'}};
  vm.createContext(context);vm.runInContext(code,context);assert.equal(writes,1);assert.equal(focus,1);
  vm.runInContext('renderResearchReadiness();',context);assert.equal(writes,1);assert.equal(focus,1);
  state.loading=true;vm.runInContext('renderResearchReadiness();',context);assert.equal(writes,2);assert.equal(focus,2);
});
