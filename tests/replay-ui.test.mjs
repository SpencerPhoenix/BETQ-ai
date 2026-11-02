import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const path=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('Agent cockpit and season replay are visible navigation destinations',async()=>{
  const html=await path('public/index.html');
  assert.match(html,/data-tab="replay"/);
  for(const id of ['agent-run-view','replay-overview','replay-plays',
    'replay-season','replay-threshold','replay-page-label','page-replay']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  for(const label of ['Historical Replay','Would BETQ have won?',
    'closing prices without a verified entry timestamp','Previous 30','Next 30']){
    assert.ok(html.includes(label),label);
  }
  assert.match(html,/TERMINAL \/ v0\.7\.0/);
});
test('On activation the frontend loads historical results and runs agent briefing on slate',async()=>{
  const js=await path('public/app.js');
  assert.match(js,/loadReplay\(\);\s*loadMarketChallenge\(\);\s*loadRiskStress\(\);\s*loadPriceVerification\(\);\s*loadSlate\(\)/);
  assert.match(js,/renderAgentRun\(\)/);
  assert.match(js,/renderReplay\(\)/);
  assert.match(js,/\/api\/replay\/nfl\/plays\?season=/);
  assert.match(js,/\/api\/replay\/nfl'/);
  assert.match(js,/state\.slate\?\.agentRun/);
  assert.match(js,/model-price|modelPriceCandidatesReviewed/);
});
test('Replay summary separates all-game accuracy from filtered pick win-rate, with negative ROI',async()=>{
  const js=await path('public/app.js');
  assert.match(js,/y\.allGameForecast\.accuracyPercent/);
  assert.match(js,/chosen\.winRatePercent/);
  assert.match(js,/hypotheticalClosingPriceROI/);
  assert.match(js,/Historical closing odds are not verified offered entry prices/);
  assert.match(js,/not fill verified/);
});
test('Mobile scoreboard and agent stages have responsive layout and no inline scripts',async()=>{
  const [html,css]=await Promise.all([path('public/index.html'),path('public/styles.css')]);
  assert.match(css,/\.agent-stage-grid/);
  assert.match(css,/\.replay-season-table/);
  assert.match(css,/@media\(max-width:580px\)/);
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('onchange='));
});
