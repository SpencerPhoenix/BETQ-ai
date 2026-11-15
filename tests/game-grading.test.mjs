import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {createJournalEvidenceFeed,PUBLIC_EVIDENCE_JOURNAL_URL} from '../src/evidence-journal-feed.mjs';
import {emptyJournal} from '../src/evidence.mjs';
import {createHandler} from '../src/server.mjs';
import {isSourceCorroboratedSettlement,unambiguousFrozenGameIds} from '../src/settlement-qualification.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const now=Date.parse('2026-11-16T12:00:00Z');
const fixture=(n=1,q=n)=>({...syntheticScoringJournal(n,q),provenance:emptyJournal(2026).provenance});
test('each retained result gets a truthful grade or missing-evidence status',()=>{
 const j=fixture(3,2);j.settlements.pop();const before=JSON.stringify(j),v=gradeRetainedGames(j,{now});
 assert.equal(v.available,true);assert.equal(v.games.length,3);assert.deepEqual(v.games.map(g=>g.status),['GRADED','GRADED','PENDING_RESULT']);
 assert.ok(Math.abs(v.games[0].metrics.modelBrier-.16)<1e-12);assert.ok(Math.abs(v.games[0].metrics.modelLogLoss+Math.log(.6))<1e-12);
 assert.ok(Math.abs(v.games[0].metrics.brierImprovement-.0425)<1e-12);assert.equal(v.games[0].metrics.modelCorrect,true);
 assert.equal(JSON.stringify(j),before);v.games[0].result.homeScore=999;assert.equal(JSON.stringify(j),before);
});
test('no provenance upgrade, later prediction substitution, or correction cherry-pick',()=>{
 const j=fixture();delete j.snapshots[0].modelLastResultDate;
 j.snapshots.push({...j.snapshots[0],id:'later',capturedAt:'2026-11-07T12:01:00.000Z',modelLastResultDate:'2026-11-06'});
 let g=gradeRetainedGames(j,{now}).games[0];assert.equal(g.status,'UNGRADED');assert.equal(g.metrics,null);assert.equal(g.baselineSnapshotId,'fixture-0');
 const corrected=fixture();corrected.settlements.unshift({...corrected.settlements[0],revision:2,finalityAttestation:null});
 g=gradeRetainedGames(corrected,{now}).games[0];assert.equal(g.result.revision,2);assert.equal(g.metrics,null);
});
test('missing market evidence does not remove model grade or invent market score',()=>{
 const j=fixture();delete j.snapshots[0].marketOldestQuoteAt;const g=gradeRetainedGames(j,{now}).games[0];
 assert.equal(g.status,'GRADED');assert.equal(g.metrics.marketBrier,null);assert.equal(g.metrics.brierImprovement,null);
 assert.ok(g.reasons.includes('MISSING_REQUIRED_MARKET_PROVENANCE'));
});
test('ties and uncorroborated scores remain ungraded, 50/50 is not a picked winner',()=>{
 const j=fixture();const r=j.settlements[0];r.awayScore=27;r.outcome='TIE';
 for(const k of ['terminalStatusReceipt','communitySourceVintage','finalityAttestation'])r[k].awayScore=27;
 assert.equal(gradeRetainedGames(j,{now}).games[0].status,'TIE_EXCLUDED');assert.equal(gradeRetainedGames(j,{now}).games[0].metrics,null);
 const u=gradeRetainedGames(fixture(1,0),{now}).games[0];assert.equal(u.status,'UNGRADED');assert.equal(u.metrics,null);
 const even=fixture();even.snapshots[0].modelHomeProbability=.5;assert.equal(gradeRetainedGames(even,{now}).games[0].metrics.modelCorrect,null);
});
test('pinned ledger includes quarantined history without scoring or rewriting it',()=>{
 const raw=readFileSync(new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),'utf8'),j=JSON.parse(raw),before=JSON.stringify(j);
 const v=gradeRetainedGames(j,{now});assert.equal(v.available,true);assert.equal(v.games.length,new Set(j.snapshots.map(s=>s.gameId)).size);
 assert.equal(v.coverage.gradedGames,0);assert.equal(v.coverage.leagueWideCompletenessVerified,false);
 assert.ok(v.games.some(g=>g.status==='SCHEDULE_CONFLICT_QUARANTINED'));assert.equal(JSON.stringify(j),before);
});
test('invalid and future evidence fails closed',()=>{
 const j=fixture();j.snapshots[0].capturedAt='2099-01-01T00:00:00.000Z';assert.equal(gradeRetainedGames(j,{now}).available,false);
 assert.equal(gradeRetainedGames(null,{now}).reason,'INVALID_RETAINED_JOURNAL');
});
test('grading API is read-only and rejects query and write attempts before refreshing',async t=>{
 let calls=0,reads=0;const forbidden=()=>{calls++;throw Error('external access');};
 const server=http.createServer(createHandler({clock:()=>now,nflEvidenceJournal:fixture(),evidenceFeed:{getSnapshot:async()=>{reads++;}},source:{getOdds:forbidden,getScores:forbidden}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/api/research/grades';
 const r=await fetch(url);assert.equal(r.status,200);assert.equal((await r.json()).games[0].status,'GRADED');
 assert.equal(reads,1);assert.equal((await fetch(url+'?refresh=true')).status,400);assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal(calls,0);assert.equal(reads,1);
});

for (const mode of ['valid','invalid','failed']) test('grading and game APIs share concurrent journal refresh: '+mode,{timeout:5000},async t=>{
 let calls=0,providerCalls=0,release,started,joined;
 const bothJoined=new Promise(resolve=>{joined=resolve;});
 const gate=new Promise(resolve=>{release=resolve;}),begun=new Promise(resolve=>{started=resolve;});
 const baseline=fixture(1,0),next=fixture(2,0),before=JSON.stringify(baseline);
 if(mode==='invalid')next.snapshots[0].modelHomeProbability=.9;
 const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>now,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,PUBLIC_EVIDENCE_JOURNAL_URL);assert.equal(options.credentials,'omit');started();await gate;
  if(mode==='failed')throw Error('offline');return new Response(JSON.stringify(next));
 }});
 const getSnapshot=feed.getSnapshot;let snapshotReads=0;
 feed.getSnapshot=()=>{if(++snapshotReads===2)joined();return getSnapshot();};
 const forbidden=()=>{providerCalls++;throw Error('provider forbidden');};
 const server=http.createServer(createHandler({clock:()=>now,nflEvidenceJournal:baseline,evidenceFeed:feed,source:{getOdds:forbidden,getScores:forbidden}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port;
 // Start grades first: a cache-only grade handler would return the old one-game view.
 const grades=fetch(url+'/api/research/grades');await begun;
 const games=fetch(url+'/api/research/games');await bothJoined;release();
 const [gr,ga]=await Promise.all([grades,games]);assert.equal(gr.status,200);assert.equal(ga.status,200);
 const [gradeBody,gameBody]=await Promise.all([gr.json(),ga.json()]);
 const count=mode==='valid'?2:1;assert.equal(gradeBody.games.length,count);assert.equal(gameBody.games.length,count);
 assert.equal((await (await fetch(url+'/api/research/grades')).json()).games.length,count);
 assert.equal(calls,1);assert.equal(providerCalls,0);assert.equal(JSON.stringify(baseline),before);
});

test('matching final receipts do not silently resolve a retained kickoff revision',()=>{
 for(const receiptKickoff of ['2026-11-08T18:00:00.000Z','2026-11-08T18:20:00.000Z']){
  // Synthetic evidence only: both stable identities and provider IDs match.
  const j=fixture(2,2),first=j.snapshots[0],later={...first,id:'fixture-0-later',
   commenceTime:'2026-11-08T18:20:00.000Z',capturedAt:'2026-11-07T12:01:00.000Z'};
  j.snapshots.push(later);
  const result=j.settlements[0];
  for(const record of [result,result.communitySourceVintage,result.terminalStatusReceipt,result.finalityAttestation])record.commenceTime=receiptKickoff;
  const matching=receiptKickoff===first.commenceTime?first:later;
  assert.equal(isSourceCorroboratedSettlement(result,matching),true);
  assert.equal(unambiguousFrozenGameIds(j.snapshots).has(first.gameId),false);
  const before=JSON.stringify(j),view=gradeRetainedGames(j,{now});
  assert.equal(view.available,true);assert.equal(view.coverage.trackedGames,2);assert.equal(view.coverage.gradedGames,1);
  const conflicted=view.games.find(g=>g.gameId===first.gameId);
  assert.equal(conflicted.status,'SCHEDULE_CONFLICT_QUARANTINED');assert.equal(conflicted.metrics,null);
  assert.equal(conflicted.baselineSnapshotId,first.id);assert.equal(conflicted.hasRecordedResult,true);
  assert.equal(view.games.find(g=>g.gameId!==first.gameId).status,'GRADED');
  assert.equal(JSON.stringify(j),before);
 }
});
