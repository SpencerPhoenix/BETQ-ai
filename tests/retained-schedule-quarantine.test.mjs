import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {emptyJournal,prepareCaptureAdmission,updateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {classifyFrozenSchedules} from '../src/retained-schedule-quarantine.mjs';
import {retainedJournalProjection,validateRetainedJournal,recomputeJournalEvidence,createJournalEvidenceFeed,assertAppendOnlyEvidence} from '../src/evidence-journal-feed.mjs';
import {listGameDossiers,listRetainedForecasts,buildGameDossier} from '../src/game-dossier.mjs';
import {createHandler,loadEvidenceJournal} from '../src/server.mjs';
import {createDerivedForwardMarketFeed} from '../src/shadow-derived.mjs';
import {syntheticScoringJournal,withSyntheticCorroboration} from './fixtures/source-corroborated.mjs';

// Fabricated observations and receipts only, except the explicitly read-only bundle test.
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const CAPTURE=Date.parse('2026-11-07T13:00:00.000Z');
const POLICY='FROZEN_SCHEDULE_CONFLICT_QUARANTINE_V1';
const GAME='fixture-game-0',OTHER='fixture-game-1';
const iso=value=>new Date(value).toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const firstKick='2026-11-08T18:00:00.000Z',secondKick='2026-11-08T18:20:00.000Z';
function fixture({qualified=0,results=true}={}){
  const j={...syntheticScoringJournal(2,qualified),provenance:emptyJournal(2026).provenance};
  j.snapshots.push({...j.snapshots[0],id:'fixture-0-later',commenceTime:secondKick,
    capturedAt:'2026-11-07T12:01:00.000Z'});
  if(!results)j.settlements=[];
  return j;
}
function capture(snapshot,changes={}){
  return {...snapshot,id:snapshot.id+'-new',capturedAt:iso(CAPTURE),sourceReceivedAt:iso(CAPTURE-1000),
    marketNewestQuoteAt:iso(CAPTURE-2000),marketOldestQuoteAt:iso(CAPTURE-2000),...changes};
}
function assertNoScoring(summary){
  assert.equal(summary.sourceCorroboratedSettledGames,0);
  assert.equal(summary.sourceCorroboratedMarketGames,0);
  assert.equal(summary.sourceCorroboratedChallengerGames,0);
  assert.equal(summary.forwardMetrics,null);assert.equal(summary.marketComparison,null);
  assert.equal(summary.challengerForwardComparison,null);assert.equal(summary.realizedROI,null);
  assert.equal(summary.verifiedCLV,null);assert.equal(summary.marketBeatingEdgeEstablished,false);
}

test('Schedule classification is deterministic, narrow and never normalizes retained records',()=>{
  const j=fixture(),before=JSON.stringify(j),expected={gameId:GAME,season:2026,home:'KC',away:'LV',
    gameDate:'2026-11-08',reason:'CONFLICTING_RETAINED_KICKOFFS',firstFrozenSnapshotId:'fixture-0',
    firstFrozenCommenceTime:firstKick,observedCommenceTimes:[firstKick,secondKick],snapshotCount:2,
    scoringEligible:false,collectionEligible:false};
  for(const records of [j.snapshots,[...j.snapshots].reverse()]){
    const classified=classifyFrozenSchedules(records);
    assert.deepEqual(classified.blocked,new Set([GAME]));assert.deepEqual(classified.games,[expected]);
  }
  assert.equal(JSON.stringify(j),before);
  const one=structuredClone(j.snapshots.slice(0,2));delete one[0].providerEventId;
  assert.deepEqual(classifyFrozenSchedules(one),{blocked:new Set(),games:[]},'missing legacy provider alone is not a schedule conflict');
});

test('A one-millisecond kickoff difference is quarantined, without any reconciliation tolerance',()=>{
  const j=fixture();j.snapshots[2].commenceTime=iso(Date.parse(firstKick)+1);
  const state=classifyFrozenSchedules(j.snapshots);
  assert.deepEqual(state.games[0].observedCommenceTimes,[firstKick,'2026-11-08T18:00:00.001Z']);
  assert.equal(state.games[0].firstFrozenCommenceTime,firstKick);
});

for(const [label,mutate] of Object.entries({
  season:s=>{s.season=2027;},home:s=>{s.home='BUF';},away:s=>{s.away='SEA';},
  date:s=>{s.gameDate='2026-11-09';},'missing provider':s=>{delete s.providerEventId;},
  'different provider':s=>{s.providerEventId='other-provider';},
  'empty provider':s=>{s.providerEventId='';},'trimmed provider':s=>{s.providerEventId=' synthetic-provider-0';},
  'control provider':s=>{s.providerEventId='synthetic-provider-0\n';},
  'overlong provider':s=>{s.providerEventId='x'.repeat(201);},
  'noncanonical kickoff':s=>{s.commenceTime='2026-11-08T18:20:00Z';},
  'rolled calendar kickoff':s=>{s.commenceTime='2026-11-31T18:20:00.000Z';}
}))test('Schedule-only classification cannot hide '+label+' corruption',()=>{
  const j=fixture();mutate(j.snapshots[2]);const before=JSON.stringify(j);
  assert.throws(()=>classifyFrozenSchedules(j.snapshots),/INVALID_RETAINED/);
  assert.throws(()=>retainedJournalProjection(j,NOW));assert.equal(JSON.stringify(j),before);
});

test('Cross-game provider reuse makes an apparent schedule conflict globally invalid',()=>{
  const j=fixture();j.snapshots[1].providerEventId=j.snapshots[0].providerEventId;
  assert.throws(()=>classifyFrozenSchedules(j.snapshots),/INVALID_RETAINED/);
  assert.equal(listGameDossiers(j,{now:NOW}).reason,'INVALID_RETAINED_JOURNAL');
});

test('Unchanged kickoff recaptures are not quarantined and first frozen means capture order, not earliest kickoff',()=>{
  const j=fixture();j.snapshots[2].commenceTime=firstKick;
  assert.equal(classifyFrozenSchedules(j.snapshots).blocked.size,0);
  j.snapshots[2].commenceTime='2026-11-08T17:40:00.000Z';
  const q=retainedJournalProjection(j,NOW).quarantine.games[0];
  assert.equal(q.firstFrozenSnapshotId,'fixture-0');assert.equal(q.firstFrozenCommenceTime,firstKick);
  assert.deepEqual(q.observedCommenceTimes,['2026-11-08T17:40:00.000Z',firstKick]);
});

test('Read projection excludes every conflicted snapshot and result revision but preserves complete raw history',()=>{
  const j=fixture();j.settlements.push({...j.settlements[0],revision:2,verifiedAt:'2026-11-15T13:00:00.000Z'});
  const before=JSON.stringify(j),out=retainedJournalProjection(j,NOW);
  assert.notEqual(out.journal,j);assert.notEqual(out.journal.snapshots,j.snapshots);
  assert.deepEqual(out.journal.snapshots,[j.snapshots[1]]);
  assert.deepEqual(out.journal.settlements,[j.settlements[1]]);
  assert.equal(out.latest.has(GAME),false,'projection latest results exclude quarantined games');
  const allLatest=validateRetainedJournal(j,NOW);
  assert.equal(allLatest.get(GAME).revision,2,'strict latest-result API still includes full retained history');
  assert.deepEqual(allLatest.get(OTHER),out.latest.get(OTHER));
  assert.deepEqual(out.quarantine,{policy:POLICY,historyPreserved:true,rawGameCount:2,rawSnapshotCount:3,
    rawResultCount:3,excludedGameCount:1,excludedSnapshotCount:2,excludedResultCount:2,
    games:[{...classifyFrozenSchedules(j.snapshots).games[0],resultCount:2}]});
  assert.equal(JSON.stringify(j),before);
  out.journal.snapshots[0].modelHomeProbability=.99;out.journal.settlements[0].homeScore=99;
  out.journal.provenance.model='FORGED';out.latest.get(OTHER).homeScore=98;
  assert.equal(JSON.stringify(j),before);
});

test('All-conflicted input is a valid empty projection with explicit exclusions, not a fabricated empty journal',()=>{
  const j=fixture();j.snapshots=j.snapshots.filter(s=>s.gameId===GAME);j.settlements=j.settlements.filter(r=>r.gameId===GAME);
  const summary=recomputeJournalEvidence(j,NOW),index=listGameDossiers(j,{now:NOW});
  assert.equal(summary.totalSnapshots,0);assert.equal(summary.prospectiveGames,0);assert.equal(summary.settledGames,0);
  assert.equal(summary.quarantine.rawSnapshotCount,2);assert.equal(summary.quarantine.excludedGameCount,1);
  assert.equal(index.available,true);assert.equal(index.total,0);assertNoScoring(summary);
});

test('A quarantined otherwise qualified game cannot meet the scoring threshold or change remaining baselines',()=>{
  const j={...syntheticScoringJournal(30,30),provenance:emptyJournal(2026).provenance};
  j.snapshots.push({...j.snapshots[0],id:'fixture-0-later',commenceTime:secondKick,capturedAt:'2026-11-07T12:01:00.000Z',modelHomeProbability:.99});
  const summary=recomputeJournalEvidence(j,NOW);
  assert.equal(summary.prospectiveGames,29);assert.equal(summary.settledGames,29);
  assert.equal(summary.sourceCorroboratedSettledGames,29);assert.equal(summary.sourceCorroboratedMarketGames,29);
  assert.equal(summary.sourceCorroboratedChallengerGames,29);assert.equal(summary.forwardMetrics,null);
  assert.equal(summary.marketComparison,null);assert.equal(summary.challengerForwardComparison,null);
  assert.equal(summary.recentResults.some(r=>r.gameId===GAME),false);
  assert.equal(buildGameDossier(j,{gameId:OTHER,now:NOW}).firstFrozenBaseline.id,'fixture-1');
});

for(const [label,mutate] of Object.entries({
  'invalid model probability':j=>{j.snapshots[2].modelHomeProbability=2;},
  'duplicate snapshot id':j=>{j.snapshots[2].id=j.snapshots[0].id;},
  'post-kickoff capture':j=>{j.snapshots[2].capturedAt=secondKick;},
  'future capture':j=>{j.snapshots[2].capturedAt='2026-11-17T12:00:00.000Z';},
  'future source receipt':j=>{j.snapshots[2].sourceReceivedAt='2026-11-17T12:00:00.000Z';},
  'future result':j=>{j.settlements[0].verifiedAt='2026-11-17T12:00:00.000Z';},
  'invalid outcome':j=>{j.settlements[0].outcome='AWAY';},
  'contradictory revision':j=>{j.settlements.push({...j.settlements[0],homeScore:28});},
  'orphan result':j=>{j.settlements.push({...j.settlements[0],gameId:'not-retained'});},
  'raw bookmaker payload':j=>{j.snapshots[2].nested={bookmakers:[]};},
  'private credential':j=>{j.settlements[0].nested={access_token:'NEVER_EXPOSE_SYNTHETIC'};}
}))test('Full journal validation precedes filtering: '+label+' inside excluded game still fails closed',()=>{
  const j=fixture();mutate(j);const before=JSON.stringify(j);
  assert.throws(()=>retainedJournalProjection(j,NOW));assert.throws(()=>recomputeJournalEvidence(j,NOW));
  assert.equal(listGameDossiers(j,{now:NOW}).reason,'INVALID_RETAINED_JOURNAL');
  assert.equal(buildGameDossier(j,{gameId:OTHER,now:NOW}).reason,'INVALID_RETAINED_JOURNAL');
  assert.equal(JSON.stringify(j),before);
});

test('Every conflicted-result receipt must be strictly after the latest observed kickoff',()=>{
  for(const receipt of ['verifiedAt','communitySourceVintage','terminalStatusReceipt','finalityAttestation']){
    for(const value of [firstKick,'2026-11-08T18:10:00.000Z',secondKick]){
      const j=fixture({qualified:2}),r=j.settlements[0];
      if(receipt==='verifiedAt')r.verifiedAt=value;
      else r[receipt][receipt==='communitySourceVintage'?'collectorObservedAt':'observedAt']=value;
      assert.throws(()=>retainedJournalProjection(j,NOW),/RESULT_RECEIPT_BEFORE_KICKOFF/,receipt+' '+value);
    }
  }
});

test('Legacy conflicted result cannot appear before or at the latest kickoff even without receipts',()=>{
  const j=fixture();j.settlements=[{gameId:GAME,homeScore:27,awayScore:17,outcome:'HOME'}];
  for(const now of [Date.parse(firstKick)+1,Date.parse(secondKick)])
    assert.throws(()=>retainedJournalProjection(j,now),/RESULT_BEFORE_KICKOFF/);
  assert.equal(retainedJournalProjection(j,Date.parse(secondKick)+1).quarantine.excludedResultCount,1);
});

test('Explicit result identity must match stable fields and one observed original kickoff',()=>{
  for(const commenceTime of [firstKick,secondKick]){
    const j=fixture();Object.assign(j.settlements[0],{season:2026,home:'KC',away:'LV',commenceTime});
    assert.equal(retainedJournalProjection(j,NOW).quarantine.excludedResultCount,1);
  }
  for(const [key,value] of Object.entries({season:2027,home:'BUF',away:'SEA',gameDate:'2026-11-09',
    commenceTime:'2026-11-08T18:10:00.000Z'})){
    const j=fixture();j.settlements[0][key]=value;
    assert.throws(()=>retainedJournalProjection(j,NOW),/CONFLICTING_RESULT_IDENTITY/,key);
  }
});

test('Nested receipts cannot contradict stable identities, observed kickoffs or retained scores inside quarantine',()=>{
  for(const receipt of ['communitySourceVintage','terminalStatusReceipt','finalityAttestation']){
    for(const [key,value] of Object.entries({gameId:OTHER,season:2027,home:'BUF',away:'SEA',
      gameDate:'2026-11-09',commenceTime:'2026-11-08T18:10:00.000Z',homeScore:28,awayScore:18})){
      const j=fixture({qualified:2});j.settlements[0][receipt][key]=value;
      assert.throws(()=>retainedJournalProjection(j,NOW),/CONFLICTING_RESULT_IDENTITY/,receipt+'.'+key);
      assert.throws(()=>prepareCaptureAdmission(j,[],NOW),/identity/i,receipt+'.'+key);
      assert.throws(()=>updateJournal(j,[],[],NOW),/CONFLICTING_RESULT_IDENTITY/,receipt+'.'+key);
    }
  }
});

test('Present receipts must be objects and bind one consistent observed kickoff across result and receipts',()=>{
  for(const receipt of ['communitySourceVintage','terminalStatusReceipt','finalityAttestation']){
    for(const value of [[],42,true,'malformed']){
      const j=fixture({qualified:2});j.settlements[0][receipt]=value;
      assert.throws(()=>retainedJournalProjection(j,NOW),/CONFLICTING_RESULT_IDENTITY/);
      assert.throws(()=>prepareCaptureAdmission(j,[],NOW));assert.throws(()=>updateJournal(j,[],[],NOW));
    }
    const j=fixture({qualified:2});j.settlements[0][receipt].commenceTime=secondKick;
    assert.throws(()=>retainedJournalProjection(j,NOW),/CONFLICTING_RESULT_IDENTITY/);
    assert.throws(()=>prepareCaptureAdmission(j,[],NOW));assert.throws(()=>updateJournal(j,[],[],NOW));
  }
  const coherent=fixture({qualified:2}),r=coherent.settlements[0];
  for(const bound of [r,r.communitySourceVintage,r.terminalStatusReceipt,r.finalityAttestation])bound.commenceTime=secondKick;
  assert.equal(retainedJournalProjection(coherent,NOW).quarantine.excludedResultCount,1);
});

for(const [label,mutate] of Object.entries({
  'invalid model probability':j=>{j.snapshots[2].modelHomeProbability=2;},
  'duplicate snapshot id':j=>{j.snapshots[2].id=j.snapshots[0].id;},
  'future snapshot':j=>{j.snapshots[2].capturedAt='2026-11-17T12:00:00.000Z';},
  'future result':j=>{j.settlements[0].verifiedAt='2026-11-17T12:00:00.000Z';},
  'early result':j=>{j.settlements[0].verifiedAt='2026-11-08T18:10:00.000Z';},
  'wrong result identity':j=>{j.settlements[0].home='BUF';},
  'unobserved result kickoff':j=>{j.settlements[0].commenceTime='2026-11-08T18:10:00.000Z';},
  'orphan result':j=>{j.settlements.push({...j.settlements[0],gameId:'absent'});},
  'invalid outcome':j=>{j.settlements[0].outcome='AWAY';},
  'contradictory revision':j=>{j.settlements.push({...j.settlements[0],homeScore:28});}
}))test('Writer and admission validate full retained history before quarantine: '+label,()=>{
  const j=fixture(),good=capture(j.snapshots[1]);mutate(j);const before=JSON.stringify(j);
  for(const candidates of [[],[good]]){
    assert.throws(()=>prepareCaptureAdmission(j,candidates,NOW));
    assert.throws(()=>updateJournal(j,candidates,[],NOW));
  }
  assert.equal(JSON.stringify(j),before);
});

test('Conflicted dossier selectors show original allowlisted history; active indexes exclude the game',()=>{
  const j=fixture();j.snapshots[2].privateMemo='NEVER_EXPOSE_SYNTHETIC';const before=JSON.stringify(j);
  for(const selector of [{gameId:GAME},{providerEventId:j.snapshots[0].providerEventId}]){
    const d=buildGameDossier(j,{...selector,now:NOW});
    assert.equal(d.available,false);assert.equal(d.reason,'SCHEDULE_CONFLICT_QUARANTINED');
    assert.equal(d.conflict.scoringEligible,false);assert.equal(d.conflict.collectionEligible,false);
    assert.equal(d.conflict.firstFrozenSnapshotId,'fixture-0');
    assert.deepEqual(d.conflict.history.snapshots.map(s=>s.commenceTime),[firstKick,secondKick]);
    assert.equal(d.conflict.history.total,2);assert.equal(d.conflict.history.truncated,false);
    assert.doesNotMatch(JSON.stringify(d),/NEVER_EXPOSE_SYNTHETIC/);
    assert.equal(d.result,undefined);assert.equal(d.firstFrozenBaseline,undefined);
  }
  for(const list of [listGameDossiers,listRetainedForecasts]){
    const index=list(j,{now:NOW});assert.equal(index.available,true);assert.deepEqual(index.games.map(g=>g.gameId),[OTHER]);
    assert.equal(index.quarantine.excludedGameCount,1);assert.equal(index.quarantine.historyPreserved,true);
  }
  assert.equal(JSON.stringify(j),before);
});

test('Quarantined history is deterministic and bounded while metadata preserves the original baseline',()=>{
  const j=fixture({results:false}),base=j.snapshots[0];
  j.snapshots=Array.from({length:105},(_,i)=>({...base,id:'snapshot-'+String(i).padStart(3,'0'),
    commenceTime:i%2?secondKick:firstKick})).reverse();
  const before=JSON.stringify(j),d=buildGameDossier(j,{gameId:GAME,now:NOW});
  assert.equal(d.reason,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(d.conflict.firstFrozenSnapshotId,'snapshot-000');
  assert.equal(d.conflict.firstFrozenCommenceTime,firstKick);assert.equal(d.conflict.history.total,105);
  assert.equal(d.conflict.history.limit,100);assert.equal(d.conflict.history.truncated,true);
  assert.equal(d.conflict.history.snapshots.length,100);assert.equal(d.conflict.history.snapshots[0].id,'snapshot-005');
  d.conflict.history.snapshots[0].commenceTime='FORGED';assert.equal(JSON.stringify(j),before);
});

test('Capture admission skips all captures for already quarantined games and admits unrelated observations',()=>{
  const j=fixture({results:false}),before=JSON.stringify(j),good=capture(j.snapshots[1]);
  const bad=[capture(j.snapshots[0]),capture(j.snapshots[2]),structuredClone(j.snapshots[0])];
  for(const candidates of [[...bad,good],[good,...bad.reverse()]]){
    const out=prepareCaptureAdmission(j,candidates,CAPTURE);
    assert.deepEqual(out.accepted,[good]);assert.equal(out.skipped.length,3);
    assert.ok(out.skipped.every(s=>s.gameId===GAME));assert.equal(out.diagnostics.quarantinedGames,1);
    assert.equal(out.diagnostics.quarantinedCaptures,3);
    const next=updateJournal(j,out.accepted,[],CAPTURE);
    assert.equal(next.added,1);assert.equal(next.journal.snapshots.filter(s=>s.gameId===GAME).length,2);
    for(const original of j.snapshots)assert.deepEqual(next.journal.snapshots.find(s=>s.id===original.id),original);
  }
  assert.equal(JSON.stringify(j),before);
});

test('Direct writer cannot append or deduplicate captures/results into a quarantined game',()=>{
  const j=fixture({results:false}),before=JSON.stringify(j);
  for(const captures of [[capture(j.snapshots[0])],[capture(j.snapshots[2])],[structuredClone(j.snapshots[0])]])
    assert.throws(()=>updateJournal(j,captures,[],CAPTURE),/conflict|quarantin/i);
  const result=withSyntheticCorroboration({gameId:GAME,gameDate:'2026-11-08',homeScore:27,awayScore:17,outcome:'HOME'},iso(NOW));
  assert.throws(()=>updateJournal(j,[],[result],NOW),/conflict|quarantin|identity/i);
  assert.deepEqual(updateJournal(j,[],[],NOW).journal,j);assert.equal(JSON.stringify(j),before);
});

test('Malformed existing stable identity remains a global writer/admission failure even without new captures',()=>{
  const j=fixture({results:false});j.snapshots[2].home='BUF';
  assert.throws(()=>prepareCaptureAdmission(j,[],CAPTURE),/identity|IDENTITY/);
  assert.throws(()=>updateJournal(j,[],[],CAPTURE),/identity|IDENTITY/);
});

test('Unrelated final receipt can still append beside quarantined history without qualifying the conflict',()=>{
  const j=fixture({results:false}),before=JSON.stringify(j);
  const result=withSyntheticCorroboration({gameId:OTHER,gameDate:'2026-11-08',homeScore:27,awayScore:17,outcome:'HOME'},iso(NOW));
  const out=updateJournal(j,[],[result],NOW);
  assert.equal(out.settlementRevisions,1);assert.equal(out.journal.settlements[0].gameId,OTHER);
  assert.deepEqual(out.journal.snapshots,j.snapshots);assert.equal(JSON.stringify(j),before);
  assert.equal(recomputeJournalEvidence(out.journal,NOW).sourceCorroboratedSettledGames,1);
  assert.equal(buildGameDossier(out.journal,{gameId:GAME,now:NOW}).reason,'SCHEDULE_CONFLICT_QUARANTINED');
});

test('Accepted conflict refresh retains full publication digest and raw cache while every read uses exclusions',async()=>{
  const next=fixture(),baseline=structuredClone(next);baseline.snapshots.pop();
  const bytes=JSON.stringify(next,null,2)+'\n';let calls=0;
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>{calls++;return new Response(bytes);}});
  const summaries=await Promise.all(Array.from({length:8},()=>feed.get()));
  assert.equal(calls,1);
  for(const s of summaries){assert.equal(s.totalSnapshots,1);assert.equal(s.prospectiveGames,1);assert.equal(s.settledGames,1);
    assert.equal(s.publication.journalSha256,hash(bytes));assert.equal(s.publication.lastError,null);assert.equal(s.quarantine.excludedSnapshotCount,2);}
  const snapshot=await feed.getSnapshot();assert.deepEqual(snapshot.journal,next);assert.equal(snapshot.journal.snapshots.length,3);
  snapshot.journal.snapshots[0].commenceTime='FORGED';snapshot.summary.quarantine.games[0].observedCommenceTimes.length=0;
  assert.deepEqual(feed.peekSnapshot().journal,next);assert.equal((await feed.get()).quarantine.games[0].observedCommenceTimes.length,2);
  assert.equal(calls,1);
});

test('Refresh cannot delete or rewrite a conflict to make its game eligible again',async()=>{
  for(const change of [j=>{j.snapshots.pop();},j=>{j.snapshots[2].commenceTime=firstKick;},j=>{j.settlements.shift();}]){
    const baseline=fixture(),candidate=structuredClone(baseline);change(candidate);
    assert.throws(()=>assertAppendOnlyEvidence(baseline,candidate),/HISTORY_CHANGED/);
    const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>new Response(JSON.stringify(candidate))});
    const s=await feed.get();assert.equal(s.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
    assert.equal(s.quarantine.excludedGameCount,1);assert.deepEqual(feed.peekSnapshot().journal,baseline);
  }
});

test('Reader clock rollback invalidates the full retained cache including quarantined observations',async()=>{
  let now=NOW;const feed=createJournalEvidenceFeed({fallbackJournal:fixture(),clock:()=>now,fetchImpl:null});
  assert.equal((await feed.get()).quarantine.excludedGameCount,1);
  now=Date.parse('2026-11-07T12:00:30.000Z');
  assert.equal(feed.peekSnapshot().journal,null);assert.equal(feed.peekSnapshot().summary,null);
  assert.equal(feed.peekSnapshot().publication.status,'RETAINED_EVIDENCE_NOT_YET_AVAILABLE');
  now=NOW;assert.equal((await feed.get()).quarantine.excludedGameCount,1);
});

test('Derived-market startup and refresh share the unaffected projection and explicit quarantine',async()=>{
  const next=fixture(),baseline=structuredClone(next);baseline.snapshots.pop();const before=JSON.stringify(next);
  const feed=createDerivedForwardMarketFeed({fallbackJournal:baseline,clock:()=>NOW,
    fetchImpl:async()=>new Response(JSON.stringify(next))});
  const summary=await feed.get();assert.equal(summary.available,true);assert.equal(summary.pricedGames,1);
  assert.equal(summary.snapshotMarketAvailable,1);assert.equal(summary.quarantine.excludedSnapshotCount,2);
  assert.equal(summary.prospectiveModelLeadDiagnostic.gamesWithSnapshots,1);
  assert.equal(summary.verifiedCLV,null);assert.equal(summary.realMoneyROI,null);assert.equal(summary.wageringAuthorized,false);
  const fallback=createDerivedForwardMarketFeed({fallbackJournal:next,clock:()=>NOW,fetchImpl:async()=>{throw Error('offline');}});
  const retained=await fallback.get();assert.equal(retained.pricedGames,1);assert.deepEqual(retained.quarantine,summary.quarantine);
  assert.equal(retained.refreshStatus,'REFRESH_FAILED_USING_RETAINED_EVIDENCE');assert.equal(JSON.stringify(next),before);
});

test('Derived-market cache rollback hides retained future evidence and restores safely without another fetch',async()=>{
  let now=NOW,calls=0;const j=fixture();
  const feed=createDerivedForwardMarketFeed({fallbackJournal:j,clock:()=>now,
    fetchImpl:async()=>{calls++;return new Response(JSON.stringify(j));}});
  const first=await feed.get();assert.equal(first.pricedGames,1);assert.equal(calls,1);
  now=Date.parse('2026-11-15T11:59:59.999Z');
  const hidden=await feed.get();assert.equal(hidden.available,false);assert.equal(hidden.reason,'RETAINED_EVIDENCE_READER_TIME_INVALID');
  assert.equal(hidden.preview,undefined);assert.equal(hidden.quarantine,undefined);assert.equal(calls,1);
  now=NOW;assert.deepEqual(await feed.get(),first);assert.equal(calls,1);
});

test('Pinned November 14 bundle keeps all 323 observations and 18 raw results while public projection excludes only LV-SF',()=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),bytes=readFileSync(path,'utf8'),j=JSON.parse(bytes);
  let invalid=false;assert.deepEqual(loadEvidenceJournal({read:()=>bytes,clock:()=>NOW,onInvalid:()=>{invalid=true;}}),j);assert.equal(invalid,false);
  assert.equal(j.snapshots.length,323);assert.equal(new Set(j.snapshots.map(s=>s.gameId)).size,44);assert.equal(j.settlements.length,18);
  const projection=retainedJournalProjection(j,NOW),summary=recomputeJournalEvidence(j,NOW),q=projection.quarantine;
  assert.equal(projection.journal.snapshots.length,314);assert.equal(projection.journal.settlements.length,17);
  assert.equal(summary.totalSnapshots,314);assert.equal(summary.prospectiveGames,43);assert.equal(summary.settledGames,17);
  assert.deepEqual([q.rawGameCount,q.rawSnapshotCount,q.rawResultCount,q.excludedGameCount,q.excludedSnapshotCount,q.excludedResultCount],[44,323,18,1,9,1]);
  assert.deepEqual(q.games.map(g=>g.gameId),['2026_09_LV_SF']);assertNoScoring(summary);
  const history=buildGameDossier(j,{gameId:'2026_09_LV_SF',now:NOW}).conflict.history.snapshots;
  assert.equal(history.filter(s=>s.commenceTime==='2026-11-08T21:05:00.000Z').length,7);
  assert.equal(history.filter(s=>s.commenceTime==='2026-11-08T21:25:00.000Z').length,2);
  assert.equal(summarizeEvidence(j,NOW).totalSnapshots,323);assert.equal(readFileSync(path,'utf8'),bytes);
});

test('Offline HTTP views agree on quarantine, preserve a conflict detail and never call a provider',async t=>{
  const j=fixture(),before=JSON.stringify(j);let unexpected=0;
  const forbidden=()=>{unexpected++;throw Error('External access forbidden');};
  const server=http.createServer(createHandler({clock:()=>NOW,nflEvidenceJournal:j,evidenceFeed:null,
    source:{status:()=>({configured:false}),getOdds:forbidden,getScores:forbidden},derivedShadowFeed:{get:forbidden},
    shadowStore:{capture:forbidden,status:forbidden,analysis:forbidden}}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(unexpected,0);assert.equal(JSON.stringify(j),before);});
  const get=path=>fetch('http://127.0.0.1:'+server.address().port+path);
  for(const path of ['/api/evidence/nfl','/api/research/games','/api/research/forecasts']){
    const response=await get(path);assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.quarantine.policy,POLICY);assert.equal(body.quarantine.excludedGameCount,1);
    if(body.games)assert.deepEqual(body.games.map(g=>g.gameId),[OTHER]);else assert.equal(body.totalSnapshots,1);
  }
  const good=await get('/api/research/game?gameId='+OTHER);assert.equal(good.status,200);
  for(const selector of ['gameId='+GAME,'providerEventId=synthetic-provider-0']){
    const response=await get('/api/research/game?'+selector);assert.equal(response.status,409);
    const body=await response.json();assert.equal(body.reason,'SCHEDULE_CONFLICT_QUARANTINED');
    assert.equal(body.available,false);assert.equal(body.conflict.history.total,2);
  }
  assert.equal((await get('/api/research/game?gameId=absent')).status,404);
  const health=await(await get('/api/health')).json();assert.equal(health.forwardEvidence.prospectiveGames,1);
  assert.equal(health.forwardEvidence.settledGames,1);assert.equal(health.forwardEvidence.quarantine.excludedGameCount,1);
  assert.deepEqual(health.collectionHealth.quarantine,health.forwardEvidence.quarantine);
});
