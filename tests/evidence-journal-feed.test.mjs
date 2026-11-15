import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {emptyJournal,summarizeEvidence} from '../src/evidence.mjs';
import {createJournalEvidenceFeed,PUBLIC_EVIDENCE_JOURNAL_URL,assertAppendOnlyEvidence} from '../src/evidence-journal-feed.mjs';
import {createHandler} from '../src/server.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const journal=(n=1,qualified=0)=>({...syntheticScoringJournal(n,qualified),provenance:emptyJournal(2026).provenance});
const json=j=>JSON.stringify(j);
const respond=j=>new Response(json(j));
const hash=text=>createHash('sha256').update(text).digest('hex');

test('Fixed public journal refresh recomputes current scores and coalesces/caches without credentials',async()=>{
  let now=NOW,calls=0;const baseline=journal(1),next=journal(2),before=json(baseline);
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>now,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,PUBLIC_EVIDENCE_JOURNAL_URL);
    assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});
    return respond(next);
  }});
  const results=await Promise.all(Array.from({length:40},()=>feed.get()));
  assert.equal(calls,1);
  assert.ok(results.every(r=>r.prospectiveGames===2&&r.sourceCorroboratedSettledGames===0&&r.forwardMetrics===null));
  assert.equal(results[0].publication.source,'PUBLIC_JOURNAL');
  assert.equal(results[0].publication.sourcePublicationTimeVerified,false);
  assert.equal(results[0].publication.journalSha256,hash(json(next)));
  assert.equal(results[0].publication.lastSuccessfulFetchAt,new Date(now).toISOString());
  assert.equal(results[0].publication.latestSnapshotAt,next.snapshots[0].capturedAt);
  assert.equal(json(baseline),before);
  await feed.get();assert.equal(calls,1);
  now+=300001;await feed.get();assert.equal(calls,2);
});
test('Legacy published summaries are not used as evidence and cannot unlock scores',async()=>{
  const baseline=journal(1),legacy=summarizeEvidence(journal(30,30),NOW);
  delete legacy.outcomeScoringPolicy;
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(legacy)});
  const r=await feed.get();
  assert.equal(r.prospectiveGames,1);assert.equal(r.forwardMetrics,null);
  assert.equal(r.publication.source,'BUNDLED_JOURNAL');
  assert.equal(r.publication.status,'REFRESH_FAILED_USING_RETAINED_EVIDENCE');
  assert.equal(r.publication.lastSuccessfulFetchAt,null);
});
test('A fresh journal works even while its separately published summary is old',async()=>{
  const feed=createJournalEvidenceFeed({fallbackJournal:journal(29,29),clock:()=>NOW,fetchImpl:async()=>respond(journal(30,30))});
  const r=await feed.get();
  assert.equal(r.forwardMetrics.n,30);assert.equal(r.marketComparison.n,30);
  assert.equal(r.challengerForwardComparison.n,30);assert.equal(r.sourceIndependenceVerified,false);
});
const invalidCases={
  'removed frozen record':j=>j.snapshots.pop(),
  'rewritten frozen probability':j=>j.snapshots[0].modelHomeProbability=.8,
  'rewritten frozen kickoff':j=>j.snapshots[0].commenceTime='2026-11-09T18:00:00.000Z',
  'deleted settlement':j=>j.settlements.pop(),
  'rewritten settlement':j=>{j.settlements[0].homeScore=28;},
  'reordered settlement history':j=>j.settlements.reverse(),
  'replaced source provenance':j=>j.provenance.results='OTHER_SOURCE',
  'wrong season':j=>j.season=2027,
  'raw odds':j=>j.snapshots[0].americanOdds=-110,
  'nested source credential':j=>j.provenance.secret='SYNTHETIC_NOT_A_SECRET',
  'unknown provenance property':j=>j.provenance.extra='unreviewed',
  'nested raw market data':j=>j.snapshots[0].nested=[{bookmakers:[]}],
  'nonresearch capture':j=>j.snapshots[0].researchOnly=false,
  'summary metric injection':j=>{delete j.snapshots;j.forwardMetrics={n:30,brier:.001};},
  'contradictory appended revision':j=>j.settlements.push({...j.settlements[0],homeScore:29})
};
for(const [name,change] of Object.entries(invalidCases))test('Refresh rejects '+name+' while retaining safe results',async()=>{
  const baseline=journal(2),candidate=structuredClone(baseline);change(candidate);
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(candidate)});
  const r=await feed.get();
  assert.equal(r.totalSnapshots,2);assert.equal(r.settledGames,2);assert.equal(r.sourceCorroboratedSettledGames,0);
  assert.equal(r.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
});
test('Escaped JSON forbidden keys cannot bypass decoded private-data rejection',async()=>{
  const baseline=journal(),raw=json(baseline).replace('"snapshots":', '"bookmaker\\u0073":[],"snapshots":');
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>new Response(raw)});
  assert.equal((await feed.get()).publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
});
test('Malformed/oversize/HTTP/transport failures make one bounded attempt and retain baseline',async()=>{
  for(const fetchImpl of [async()=>new Response('{'),async()=>new Response('x',{headers:{'Content-Length':'5000001'}}),
    async()=>new Response('unavailable',{status:503}),async()=>{throw Error('private-provider-error-body');}]){
    let calls=0;const feed=createJournalEvidenceFeed({fallbackJournal:journal(),clock:()=>NOW,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
    const out=await feed.get();await feed.get();
    assert.equal(calls,1);assert.equal(out.prospectiveGames,1);
    assert.equal(out.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
    assert.ok(!json(out).includes('private-provider-error-body'));
  }
});
test('Last accepted journal prevents subsequent rollback and reports retained vintage honestly',async()=>{
  let now=NOW,calls=0;
  const feed=createJournalEvidenceFeed({fallbackJournal:journal(1),clock:()=>now,fetchImpl:async()=>respond(++calls===1?journal(2):journal(1))});
  const first=await feed.get();now+=300001;const second=await feed.get();
  assert.equal(second.prospectiveGames,2);
  assert.equal(second.generatedAt,first.generatedAt);
  assert.equal(second.publication.lastSuccessfulFetchAt,first.publication.lastSuccessfulFetchAt);
  assert.notEqual(second.publication.lastAttemptAt,first.publication.lastAttemptAt);
  assert.equal(second.publication.status,'REFRESH_FAILED_USING_RETAINED_EVIDENCE');
  assert.equal(second.publication.source,'PUBLIC_JOURNAL');
});
test('Snapshot sorting is allowed; settlement multiplicity cannot be removed',()=>{
  const baseline=journal(2),candidate=structuredClone(baseline);candidate.snapshots.reverse();
  assertAppendOnlyEvidence(baseline,candidate);
  baseline.settlements.push(structuredClone(baseline.settlements[0]));
  assert.throws(()=>assertAppendOnlyEvidence(baseline,candidate),/HISTORY_CHANGED/);
});
test('A later unqualified correction preserves history but withdraws scores',async()=>{
  const baseline=journal(30,30),next=structuredClone(baseline);
  next.settlements.push({...next.settlements[0],revision:2,finalityAttestation:null});
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(next)});
  const out=await feed.get();
  assert.equal(out.settledGames,30);assert.equal(out.sourceCorroboratedSettledGames,29);
  assert.equal(out.forwardMetrics,null);assert.equal(out.publication.lastError,null);
});
test('Returned data and caller fallback cannot mutate internal safety baseline',async()=>{
  const baseline=journal();
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(journal())});
  baseline.snapshots[0].modelHomeProbability=.99;
  const out=await feed.get();out.recentResults[0].brier=.001;out.sourceCorroboratedSettledGames=99;
  const again=await feed.get();
  assert.equal(again.recentResults[0].brier,null);assert.equal(again.sourceCorroboratedSettledGames,0);
  assert.equal(again.publication.lastError,null);
});
test('Invalid or private bundled fallback is rejected before any fetch',()=>{
  const bad=journal();bad.snapshots[0].nested={API_KEY:'SYNTHETIC_NOT_A_SECRET'};
  let calls=0;
  assert.throws(()=>createJournalEvidenceFeed({fallbackJournal:bad,fetchImpl:()=>calls++}),/PRIVATE_OR_RAW_DATA/);
  assert.equal(calls,0);
});
test('Actual checked-in journal is read and recomputed without changing it or the stored summary',async()=>{
  const paths=['nfl-2026.json','summary.json'].map(p=>new URL('../data/evidence/'+p,import.meta.url));
  const before=await Promise.all(paths.map(p=>readFile(p,'utf8'))),real=JSON.parse(before[0]);
  const baseline=emptyJournal(2026);
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>new Response(before[0])});
  const out=await feed.get();
  assert.equal(out.totalSnapshots,real.snapshots.length);assert.equal(out.sourceCorroboratedSettledGames,0);
  assert.equal(out.publication.source,'PUBLIC_JOURNAL');assert.equal(out.publication.journalSha256,hash(before[0]));
  assert.deepEqual(await Promise.all(paths.map(p=>readFile(p,'utf8'))),before);
});
test('Read-only evidence API serves updated journal counts without any paid source access',async(t)=>{
  let paid=0,reads=0;
  const source={status:()=>({configured:false}),getOdds:async()=>{paid++;},getScores:async()=>{paid++;}};
  const evidenceFeed=createJournalEvidenceFeed({fallbackJournal:journal(),clock:()=>NOW,fetchImpl:async()=>{reads++;return respond(journal(2));}});
  const server=http.createServer(createHandler({source,evidenceFeed,clock:()=>NOW}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const result=await fetch(base+'/api/evidence/nfl');assert.equal(result.status,200);
  assert.equal((await result.json()).prospectiveGames,2);assert.equal(reads,1);assert.equal(paid,0);
  assert.equal((await fetch(base+'/api/evidence/nfl',{method:'POST'})).status,405);assert.equal(reads,1);
});
test('An appended backdated forecast cannot replace frozen model or challenger baselines',async()=>{
  for(const alteration of ['baseline','challenger','equal-time-ID']){
    const baseline=journal(30,30),candidate=structuredClone(baseline);
    const extra={...candidate.snapshots[0],id:'backdated',modelHomeProbability:.99};
    if(alteration==='baseline')extra.capturedAt='2026-11-07T11:59:58.000Z';
    if(alteration==='challenger'){
      baseline.snapshots[0].challengerHomeProbability=null;
      candidate.snapshots[0].challengerHomeProbability=null;
      const later={...candidate.snapshots[0],id:'later-challenger',capturedAt:'2026-11-07T12:10:00.000Z',sourceReceivedAt:'2026-11-07T12:09:59.000Z',marketNewestQuoteAt:'2026-11-07T12:09:58.000Z',challengerHomeProbability:.65};
      baseline.snapshots.push(later);candidate.snapshots.push(structuredClone(later));
      extra.capturedAt='2026-11-07T12:05:00.000Z';
    }
    if(alteration==='equal-time-ID')extra.id='aaa-preempts-first';
    candidate.snapshots.push(extra);
    const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(candidate)});
    const out=await feed.get();
    assert.equal(out.totalSnapshots,baseline.snapshots.length);
    assert.equal(out.forwardMetrics.brier,.16);
    assert.equal(out.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  }
});
test('An equal-time later ID or later timestamp may extend the journal without changing first forecast',async()=>{
  for(const [id,capturedAt] of [['zzz-later-ID','2026-11-07T12:00:00.000Z'],['aaa-later-time','2026-11-07T12:01:00.000Z']]){
    const baseline=journal(30,30),candidate=structuredClone(baseline);
    candidate.snapshots.push({...candidate.snapshots[0],id,capturedAt,modelHomeProbability:.99});
    const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(candidate)});
    const out=await feed.get();assert.equal(out.totalSnapshots,31);
    assert.equal(out.forwardMetrics.brier,.16);assert.equal(out.publication.lastError,null);
  }
});
test('Future captures and future reconciliation cannot unlock current evidence',async()=>{
  for(const now of [Date.parse('2026-11-05T12:00:00Z'),Date.parse('2026-11-14T12:00:00Z')]){
    const feed=createJournalEvidenceFeed({fallbackJournal:emptyJournal(2026),clock:()=>now,fetchImpl:async()=>respond(journal(30,30))});
    const out=await feed.get();assert.equal(out.totalSnapshots,0);assert.equal(out.forwardMetrics,null);
    assert.equal(out.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  }
  assert.throws(()=>createJournalEvidenceFeed({fallbackJournal:journal(30,30),clock:()=>Date.parse('2026-11-05T12:00:00Z')}),/FUTURE/);
});
test('Server startup uses the same strict boundary and falls back safely for invalid bundled data',async()=>{
  const {loadEvidenceJournal}=await import('../src/server.mjs');
  for(const change of [j=>j.provenance.extra='unexpected',j=>j.snapshots[0].nested={token:'SYNTHETIC'},
    j=>j.snapshots[0].capturedAt='2099-01-01T00:00:00Z']){
    const invalid=journal();change(invalid);
    const fallback=loadEvidenceJournal({read:()=>json(invalid),clock:()=>NOW});
    assert.deepEqual(fallback,emptyJournal(2026));
    const feed=createJournalEvidenceFeed({fallbackJournal:fallback,clock:()=>NOW,fetchImpl:async()=>{throw Error('offline');}});
    assert.equal((await feed.get()).totalSnapshots,0);
  }
  const good=journal();
  assert.deepEqual(loadEvidenceJournal({read:()=>json(good),clock:()=>NOW}),good);
});
test('Alternative timestamp spellings cannot reorder the frozen first forecast',async()=>{
  for(const capturedAt of ['2026-11-07T11:00:00.000-01:00','2026-11-07T12:00:00Z',
    '2026-11-7 12:00:00Z','2026-11-07 12:00:00.000Z']){
    const baseline=journal(30,30),candidate=structuredClone(baseline);
    candidate.snapshots.push({...candidate.snapshots[0],id:'zzz-retrofit',capturedAt,modelHomeProbability:.99});
    const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(candidate)});
    const out=await feed.get();assert.equal(out.totalSnapshots,30);assert.equal(out.forwardMetrics.brier,.16);
    assert.equal(out.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
  }
});
test('Equal-time IDs cannot preempt either raw or locale-based forecast selection',async()=>{
  const baseline=journal(30,30),candidate=structuredClone(baseline);
  candidate.snapshots.push({...candidate.snapshots[0],id:'é-retrofit',challengerHomeProbability:.99});
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>NOW,fetchImpl:async()=>respond(candidate)});
  const out=await feed.get();
  assert.equal(out.totalSnapshots,30);assert.equal(out.challengerForwardComparison.challengerBrier,.1225);
  assert.equal(out.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
});
