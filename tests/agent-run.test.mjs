import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleAgentRun} from '../src/agent-run.mjs';
const history={
  years:[2022,2023,2024,2025].map(season=>({
    season,allGameForecast:{brier:.226},
    closingMarketBenchmark:{brier:.209,pairedModelBrier:.226}
  }))
};
const game={
  id:'x',awayTeam:'Los Angeles Rams',homeTeam:'Dallas Cowboys',
  started:false,independentModel:{available:true},
  opportunities:[{
    quoteAgeSeconds:80,eloIndicativeEvPercent:7,eloBaselineProbability:.65,
    eloPriceEdgePoints:3,americanOdds:-110,selection:'Los Angeles Rams',
    bookmaker:'FixtureBook',status:'WATCH'
  }]
};
const slate={
  source:'THE_ODDS_API_V4',demo:false,market:'h2h',sport:'americanfootball_nfl',
  events:[game]
};
test('Agent stages never promote a historical model that loses proper score to market',()=>{
  const r=assembleAgentRun(slate,history,{now:Date.parse('2026-11-01T20:00:00Z')});
  assert.equal(r.decision,'PASS_NO_PROVEN_MARKET_EDGE');
  assert.equal(r.marketBenchmarkConsistentlyBetter,true);
  assert.equal(r.researchCandidates.length,1);
  assert.equal(r.researchCandidates[0].authorizedForWager,false);
  assert.equal(r.mayWager,false);
  assert.equal(r.realMoneyROI,null);
  assert.equal(r.verifiedCLV,null);
  assert.deepEqual(r.stages.map(s=>s.id),['market','quant','history','risk']);
});
test('Agent supports other leagues only as unmodeled markets',()=>{
  const result=assembleAgentRun({...slate,sport:'basketball_nba'},history);
  assert.equal(result.decision,'PASS_UNMODELED_MARKET');
});
test('Demo never manufactures verified profitability or recommended plays',()=>{
  const r=assembleAgentRun({...slate,demo:true},history);
  assert.equal(r.decision,'DEMO_NO_ACTION');
  assert.equal(r.mayWager,false);
  assert.equal(r.stages[0].state,'DEMO');
});
test('Missing historical audit cannot imply a market edge',()=>{
  const r=assembleAgentRun(slate,null);
  assert.equal(r.decision,'PASS_NO_HISTORY');
  assert.equal(r.marketBenchmarkConsistentlyBetter,false);
});
test('No qualifying live model also suppresses historical pick claims',()=>{
  const r=assembleAgentRun({...slate,events:[{...game,independentModel:{available:false}}]},history);
  assert.equal(r.decision,'PASS_MISSING_MODEL');
});
