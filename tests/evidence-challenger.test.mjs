import test from 'node:test';
import {withSyntheticCorroboration} from './fixtures/source-corroborated.mjs';
import assert from 'node:assert/strict';
import {
  emptyJournal,observationsFromSlate,updateJournal,summarizeEvidence,MIN_SAMPLE
} from '../src/evidence.mjs';

const NOW=Date.parse('2026-11-02T01:00:00Z'),iso=n=>new Date(n).toISOString();
const a={
  id:'odds-2026-10-foo',homeTeam:'Kansas City Chiefs',awayTeam:'Las Vegas Raiders',
  commenceTime:iso(NOW+5*86400000),started:false,
  independentModel:{
    available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',independentOfOdds:true,
    use:'RESEARCH_ONLY',homeWinProbability:0.60,modelVersion:'nfl-elo-1',
    modelBuiltAt:iso(NOW-3600000),throughGameDate:'2026-11-01'
  },
  marketConsensus:{
    available:true,method:'ALL_BOOKS_MEDIAN_DE_VIG',books:4,
    homeProbability:0.58,disagreementPoints:1.2,
    oldestQuoteAgeSeconds:70,latestQuoteAt:iso(NOW-30000)
  }
};
const schedule=[{
  game_id:'2026_10_LV_KC',season:'2026',game_type:'REG',week:'10',
  gameday:'2026-11-06',home_team:'KC',away_team:'LV',
  home_score:'',away_score:''
}];
const slate=(event)=>({
  demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',
  market:'h2h',receivedAt:iso(NOW-15000),events:[event]
});
test('New EPA research forecasts are appended without overwriting prior Elo-only same-day game',()=>{
  const elo=observationsFromSlate(slate(a),schedule,NOW,2026).accepted;
  assert.equal(elo.length,1);
  assert.equal(elo[0].challengerHomeProbability,null);
  const challenger=structuredClone(a);
  challenger.efficiencyChallenger={
    available:true,independentOfOdds:true,researchOnly:true,
    automaticSelection:false,modelVersion:'nfl-efficiency-1',
    homeWinProbability:0.66,generatedAt:iso(NOW-3600000)
  };
  const second=observationsFromSlate(slate(challenger),schedule,NOW,2026).accepted;
  assert.equal(second.length,1);
  assert.notEqual(elo[0].id,second[0].id);
  assert.equal(second[0].challengerHomeProbability,0.66);
  assert.equal(second[0].challengerResearchOnly,true);
  const updated=updateJournal(emptyJournal(2026),[...elo,...second],[],NOW);
  assert.equal(updated.added,2);
  assert.equal(updated.journal.snapshots.length,2);
  assert.equal(summarizeEvidence(updated.journal,NOW).prospectiveChallengerGames,1);
  assert.equal(summarizeEvidence(updated.journal,NOW).pairedChallengerSettled,0);
});
test('A challenger generated in the future never enters the immutable record',()=>{
  const event=structuredClone(a);
  event.efficiencyChallenger={
    available:true,independentOfOdds:true,researchOnly:true,automaticSelection:false,
    modelVersion:'nfl-efficiency-1',homeWinProbability:0.65,
    generatedAt:iso(NOW+120000)
  };
  const result=observationsFromSlate(slate(event),schedule,NOW,2026).accepted;
  assert.equal(result[0].challengerHomeProbability,null);
  const bad={...result[0],challengerHomeProbability:0.66,
    challengerResearchOnly:true,challengerBuiltAt:'bad-date'};
  assert.throws(()=>updateJournal(emptyJournal(2026),[bad],[]),/Invalid/);
});
test('Paired prospective Elo vs EPA scores require 30 finalized challenger games',()=>{
  const j=emptyJournal(2026);
  for(let i=0;i<MIN_SAMPLE+1;i++){
    j.snapshots.push({
      id:'pair-'+i,gameId:'game-'+i,season:2026,
      commenceTime:iso(NOW+5*86400000),capturedAt:iso(NOW+1000+i),
      gameDate:'2026-11-07',home:'KC',away:'LV',
      modelHomeProbability:0.55,challengerHomeProbability:0.64,
      independentModel:true,researchOnly:true,sourceReceivedAt:iso(NOW),
      modelBuiltAt:iso(NOW-3600000),modelLastResultDate:'2026-10-31',
      challengerResearchOnly:true,challengerModelVersion:'nfl-efficiency-1',
      challengerBuiltAt:iso(NOW-3600000),
      marketHomeProbability:null
    });
    const score=i%2===0?1:0;
    j.settlements.push(withSyntheticCorroboration({
      gameDate:'2026-11-07',commenceTime:iso(NOW+5*86400000),gameId:'game-'+i,outcome:score?'HOME':'AWAY',
      homeScore:score?27:17,awayScore:score?17:27,revision:1
    },iso(NOW+10*86400000)));
  }
  let report=summarizeEvidence(j,NOW+10*86400000);
  assert.equal(report.prospectiveChallengerGames,31);
  assert.equal(report.pairedChallengerSettled,31);
  assert.equal(report.challengerForwardComparison.n,31);
  assert.ok(report.challengerForwardComparison.confidence95);
  assert.equal(report.realizedROI,null);
  assert.equal(report.marketBeatingEdgeEstablished,false);
  assert.equal(report.verifiedCLV,null);
  j.snapshots.pop();j.settlements.pop();
  report=summarizeEvidence(j);
  assert.equal(report.pairedChallengerSettled,30);
  assert.ok(report.challengerForwardComparison);
  j.snapshots.pop();j.settlements.pop();
  report=summarizeEvidence(j);
  assert.equal(report.pairedChallengerSettled,29);
  assert.equal(report.challengerForwardComparison,null);
});
