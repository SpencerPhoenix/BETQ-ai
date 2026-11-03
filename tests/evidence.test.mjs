import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceProvenance} from './fixtures/source-provenance.mjs';
import { nflMoneylineConsensus } from '../src/market-consensus.mjs';
import {reconcileSettlements} from '../src/settlement-only.mjs';
import {
  MIN_SAMPLE,emptyJournal,validateJournal,matchSchedule,observationsFromSlate,
  resultsFromSchedule,updateJournal,summarizeEvidence
} from '../src/evidence.mjs';

const NOW=Date.parse('2026-11-01T12:00:00Z');
const ISO=n=>new Date(n).toISOString();
const home='Kansas City Chiefs',away='Las Vegas Raiders';
const mockEvent=()=>{
  const start=ISO(NOW+7*3600000);
  return {id:'provider-event-2026-A',sport_key:'americanfootball_nfl',
    commence_time:start,home_team:home,away_team:away,
    bookmakers:[[-125,112],[-135,119],[-130,115],[-128,113]].map(([a,b],i)=>({
      key:'book-'+i,last_update:ISO(NOW-30000),
      markets:[{key:'h2h',last_update:ISO(NOW-30000),
        outcomes:[{name:home,price:a},{name:away,price:b}]}]
    }))};
};
const schedule=(final=false)=>[{
  game_id:'2026_09_LV_KC',season:'2026',game_type:'REG',week:'9',
  gameday:'2026-11-01',home_team:'KC',away_team:'LV',
  home_score:final?'27':'',away_score:final?'17':''
}];
const slate=(time=NOW)=>{
  const original=mockEvent();
  return {
    demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',
    market:'h2h',receivedAt:ISO(time-20000),events:[{
      id:original.id,homeTeam:home,awayTeam:away,commenceTime:original.commence_time,
      started:false,independentModel:{
        available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',
        independentOfOdds:true,use:'RESEARCH_ONLY',
        homeWinProbability:0.62,modelBuiltAt:ISO(NOW-3600000),
        modelVersion:'nfl-elo-1',throughGameDate:'2026-10-31'
      },
      marketConsensus:nflMoneylineConsensus(original,{asOf:NOW})
    }]
  };
};

test('Multi-book no-vig consensus excludes stale quotes and rejects thin lines',()=>{
  const original=mockEvent();
  const good=nflMoneylineConsensus(original,{asOf:NOW});
  assert.equal(good.available,true);
  assert.equal(good.books,4);
  assert.ok(good.homeProbability>0.5&&good.homeProbability<0.7);
  assert.equal(good.basis,'MARKET_DERIVED_NOT_INDEPENDENT');
  original.bookmakers[0].markets[0].last_update=ISO(NOW-30*60000);
  const fresh=nflMoneylineConsensus(original,{asOf:NOW});
  assert.equal(fresh.books,3);
  original.bookmakers[1].markets[0].last_update=ISO(NOW-30*60000);
  assert.equal(nflMoneylineConsensus(original,{asOf:NOW}).reason,'INSUFFICIENT_INDEPENDENT_BOOKS');
  assert.equal(nflMoneylineConsensus(original,{asOf:NOW+8*3600000}).available,false);
});

test('Only valid prospectively timestamped and schedule-matched real NFL predictions are captured',()=>{
  const real=slate();
  const records=observationsFromSlate(real,schedule(),NOW,2026);
  assert.equal(records.accepted.length,1);
  const observation=records.accepted[0];
  assert.equal(observation.gameId,'2026_09_LV_KC');
  assert.equal(observation.marketBookCount,4);
  assert.equal(observation.modelHomeProbability,0.62);
  assert.equal(observation.window,'DAILY');
  assert.equal(matchSchedule(real.events[0],schedule(),2026).game_id,'2026_09_LV_KC');
  const wrong=structuredClone(real);
  wrong.demo=true;
  assert.throws(()=>observationsFromSlate(wrong,schedule(),NOW,2026),/Real NFL/);
  const stale=structuredClone(real);
  stale.receivedAt=ISO(NOW-3600000);
  assert.throws(()=>observationsFromSlate(stale,schedule(),NOW,2026),/timestamp stale/);
  const mismatched=structuredClone(real);
  mismatched.events[0].homeTeam='New York Jets';
  assert.equal(observationsFromSlate(mismatched,schedule(),NOW,2026).accepted.length,0);
});

test('Append-only first forecast survives later revisions, results are reconciled separately',()=>{
  const one=observationsFromSlate(slate(),schedule(),NOW,2026).accepted;
  const journal=emptyJournal(2026);
  const initial=updateJournal(journal,one,[],NOW);
  assert.equal(initial.added,1);
  assert.equal(initial.journal.snapshots.length,1);
  assert.deepEqual(journal.snapshots,[]);
  const duplicate=updateJournal(initial.journal,one,[],NOW);
  assert.equal(duplicate.added,0);
  const last=NOW+6*3600000+20*60000;
  const late=structuredClone(slate(last));
  late.receivedAt=ISO(last-10000);
  late.events[0].marketConsensus.latestQuoteAt=ISO(last-20000);
  const near=observationsFromSlate(late,schedule(),last,2026).accepted;
  assert.equal(near[0].window,'NEAR_KICKOFF');
  assert.notEqual(near[0].id,one[0].id);
  const j=updateJournal(initial.journal,near,[],last).journal;
  assert.equal(j.snapshots.length,2);
  const results=resultsFromSchedule(j,schedule(true),NOW+2*86400000);
  assert.equal(results.length,1);
  const completed=updateJournal(j,[],results,NOW+2*86400000);
  assert.equal(completed.settlementRevisions,1);
  assert.equal(completed.journal.snapshots[0].id,one[0].id);
  assert.equal(updateJournal(completed.journal,[],results,NOW+2*86400000).settlementRevisions,0);
  const report=summarizeEvidence(completed.journal,NOW+2*86400000);
  assert.equal(report.status,'COLLECTING_FORWARD_EVIDENCE');
  assert.equal(report.prospectiveGames,1);
  assert.equal(report.settledGames,1);
  assert.equal(report.pairedMarketGames,1);
  assert.equal(report.nearKickoffConsensusPairs,1);
  assert.equal(report.forwardMetrics,null);
  assert.equal(report.marketComparison,null);
  assert.equal(report.realizedROI,null);
  assert.equal(report.verifiedCLV,null);
});

test('No post-kickoff reconstruction, early/late game trust and result corrections',()=>{
  const obs=observationsFromSlate(slate(),schedule(),NOW,2026).accepted[0];
  const bad={...obs,capturedAt:obs.commenceTime};
  assert.throws(()=>updateJournal(emptyJournal(2026),[bad],[]),/post-kickoff/);
  const journal=updateJournal(emptyJournal(2026),[obs],[]).journal;
  const noFinal=resultsFromSchedule(journal,schedule(true),NOW);
  assert.equal(noFinal.length,0); // day-of source should not be called final.
  const finals=resultsFromSchedule(journal,schedule(true),NOW+2*86400000);
  const settled=updateJournal(journal,[],finals,NOW+2*86400000).journal;
  const corrected={...finals[0],homeScore:24,resultHash:'corrected-hash'};
  const updated=updateJournal(settled,[],[corrected],NOW+3*86400000).journal;
  assert.equal(updated.settlements.length,2);
  assert.equal(updated.settlements[1].revision,2);
  assert.equal(summarizeEvidence(updated).settledGames,1);
});

test('Prospective 30+ finalized games unlock performance without claiming ROI or closing-line value',()=>{
  const j=emptyJournal(2026);
  for(let i=0;i<MIN_SAMPLE+1;i++){
    const obs={
      id:'id-'+i,gameId:'game-'+i,season:2026,home:'KC',away:'LV',
      gameDate:'2026-11-01',commenceTime:ISO(NOW+7*3600000),
      capturedAt:ISO(NOW+i),window:'DAILY',
      modelHomeProbability:0.65,marketHomeProbability:0.57
    };
    j.snapshots.push(obs);
    const homeScore=i%2===0?27:14,awayScore=i%2===0?14:27;
    j.settlements.push({
      gameId:obs.gameId,gameDate:obs.gameDate,
      homeScore,awayScore,
      outcome:i%2===0?'HOME':'AWAY',revision:1,
      source:'NFLVERSE_SCHEDULES',
      finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',
      ...sourceProvenance(ISO(NOW+2*86400000)),
      finalityAttestation:{status:'CROSS_SOURCE_FINAL',
        corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
        gameId:obs.gameId,gameDate:obs.gameDate,
        homeScore,awayScore,eventId:'401123456',
        observedAt:ISO(NOW+2*86400000),
        sourceSha256:'e'.repeat(64),officialLeagueCertification:false}
    });
  }
  const report=summarizeEvidence(j,NOW+86400000);
  assert.equal(report.sourceCorroboratedSettledGames,31);
  assert.equal(report.sourceUncorroboratedSettledGames,0);
  assert.equal(report.forwardMetrics.n,31);
  assert.equal(report.marketComparison.n,31);
  assert.ok(report.marketComparison.confidence95);
  assert.ok(report.forwardMetrics.brier>0&&report.forwardMetrics.brier<1);
  assert.equal(report.marketBeatingEdgeEstablished,false);
  assert.equal(report.realizedROI,null);
  assert.equal(report.verifiedCLV,null);
  assert.equal(report.forwardMetrics.calibration.reduce((n,b)=>n+b.n,0),31);
});

test('Never accepts corrupt or oversize journals',()=>{
  assert.throws(()=>validateJournal({}),/Invalid journal/);
  assert.throws(()=>emptyJournal(1900),/Invalid season/);
  const journal=emptyJournal(2026);
  journal.snapshots=Array.from({length:10001},()=>({}));
  assert.throws(()=>validateJournal(journal),/Invalid journal/);
});

test('legacy and zero-credit pipelines refuse the same premature partial final',()=>{
  const obs=observationsFromSlate(slate(),schedule(),NOW,2026).accepted;
  const journal=updateJournal(emptyJournal(2026),obs,[],NOW).journal;
  const early=NOW+86400000;
  assert.deepEqual(resultsFromSchedule(journal,schedule(true),early),[]);
  const ready=NOW+2*86400000;
  const fromLegacy=resultsFromSchedule(journal,schedule(true),ready);
  const resultRow=schedule(true)[0];
  const attestation={status:'CROSS_SOURCE_FINAL',
    corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',gameId:resultRow.game_id,
    gameDate:resultRow.gameday,homeScore:27,awayScore:17,
    eventId:'401123456',observedAt:ISO(ready),
    sourceSha256:'b'.repeat(64),officialLeagueCertification:false};
  const fromZeroCredit=reconcileSettlements(journal,schedule(true),{
    now:ready,attestations:{[resultRow.game_id]:attestation},
    communitySourceSha256:'a'.repeat(64),communitySourceObservedAt:ISO(ready)
  });
  assert.equal(fromLegacy.length,1);
  assert.equal(fromZeroCredit.appended,1);
  const legacy=updateJournal(journal,[],fromLegacy,ready).journal;
  const a=legacy.settlements[0],b=fromZeroCredit.journal.settlements[0];
  for(const key of ['gameId','outcome','homeScore','awayScore','resultHash'])
    assert.deepEqual(a[key],b[key]);
  assert.equal(a.finalityBasis,'COMMUNITY_SCORE_24H_AFTER_KICKOFF_NOT_LEAGUE_CERTIFIED');
  assert.equal(b.finalityBasis,'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED');
});


test('highest corrected settlement is used once even if revisions are out of order',()=>{
  const obs=observationsFromSlate(slate(),schedule(),NOW,2026).accepted;
  const journal=updateJournal(emptyJournal(2026),obs,[],NOW).journal;
  const earlier={gameId:'2026_09_LV_KC',gameDate:'2026-11-01',homeScore:27,awayScore:17,
    outcome:'HOME',revision:1};
  const corrected={...earlier,homeScore:14,awayScore:27,outcome:'AWAY',revision:2};
  journal.settlements=[corrected,earlier];
  const report=summarizeEvidence(journal,NOW+3*86400000);
  assert.equal(report.settledGames,1);
  assert.equal(report.recentResults[0].score,'27-14');
  assert.equal(report.recentResults[0].result,'AWAY');
  const bad=structuredClone(journal);
  bad.settlements.push({...corrected,homeScore:21,outcome:'AWAY'});
  assert.throws(()=>summarizeEvidence(bad),/CONTRADICTORY_SETTLEMENT_REVISION/);
});

test('thirty uncorroborated community scores cannot publish proper scores or calibration',()=>{
  const j=emptyJournal(2026);
  for(let i=0;i<30;i++){
    j.snapshots.push({id:'legacy-'+i,gameId:'legacy-'+i,
      season:2026,home:'KC',away:'LV',gameDate:'2026-11-01',
      commenceTime:ISO(NOW+7*3600000),capturedAt:ISO(NOW+i),
      modelHomeProbability:0.6,marketHomeProbability:0.55});
    j.settlements.push({gameId:'legacy-'+i,gameDate:'2026-11-01',
      homeScore:27,awayScore:17,outcome:'HOME',revision:1});
  }
  const report=summarizeEvidence(j,NOW+3*86400000);
  assert.equal(report.settledGames,30);
  assert.equal(report.sourceCorroboratedSettledGames,0);
  assert.equal(report.forwardMetrics,null);
  assert.equal(report.marketComparison,null);
  assert.equal(report.status,'COLLECTING_FORWARD_EVIDENCE');
});
