import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertAppendOnlyEvidence,validateRetainedJournal,recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {listGameDossiers,listRetainedForecasts,buildGameDossier} from '../src/game-dossier.mjs';
import {prepareCaptureAdmission} from '../src/evidence.mjs';
import {syntheticScoringJournal,withSyntheticCorroboration} from './fixtures/source-corroborated.mjs';

const fixtureDir=new URL('./fixtures/retained-20261114/',import.meta.url);
const frozen=JSON.parse(readFileSync(new URL('nfl-2026.json',fixtureDir),'utf8'));
const manifest=JSON.parse(readFileSync(new URL('manifest.json',fixtureDir),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deltaBytes=readFileSync(new URL('./fixtures/retained-20261115/append.json',import.meta.url));
const delta=JSON.parse(deltaBytes);
const latestFrozen={...structuredClone(frozen),snapshots:[...structuredClone(frozen.snapshots),...structuredClone(delta.snapshots)],
  settlements:[...structuredClone(frozen.settlements),...structuredClone(delta.settlements)]};

// Compute coverage expectations from raw identities independently of the runtime's
// projection. Do not freeze operational counts, qualified counts, or a reader date.
function checkOperationalBundle(journal,now){
  assertAppendOnlyEvidence(frozen,journal);
  validateRetainedJournal(journal,now);
  const groups=new Map();
  for(const shot of journal.snapshots){
    if(!groups.has(shot.gameId))groups.set(shot.gameId,new Set());
    groups.get(shot.gameId).add(shot.commenceTime);
  }
  const blocked=new Set([...groups].filter(([,times])=>times.size>1).map(([id])=>id));
  const rawResults=new Set(journal.settlements.map(r=>r.gameId));
  const includedSnapshots=journal.snapshots.filter(s=>!blocked.has(s.gameId));
  const includedResults=new Set(journal.settlements.filter(r=>!blocked.has(r.gameId)).map(r=>r.gameId));
  const summary=recomputeJournalEvidence(journal,now),grades=gradeRetainedGames(journal,{now});
  const index=listGameDossiers(journal,{now,limit:10000});
  assert.equal(summary.totalSnapshots,includedSnapshots.length);
  assert.equal(summary.prospectiveGames,groups.size-blocked.size);
  assert.equal(summary.settledGames,includedResults.size);
  assert.equal(summary.quarantine.rawSnapshotCount,journal.snapshots.length);
  assert.equal(summary.quarantine.rawResultCount,journal.settlements.length);
  assert.equal(summary.quarantine.excludedGameCount,blocked.size);
  assert.equal(index.total,groups.size-blocked.size);
  assert.equal(grades.available,true);
  assert.equal(grades.coverage.trackedGames,groups.size);
  assert.equal(grades.coverage.recordedResults,rawResults.size);
  assert.equal(grades.coverage.pendingGames,groups.size-rawResults.size);
  assert.equal(grades.coverage.gradedGames+grades.coverage.ungradedGames,rawResults.size);
  assert.equal(grades.coverage.leagueWideCompletenessVerified,false);
  for(const game of grades.games){
    if(blocked.has(game.gameId)){
      assert.equal(game.status,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(game.metrics,null);
    }
    if(game.metrics){
      assert.equal(game.status,'GRADED');assert.equal(game.result.sourceCorroborated,true);
    }else assert.notEqual(game.status,'GRADED');
  }
  return {summary,grades,index};
}

test('pinned real-data regressions bind exact source bytes and do not track mutable main',()=>{
  assert.equal(manifest.sourceCommit,'f53b4b346ed79200d88dacccc648bab3f17c09df');
  assert.equal(manifest.files['nfl-2026.json'].sha256,'78b66943381466d255321ee21914bc9b6d10bbacbf39696309ce26fc772cbfb9');
  assert.equal(manifest.files['summary.json'].sha256,'97661b79a6b0cab67b96f703a85bd3318ccddf46c2afbc9fbfef7da9f87cb597');
  for(const [name,entry] of Object.entries(manifest.files)){
    const bytes=readFileSync(new URL(name,fixtureDir));
    assert.equal(bytes.length,entry.bytes);assert.equal(digest(bytes),entry.sha256);
  }
  assert.equal(frozen.snapshots.length,323);assert.equal(frozen.settlements.length,18);
});

test('current operational bundle preserves frozen history and internally coherent evolving coverage',()=>{
  const path=new URL('../data/evidence/nfl-2026.json',import.meta.url),bytes=readFileSync(path);
  const journal=JSON.parse(bytes),before=JSON.stringify(journal);
  checkOperationalBundle(journal,Date.now());
  assert.deepEqual(journal.snapshots.slice(0,latestFrozen.snapshots.length),latestFrozen.snapshots);
  assert.deepEqual(journal.settlements.slice(0,latestFrozen.settlements.length),latestFrozen.settlements);
  assert.equal(JSON.stringify(journal),before);assert.deepEqual(readFileSync(path),bytes);
});

test('later legitimate append and newly qualified result do not invalidate fixed regressions or live invariants',()=>{
  // Synthetic future records only, held in memory; no operational file is written.
  const journal=structuredClone(frozen),shot=syntheticScoringJournal(1,0).snapshots[0];
  Object.assign(shot,{id:'synthetic-future-append',gameId:'synthetic-future-game',providerEventId:'synthetic-future-provider',
    gameDate:'2026-11-26',commenceTime:'2026-11-26T18:00:00.000Z',capturedAt:'2026-11-25T12:00:00.000Z',
    sourceReceivedAt:'2026-11-25T11:59:59.000Z',marketOldestQuoteAt:'2026-11-25T11:59:58.000Z',
    marketNewestQuoteAt:'2026-11-25T11:59:58.000Z'});
  journal.snapshots.push(shot);
  let out=checkOperationalBundle(journal,Date.parse('2026-11-25T13:00:00.000Z'));
  assert.equal(out.summary.totalSnapshots,315);assert.equal(out.grades.coverage.pendingGames,27);
  const result=withSyntheticCorroboration({gameId:shot.gameId,gameDate:shot.gameDate,season:shot.season,
    home:shot.home,away:shot.away,commenceTime:shot.commenceTime,homeScore:27,awayScore:17,outcome:'HOME',revision:1},
    '2026-11-28T12:00:00.000Z');
  journal.settlements.push(result);
  out=checkOperationalBundle(journal,Date.parse('2026-11-28T13:00:00.000Z'));
  assert.equal(out.summary.sourceCorroboratedSettledGames,1);assert.equal(out.grades.coverage.gradedGames,1);
  assert.equal(out.summary.forwardMetrics,null);assert.equal(frozen.snapshots.length,323);
  assert.deepEqual(journal.snapshots.slice(0,323),frozen.snapshots);
  assert.deepEqual(journal.settlements.slice(0,18),frozen.settlements);
});

test('operational coverage checks still reject rewritten, removed and future evidence',()=>{
  const now=Date.parse('2026-11-16T12:00:00.000Z');
  for(const mutate of [j=>{j.snapshots[0].modelHomeProbability=.99;},j=>{j.snapshots.shift();},j=>{j.settlements.pop();}]){
    const j=structuredClone(frozen);mutate(j);assert.throws(()=>checkOperationalBundle(j,now));
  }
  assert.throws(()=>checkOperationalBundle(frozen,Date.parse('2026-11-13T12:00:00.000Z')),/FUTURE_OR_INVALID_OBSERVATION_TIME/);
});


test('November 15 retained kickoff revisions preserve all history and quarantine all eight conflicts',()=>{
  assert.equal(digest(deltaBytes),'55a9c24e10c6ec8aecfbd6d229b7d0a981b05db2a2675c13303c6637f3c0ae46');
  assert.equal(delta.sourceCommit,'1bfc9afe9ebd056c53b90ab8aeab8e9a1a2f6967');
  assert.equal(delta.sourceJournalSha256,'9ddc1b612e3a2620213d1d0149670f26a087b4ce43d742eab6dbcf7297a2f199');
  assert.equal(digest(JSON.stringify(latestFrozen,null,2)+'\n'),delta.sourceJournalSha256);
  assert.equal(delta.snapshots.length,24);assert.deepEqual(delta.settlements,[]);
  const j=structuredClone(latestFrozen),before=JSON.stringify(j),now=Date.parse('2026-11-16T12:00:00.000Z');
  const {summary,grades,index}=checkOperationalBundle(j,now),q=summary.quarantine;
  const expected={'2026_09_LV_SF':9,'2026_10_BUF_NYJ':12,'2026_10_CAR_NO':12,'2026_10_HOU_CLE':12,
    '2026_10_JAX_TEN':12,'2026_10_KC_ATL':11,'2026_10_MIA_IND':12,'2026_10_MIN_GB':12};
  assert.deepEqual(q.games.map(g=>g.gameId),Object.keys(expected));
  assert.deepEqual([q.rawGameCount,q.rawSnapshotCount,q.rawResultCount,q.excludedGameCount,q.excludedSnapshotCount,q.excludedResultCount],
    [44,347,18,8,92,1]);
  assert.deepEqual([summary.prospectiveGames,summary.totalSnapshots,summary.settledGames],[36,255,17]);
  assert.equal(summary.sourceCorroboratedSettledGames,0);
  const forecasts=listRetainedForecasts(j,{now});
  for(const conflict of q.games){
    assert.equal(conflict.snapshotCount,expected[conflict.gameId]);
    assert.equal(conflict.scoringEligible,false);assert.equal(conflict.collectionEligible,false);
    const old=conflict.gameId==='2026_09_LV_SF';
    assert.deepEqual(conflict.observedCommenceTimes,old?
      ['2026-11-08T21:05:00.000Z','2026-11-08T21:25:00.000Z']:
      ['2026-11-15T18:00:00.000Z','2026-11-15T18:05:00.000Z']);
    assert.equal(conflict.firstFrozenCommenceTime,conflict.observedCommenceTimes[0]);
    assert.equal(index.games.some(g=>g.gameId===conflict.gameId),false);
    assert.equal(forecasts.games.some(g=>g.gameId===conflict.gameId),false);
    const grade=grades.games.find(g=>g.gameId===conflict.gameId);
    assert.equal(grade.status,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(grade.metrics,null);
    const dossier=buildGameDossier(j,{gameId:conflict.gameId,now});
    assert.equal(dossier.available,false);assert.equal(dossier.reason,'SCHEDULE_CONFLICT_QUARANTINED');
    assert.equal(dossier.conflict.history.total,expected[conflict.gameId]);
    assert.deepEqual(dossier.conflict.observedCommenceTimes,conflict.observedCommenceTimes);
  }
  // The old collector's retained records are inspected, never admitted anew by
  // relaxing the current writer. A fresh conflicting capture must still fail.
  const changes=delta.snapshots.filter(s=>frozen.snapshots.some(p=>p.gameId===s.gameId&&p.commenceTime!==s.commenceTime));
  assert.equal(changes.length,7);
  for(const shot of changes){
    const admission=prepareCaptureAdmission(frozen,[shot],now);
    assert.deepEqual(admission.accepted,[]);
    assert.deepEqual(admission.skipped[0].reasons,['FROZEN_GAME_IDENTITY_CONFLICT']);
  }
  assert.equal(JSON.stringify(j),before);
  assert.deepEqual(j.snapshots.slice(0,323),frozen.snapshots);assert.deepEqual(j.settlements,frozen.settlements);
});
