import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {createHandler} from '../src/server.mjs';
import {createJournalEvidenceFeed,assertNoFutureRecords,PUBLIC_EVIDENCE_JOURNAL_URL} from '../src/evidence-journal-feed.mjs';
import {emptyJournal} from '../src/evidence.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const realBytes=readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8');
const real=JSON.parse(realBytes),digest=raw=>createHash('sha256').update(raw).digest('hex');
async function serve(t,options){
  let paid=0;
  const forbidden=()=>{paid++;throw Error('Provider access forbidden');};
  const server=http.createServer(createHandler({source:{status:()=>({configured:false}),getOdds:forbidden,getScores:forbidden},
    clock:()=>NOW,...options}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));assert.equal(paid,0);});
  return async path=>{const response=await fetch('http://127.0.0.1:'+server.address().port+path);return {status:response.status,body:await response.json()};};
}

test('One accepted real journal aligns concurrent evidence, retained cards, result details and cached health',async t=>{
  const baseline=structuredClone(real);baseline.snapshots.pop();baseline.settlements.pop();
  let reads=0;
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async(url,options)=>{
    reads++;assert.equal(url,PUBLIC_EVIDENCE_JOURNAL_URL);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response(realBytes);
  }});
  const get=await serve(t,{nflEvidenceJournal:baseline,evidenceFeed:feed});
  const old=(await get('/api/health')).body;
  assert.equal(reads,0);assert.equal(old.forwardEvidence.settledGames,16);
  const resultId=real.settlements.at(-1).gameId;
  const [summary,index,dossier,forecasts]=await Promise.all(['/api/evidence/nfl','/api/research/games',
    '/api/research/game?gameId='+resultId,'/api/research/forecasts'].map(get));
  assert.equal(reads,1);assert.equal(summary.status,200);assert.equal(index.status,200);assert.equal(dossier.status,200);assert.equal(forecasts.status,200);
  assert.equal(summary.body.totalSnapshots,314);
  assert.equal(summary.body.quarantine.rawSnapshotCount,323);assert.equal(summary.body.quarantine.excludedSnapshotCount,9);
  assert.equal(index.body.games.reduce((n,g)=>n+g.snapshotCount,0),summary.body.totalSnapshots);
  assert.equal(index.body.total,summary.body.prospectiveGames);
  assert.equal(index.body.games.filter(g=>g.hasRecordedResult).length,summary.body.settledGames);
  assert.equal(dossier.body.result.sourceCorroborated,false);assert.equal(dossier.body.result.scoringEligible,false);
  assert.equal(dossier.body.source,'PUBLIC_RETAINED_JOURNAL');assert.equal(dossier.body.bundledLatestCaptureAt,null);
  for(const value of [summary.body,index.body,dossier.body,forecasts.body]){
    assert.equal(value.publication.journalSha256,digest(realBytes));
    assert.equal(value.publication.source,'PUBLIC_JOURNAL');
    assert.equal(value.publication.lastError,null);
  }
  assert.equal(forecasts.body.source,'PUBLIC_RETAINED_JOURNAL');
  assert.equal(forecasts.body.bundledLatestCaptureAt,null);
  assert.equal(forecasts.body.latestSnapshotAt,index.body.latestSnapshotAt);
  assert.equal(forecasts.body.generatedAt,new Date(NOW).toISOString());
  assert.equal(forecasts.body.total,index.body.total);
  for(const card of forecasts.body.games){
    const latest=real.snapshots.filter(shot=>shot.gameId===card.gameId)
      .sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.id.localeCompare(b.id)).at(-1);
    assert.equal(card.latestSnapshot.id,latest.id);
    assert.equal(card.latestSnapshot.modelHomeProbability,latest.modelHomeProbability);
    assert.equal(card.latestSnapshot.marketNewestQuoteAt,latest.marketNewestQuoteAt??null);
    assert.equal(card.latestSnapshot.marketOldestQuoteAt,latest.marketOldestQuoteAt??null);
    assert.equal(card.latestSnapshot.eligibility.market,false);
  }
  const health=(await get('/api/health')).body;
  assert.equal(reads,1);assert.equal(health.forwardEvidence.settledGames,17);
  assert.equal(health.forwardEvidence.sourceCorroboratedSettledGames,0);
  assert.equal(health.forwardEvidence.publication.journalSha256,digest(realBytes));
  assert.equal(health.collectionHealth.source,'PUBLIC_JOURNAL');assert.equal(health.collectionHealth.liveFreshnessVerified,false);
  assert.equal(health.collectionHealth.journalSha256,digest(realBytes));
  const frozen=real.snapshots.find(s=>s.id===dossier.body.firstFrozenBaseline.id);
  for(const key of ['modelBuiltAt','modelHomeProbability','commenceTime','capturedAt'])
    assert.equal(dossier.body.firstFrozenBaseline[key],frozen[key]);
  assert.equal(readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8'),realBytes);
});

test('Rejected refresh preserves the same accepted journal and digest in every view',async t=>{
  let now=NOW,candidate=structuredClone(real);
  const feed=createJournalEvidenceFeed({fallbackJournal:real,clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(candidate))});
  const get=await serve(t,{nflEvidenceJournal:real,evidenceFeed:feed,clock:()=>now});
  const first=(await get('/api/evidence/nfl')).body;
  now+=300001;candidate.snapshots[0].modelHomeProbability=.99;
  const detail=(await get('/api/research/game?gameId='+real.snapshots[0].gameId)).body;
  const summary=(await get('/api/evidence/nfl')).body,health=(await get('/api/health')).body;
  const forecasts=(await get('/api/research/forecasts')).body;
  assert.equal(detail.firstFrozenBaseline.modelHomeProbability,real.snapshots[0].modelHomeProbability);
  assert.equal(forecasts.source,detail.source);assert.equal(forecasts.generatedAt,new Date(now).toISOString());
  for(const publication of [detail.publication,summary.publication,health.forwardEvidence.publication,forecasts.publication]){
    assert.equal(publication.journalSha256,first.publication.journalSha256);
    assert.equal(publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  }
});

test('An appended result correction withdraws qualification consistently without replacing the frozen forecast',async t=>{
  let now=NOW;
  const initial={...syntheticScoringJournal(30,30),provenance:emptyJournal(2026).provenance};
  const next=structuredClone(initial);next.settlements.push({...next.settlements[0],revision:2,finalityAttestation:null});
  let candidate=initial;
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(candidate))});
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  assert.equal((await get('/api/evidence/nfl')).body.forwardMetrics.n,30);
  candidate=next;now+=300001;
  const detail=(await get('/api/research/game?gameId='+initial.snapshots[0].gameId)).body;
  assert.equal(detail.result.revision,2);assert.equal(detail.result.scoringEligible,false);
  assert.equal(detail.firstFrozenBaseline.id,initial.snapshots[0].id);
  const summary=(await get('/api/evidence/nfl')).body;
  assert.equal(summary.sourceCorroboratedSettledGames,29);assert.equal(summary.forwardMetrics,null);
  assert.equal((await get('/api/health')).body.forwardEvidence.sourceCorroboratedSettledGames,29);
});

test('Missing bundle is unavailable, but an accepted public journal can recover all routes',async t=>{
  let now=NOW,fail=true;
  const feed=createJournalEvidenceFeed({fallbackJournal:emptyJournal(2026),clock:()=>now,
    fetchImpl:async()=>fail?new Response('unavailable',{status:503}):new Response(realBytes)});
  const get=await serve(t,{nflEvidenceJournal:null,evidenceFeed:feed,clock:()=>now});
  assert.equal((await get('/api/research/games')).status,503);
  assert.equal((await get('/api/research/forecasts')).status,503);
  assert.equal((await get('/api/evidence/nfl')).status,503);
  assert.equal((await get('/api/health')).body.forwardEvidence.available,false);
  now+=300001;fail=false;
  assert.equal((await get('/api/research/games')).body.total,43);
  assert.equal((await get('/api/research/forecasts')).body.total,43);
  assert.equal((await get('/api/evidence/nfl')).body.settledGames,17);
  assert.equal((await get('/api/health')).body.forwardEvidence.available,true);
});

test('Internal snapshots are detached copies and never allow callers to change retained history',async()=>{
  const feed=createJournalEvidenceFeed({fallbackJournal:real,clock:()=>NOW,fetchImpl:null});
  const a=await feed.getSnapshot();a.journal.snapshots.length=0;a.summary.settledGames=999;a.publication.source='FORGED';
  const b=feed.peekSnapshot();assert.equal(b.journal.snapshots.length,323);assert.equal(b.summary.settledGames,17);
  assert.equal(b.publication.source,'BUNDLED_JOURNAL');
});

test('Stale bundled model readiness agrees across health, config and model routes without retraining or fetching',async t=>{
  // Derive a stale clock from bundled data, not a calendar date that later refreshes can overtake.
  const artifacts=['nfl_elo.json','nfl_efficiency.json'].map(file=>JSON.parse(readFileSync(new URL('../data/'+file,import.meta.url),'utf8')));
  const staleAt=Math.max(...artifacts.map(a=>Date.parse(a.generatedAt)))+90*86400000;
  const get=await serve(t,{clock:()=>staleAt,evidenceFeed:null,nflEvidenceJournal:null});
  const health=(await get('/api/health')).body,config=(await get('/api/config')).body;
  const elo=(await get('/api/model/nfl')).body,efficiency=(await get('/api/model/efficiency')).body;
  assert.equal(elo.available,false);assert.equal(efficiency.available,false);
  assert.equal(health.nflModel.available,elo.available);assert.equal(health.nflModel.reason,elo.reason);
  assert.equal(health.nflIntelligence.efficiencyChallengerAvailable,efficiency.available);
  assert.equal(health.nflIntelligence.efficiencyChallengerReason,efficiency.reason);
  assert.equal(config.nflResearchModel,elo.available);assert.equal(config.nflEfficiencyChallengerAvailable,efficiency.available);
  assert.equal(health.nflModel.delivery,'DEPLOYMENT_BUNDLED');
  assert.equal(health.nflModel.availabilityScope,'REFERENCE_MATCHUP_CHECK_NOT_ALL_GAMES');
});

test('Sub-minute future observations never become accepted evidence while dossiers reject them',async t=>{
  const asOf=Date.parse('2026-11-07T12:00:00.000Z');
  const initial={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};initial.settlements=[];
  const candidate=structuredClone(initial);
  candidate.snapshots.push({...candidate.snapshots[0],id:'later-future-capture',capturedAt:'2026-11-07T12:00:30.000Z'});
  let now=asOf,reads=0;
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:async()=>{reads++;return new Response(JSON.stringify(candidate));}});
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  const summary=(await get('/api/evidence/nfl')).body,index=await get('/api/research/games');
  const dossier=await get('/api/research/game?gameId='+initial.snapshots[0].gameId);
  assert.equal(index.status,200);assert.equal(dossier.status,200);
  assert.equal(summary.totalSnapshots,1);assert.equal(dossier.body.history.total,1);
  assert.equal(summary.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  assert.equal(index.body.publication.journalSha256,summary.publication.journalSha256);
  now+=300001;
  assert.equal((await get('/api/research/game?gameId='+initial.snapshots[0].gameId)).body.history.total,2);
  assert.equal((await get('/api/evidence/nfl')).body.totalSnapshots,2);assert.equal(reads,2);
});

test('Every source/model/market and settlement receipt observation obeys the same strict reader clock',async()=>{
  const future='2026-11-16T12:00:00.001Z';
  const initial={...syntheticScoringJournal(1,1),provenance:emptyJournal(2026).provenance};
  const changes=[...['sourceReceivedAt','modelBuiltAt','challengerBuiltAt','marketNewestQuoteAt','marketOldestQuoteAt'].map(key=>j=>{j.snapshots[0][key]=future;}),
    j=>{j.settlements[0].verifiedAt=future;},j=>{j.settlements[0].communitySourceVintage.collectorObservedAt=future;},
    j=>{j.settlements[0].terminalStatusReceipt.observedAt=future;},j=>{j.settlements[0].finalityAttestation.observedAt=future;}];
  for(const change of changes){
    const candidate=structuredClone(initial);change(candidate);
    assert.throws(()=>assertNoFutureRecords(candidate,NOW),/FUTURE_OR_INVALID_OBSERVATION_TIME/);
    assert.throws(()=>createJournalEvidenceFeed({fallbackJournal:candidate,clock:()=>NOW,fetchImpl:null}));
    const feed=createJournalEvidenceFeed({fallbackJournal:emptyJournal(2026),clock:()=>NOW,fetchImpl:async()=>new Response(JSON.stringify(candidate))});
    const summary=await feed.get();assert.equal(summary.totalSnapshots,0);
    assert.equal(summary.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  }
});


test('A clock rollback hides cached future observations consistently and recovers without rewriting or refetching',async t=>{
  const initial={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};initial.settlements=[];
  const asOf=Date.parse(initial.snapshots[0].capturedAt);let now=asOf,reads=0;
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:async()=>{reads++;return new Response(JSON.stringify(initial));}});
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  const accepted=(await get('/api/evidence/nfl')).body;assert.equal(accepted.totalSnapshots,1);
  now=asOf-1;
  assert.equal((await get('/api/evidence/nfl')).status,503);
  assert.equal((await get('/api/research/games')).status,503);
  assert.equal((await get('/api/research/forecasts')).status,503);
  assert.equal((await get('/api/research/game?gameId='+initial.snapshots[0].gameId)).status,503);
  const health=(await get('/api/health')).body;assert.equal(health.forwardEvidence.available,false);
  assert.equal(health.forwardEvidence.publication.lastError,'RETAINED_EVIDENCE_READER_TIME_INVALID');
  assert.equal(await feed.get(),null);
  now=asOf+1;
  const recovered=(await get('/api/evidence/nfl')).body;
  assert.equal(recovered.totalSnapshots,1);assert.equal(recovered.publication.journalSha256,accepted.publication.journalSha256);
  assert.equal((await get('/api/research/game?gameId='+initial.snapshots[0].gameId)).body.firstFrozenBaseline.id,initial.snapshots[0].id);
  const forecasts=(await get('/api/research/forecasts')).body;
  assert.equal(forecasts.publication.journalSha256,accepted.publication.journalSha256);
  assert.equal(forecasts.games[0].latestSnapshot.id,initial.snapshots[0].id);
  assert.equal(reads,1);
});

test('Malformed appended identities and result chronology cannot poison the shared retained baseline',async t=>{
  const initial={...syntheticScoringJournal(1,1),provenance:emptyJournal(2026).provenance};
  const changes=[
    j=>j.settlements.push({...j.settlements[0],gameId:'orphan-game'}),
    j=>j.snapshots.push({...j.snapshots[0],id:'zzz-conflict',home:'BUF'}),
    j=>j.snapshots.push({...j.snapshots[0],id:'zzz-provider',providerEventId:'x'.repeat(201)}),
    j=>j.settlements.push({...j.settlements[0],revision:2,verifiedAt:'2026-11-08T17:59:59.000Z'}),
    j=>j.settlements.push({...j.settlements[0],revision:2,terminalStatusReceipt:{...j.settlements[0].terminalStatusReceipt,observedAt:'2026-11-08T17:59:59.000Z'}})
  ];
  for(const change of changes){
    let now=NOW,candidate=structuredClone(initial);change(candidate);
    const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(candidate))});
    const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
    const summary=(await get('/api/evidence/nfl')).body,detail=await get('/api/research/game?gameId='+initial.snapshots[0].gameId);
    assert.equal(summary.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
    assert.equal(summary.totalSnapshots,1);assert.equal(detail.status,200);assert.equal(detail.body.history.total,1);
    assert.equal(detail.body.result.revision,1);assert.equal(detail.body.publication.journalSha256,summary.publication.journalSha256);
    assert.throws(()=>createJournalEvidenceFeed({fallbackJournal:candidate,clock:()=>now,fetchImpl:null}));
    now+=300001;candidate=initial;
    const recovered=(await get('/api/research/games')).body;
    assert.equal(recovered.total,1);assert.equal(recovered.publication.lastError,null);
  }
});

test('HTTP reader clock remains authoritative even when a supplied feed uses a different clock',async t=>{
  const initial={...syntheticScoringJournal(1,1),provenance:emptyJournal(2026).provenance};
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>NOW,fetchImpl:null});
  let now=Date.parse('2026-11-01T12:00:00.000Z');
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  const before=(await get('/api/health')).body;
  assert.equal(before.forwardEvidence.available,false);assert.equal(before.forwardEvidence.prospectiveGames,null);
  assert.equal(before.collectionHealth.lastKnownCaptureAt,null);
  assert.equal((await get('/api/evidence/nfl')).status,503);
  assert.equal((await get('/api/research/games')).status,503);
  assert.equal((await get('/api/research/forecasts')).status,503);
  now=NOW;
  assert.equal((await get('/api/health')).body.forwardEvidence.prospectiveGames,1);
  assert.equal((await get('/api/evidence/nfl')).body.prospectiveGames,1);
  assert.equal((await get('/api/research/games')).body.total,1);
  assert.equal((await get('/api/research/forecasts')).body.total,1);
});

test('Default module-level evidence cannot bypass a handler-specific clock on cached health',async t=>{
  const get=await serve(t,{clock:()=>Date.parse('2026-11-01T12:00:00.000Z')});
  const health=(await get('/api/health')).body;
  assert.equal(health.serverTime,'2026-11-01T12:00:00.000Z');
  assert.equal(health.forwardEvidence.available,false);assert.equal(health.forwardEvidence.prospectiveGames,null);
  assert.equal(health.collectionHealth.lastKnownCaptureAt,null);
});


test('Clock rollback before kickoff cannot expose legacy results that lack observed receipt times',async t=>{
  const initial={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};
  delete initial.settlements[0].verifiedAt;
  let now=NOW;
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:null});
  assert.equal(feed.peekSnapshot().summary.settledGames,1);
  now=Date.parse('2026-11-07T12:00:01.000Z');
  assert.equal(feed.peekSnapshot().summary,null);
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  assert.equal((await get('/api/evidence/nfl')).status,503);
  assert.equal((await get('/api/research/games')).status,503);
  assert.equal((await get('/api/research/forecasts')).status,503);
  assert.equal((await get('/api/health')).body.forwardEvidence.available,false);
});

test('Forecast response uses the post-read clock and the accepted full-journal publication envelope',async t=>{
  const initial={...syntheticScoringJournal(1,0),provenance:emptyJournal(2026).provenance};initial.settlements=[];
  let now=Date.parse(initial.snapshots[0].capturedAt),reads=0;
  const beforeRead=now,raw=JSON.stringify(initial);
  const feed=createJournalEvidenceFeed({fallbackJournal:initial,clock:()=>now,fetchImpl:async()=>{
    reads++;await Promise.resolve();now+=2000;return new Response(raw);
  }});
  const get=await serve(t,{nflEvidenceJournal:initial,evidenceFeed:feed,clock:()=>now});
  const forecast=await get('/api/research/forecasts');assert.equal(forecast.status,200);
  assert.notEqual(forecast.body.generatedAt,new Date(beforeRead).toISOString());
  assert.equal(forecast.body.generatedAt,new Date(now).toISOString());
  assert.equal(forecast.body.source,'PUBLIC_RETAINED_JOURNAL');
  assert.equal(forecast.body.publication.source,'PUBLIC_JOURNAL');
  assert.equal(forecast.body.publication.journalSha256,digest(raw));
  const shot=forecast.body.games[0].latestSnapshot;
  assert.equal(shot.marketOldestQuoteAt,initial.snapshots[0].marketOldestQuoteAt);
  assert.equal(shot.marketNewestQuoteAt,initial.snapshots[0].marketNewestQuoteAt);
  assert.equal(shot.eligibility.market,true);
  const detail=(await get('/api/research/game?gameId='+shot.gameId)).body;
  assert.deepEqual(shot,detail.latestSnapshot);
  const summary=(await get('/api/evidence/nfl')).body;
  assert.deepEqual(forecast.body.publication,detail.publication);
  assert.equal(summary.publication.journalSha256,forecast.body.publication.journalSha256);
  assert.equal(reads,1);
});
