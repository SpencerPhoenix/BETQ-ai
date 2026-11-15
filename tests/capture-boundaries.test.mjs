import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nflMoneylineConsensus} from '../src/market-consensus.mjs';
import {emptyJournal,observationsFromSlate,prepareCaptureAdmission,updateJournal,summarizeEvidence,validateJournal} from '../src/evidence.mjs';
import {MARKET_FRESHNESS_POLICY,isEligibleModelSnapshot,isEligibleMarketSnapshot,validMarketQuoteWindow} from '../src/evidence-integrity.mjs';
import {createJournalEvidenceFeed,assertAppendOnlyEvidence,validateRetainedJournal} from '../src/evidence-journal-feed.mjs';
import {buildGameDossier} from '../src/game-dossier.mjs';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {summarizeProspectiveDirection} from '../src/prospective-direction.mjs';
import {summarizeDerivedForwardMarkets,createDerivedForwardMarketFeed} from '../src/shadow-derived.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';

// Synthetic regression inputs only. No provider calls or evidence-file writes.
const ANALYSIS=Date.parse('2026-11-07T12:00:00.000Z');
const READ=Date.parse('2026-11-16T12:00:00.000Z');
const iso=x=>new Date(x).toISOString();
function input(oldest=ANALYSIS-599000){
  const event={id:'synthetic-provider',commence_time:iso(ANALYSIS+86400000),
    home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    bookmakers:[0,1,2].map(i=>({key:'synthetic-book-'+i,markets:[{key:'h2h',
      last_update:iso(i===0?oldest:ANALYSIS-10000),outcomes:[
        {name:'Kansas City Chiefs',price:-110},{name:'Las Vegas Raiders',price:100}]}]}))};
  const consensus=nflMoneylineConsensus(event,{asOf:ANALYSIS});
  const slate={demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',market:'h2h',
    receivedAt:iso(ANALYSIS),events:[{id:event.id,homeTeam:event.home_team,awayTeam:event.away_team,
      commenceTime:event.commence_time,independentModel:{available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',
        independentOfOdds:true,use:'RESEARCH_ONLY',homeWinProbability:.51,modelBuiltAt:iso(ANALYSIS-3600000),
        modelVersion:'synthetic-elo',throughGameDate:'2026-11-05'},marketConsensus:consensus}]};
  const rows=[{game_id:'2026_09_LV_KC',season:2026,game_type:'REG',gameday:'2026-11-08',home_team:'KC',away_team:'LV'}];
  return {event,consensus,slate,rows};
}
function capture(f,now=ANALYSIS){return observationsFromSlate(f.slate,f.rows,now,2026).accepted[0];}
function journal(n=2,qualified=0){return {...syntheticScoringJournal(n,qualified),provenance:emptyJournal(2026).provenance};}
function later(s,extra={}){return {...s,id:s.id+'-later',capturedAt:iso(ANALYSIS+3600000),
  sourceReceivedAt:iso(ANALYSIS+3599000),marketOldestQuoteAt:iso(ANALYSIS+3598000),
  marketNewestQuoteAt:iso(ANALYSIS+3598000),...extra};}

test('Exact delayed-collector reproduction: 599s at analysis is 609s at capture and cannot retain a market pair',()=>{
  const f=input(),before=structuredClone(f),s=capture(f,ANALYSIS+10000);
  assert.equal(f.consensus.oldestQuoteAgeSeconds,599);
  assert.equal(f.consensus.oldestQuoteAt,iso(ANALYSIS-599000));
  assert.equal(f.consensus.latestQuoteAt,iso(ANALYSIS-10000));
  assert.equal(isEligibleModelSnapshot(s),true);
  assert.equal(s.marketHomeProbability,null);assert.equal(s.marketOldestQuoteAt,null);
  assert.equal(s.marketBookCount,0);assert.equal(isEligibleMarketSnapshot(s),false);
  assert.deepEqual(f,before);
});

test('Capture boundary uses exact milliseconds, ignores relative-age rounding and retains absolute bounds',()=>{
  for(const [delay,eligible] of [[1000,true],[1001,false]]){
    const f=input();f.consensus.oldestQuoteAgeSeconds=0; // Deliberately misleading analysis-age field.
    const s=capture(f,ANALYSIS+delay);
    assert.equal(isEligibleMarketSnapshot(s),eligible);
    assert.equal(s.marketHomeProbability,eligible?.511628:null);
    if(eligible){assert.equal(s.marketOldestQuoteAt,f.consensus.oldestQuoteAt);assert.equal(s.marketNewestQuoteAt,f.consensus.latestQuoteAt);}
  }
  const f=input();delete f.consensus.oldestQuoteAgeSeconds;
  assert.equal(isEligibleMarketSnapshot(capture(f)),true,'Relative age is not the retained proof');
});

for(const [label,change] of Object.entries({
  missing:f=>delete f.consensus.oldestQuoteAt,
  null:f=>f.consensus.oldestQuoteAt=null,
  noncanonical:f=>f.consensus.oldestQuoteAt='2026-11-07T11:50:01Z',
  oldestAfterNewest:f=>f.consensus.oldestQuoteAt=iso(ANALYSIS-9999),
  newestAfterReceipt:f=>f.consensus.latestQuoteAt=iso(ANALYSIS+1),
  receiptAfterCapture:f=>f.slate.receivedAt=iso(ANALYSIS+1),
  fractionalBookCount:f=>f.consensus.books=3.1
}))test('New captures retain model only when oldest-quote proof is '+label,()=>{
  const f=input();change(f);const s=capture(f);
  assert.ok(s);assert.equal(isEligibleModelSnapshot(s),true);
  assert.equal(s.marketHomeProbability,null);assert.equal(s.marketOldestQuoteAt,null);
  assert.equal(isEligibleMarketSnapshot(s),false);
});

test('Legacy market value stays visible but never acquires invented oldest-quote proof in any reader',()=>{
  const j=journal(1,1),s=j.snapshots[0];delete s.marketOldestQuoteAt;
  const before=JSON.stringify(j),summary=summarizeEvidence(j,READ);
  assert.equal(validateJournal(j),j);validateRetainedJournal(j,READ);
  assert.equal(isEligibleModelSnapshot(s),true);assert.equal(isEligibleMarketSnapshot(s),false);
  assert.equal(summary.marketFreshnessPolicy,MARKET_FRESHNESS_POLICY);
  assert.equal(summary.legacyMarketSnapshotsWithoutOldestQuoteTime,1);
  assert.equal(summary.sourceCorroboratedSettledGames,1);assert.equal(summary.pairedMarketGames,1);
  assert.equal(summary.sourceCorroboratedMarketGames,0);assert.equal(summary.marketComparison,null);
  assert.equal(calculateSequentialEvidence(j).firstQualifyingPregameGames,0);
  assert.equal(summarizeDerivedForwardMarkets(j).pricedGames,0);
  assert.equal(summarizeProspectiveDirection(j).candidateMarketMovements,0);
  const dossier=buildGameDossier(j,{gameId:s.gameId,now:READ});
  assert.equal(dossier.available,true);assert.equal(dossier.latestSnapshot.marketHomeProbability,.55);
  assert.equal(dossier.latestSnapshot.marketOldestQuoteAt,null);
  assert.equal(dossier.latestSnapshot.eligibility.market,false);
  assert.ok(dossier.latestSnapshot.missingness.includes('marketOldestQuoteAt'));
  assert.equal(JSON.stringify(j),before);
});

test('Shared oldest-quote check rejects old constituent while newest and model remain valid',()=>{
  const j=journal(1,1),s=j.snapshots[0];s.marketOldestQuoteAt=iso(ANALYSIS-600001);
  assert.equal(validMarketQuoteWindow(s),false);assert.equal(isEligibleModelSnapshot(s),true);
  assert.equal(isEligibleMarketSnapshot(s),false);
  assert.equal(summarizeEvidence(j,READ).sourceCorroboratedMarketGames,0);
  assert.equal(calculateSequentialEvidence(j).firstQualifyingPregameGames,0);
  assert.equal(summarizeDerivedForwardMarkets(j).pricedGames,0);
});

for(const value of [undefined,null,'',12,{},' provider','provider ','x\n','x'.repeat(201)])
  test('Source event identity must be a bounded, nonblank, opaque string: '+JSON.stringify(value),()=>{
    const f=input();f.slate.events[0].id=value;
    const out=observationsFromSlate(f.slate,f.rows,ANALYSIS,2026);
    assert.deepEqual(out.accepted,[]);assert.deepEqual(out.skipped,[{eventId:'',reason:'INVALID_PROVIDER_EVENT_ID'}]);
  });

test('Opaque provider identity with a valid 200-character bound is preserved exactly',()=>{
  const f=input();f.slate.events[0].id='P'.repeat(200);
  assert.equal(capture(f).providerEventId,f.slate.events[0].id);
});

for(const sameId of [false,true])test('Changed provider identity is quarantined before '+(sameId?'daily-ID deduplication':'new capture admission'),()=>{
  const j=journal(),before=structuredClone(j),s=j.snapshots[0];
  const bad=later(s,{id:sameId?s.id:s.id+'-changed',providerEventId:'replacement-provider'}),good=later(j.snapshots[1]);
  const out=prepareCaptureAdmission(j,[bad,good],READ);
  assert.deepEqual(out.accepted,[good]);assert.deepEqual(out.skipped[0].reasons,['PROVIDER_EVENT_ID_CHANGED']);
  assert.equal(out.diagnostics.reasonCounts.PROVIDER_EVENT_ID_CHANGED,1);
  assert.equal(out.diagnostics.policy,'FROZEN_CAPTURE_IDENTITY_V2');
  const written=updateJournal(j,out.accepted,[],READ);assert.equal(written.added,1);
  assert.deepEqual(j,before);assert.deepEqual(written.journal.snapshots.find(x=>x.id===s.id),s);
  if(!sameId)assert.throws(()=>updateJournal(j,[bad],[],READ),/Provider event identity/);
});

test('Changed-ID whole-game quarantine is order independent, including an otherwise routine same-ID capture',()=>{
  const j=journal(),s=j.snapshots[0],repeat=later(s,{id:s.id}),bad=later(s,{providerEventId:'replacement'}),good=later(j.snapshots[1]);
  for(const captures of [[repeat,bad,good],[bad,good,repeat],[good,repeat,bad]]){
    const out=prepareCaptureAdmission(j,captures,READ);
    assert.deepEqual(out.accepted,[good]);assert.equal(out.diagnostics.quarantinedCaptures,2);
    assert.equal(out.diagnostics.reasonCounts.PROVIDER_EVENT_ID_CHANGED,2);
    assert.equal(out.diagnostics.routineDuplicateCaptures,0);
  }
});

test('Reusing one provider ID for different new games quarantines both in either order',()=>{
  const j=journal(),a=later(j.snapshots[0]),b=later(j.snapshots[1],{providerEventId:a.providerEventId});
  for(const captures of [[a,b],[b,a]]){
    const out=prepareCaptureAdmission(emptyJournal(2026),captures,READ);
    assert.deepEqual(out.accepted,[]);assert.equal(out.diagnostics.reasonCounts.PROVIDER_EVENT_ID_REUSED,2);
    assert.throws(()=>updateJournal(emptyJournal(2026),captures,[],READ),/Provider event identity/);
  }
});

test('Reusing a retained provider ID also quarantines recaptures of its original game',()=>{
  const j=journal(),a=later(j.snapshots[0]),b=later(j.snapshots[1],{providerEventId:a.providerEventId});
  const out=prepareCaptureAdmission(j,[a,b],READ);
  assert.deepEqual(out.accepted,[]);assert.equal(out.diagnostics.reasonCounts.PROVIDER_EVENT_ID_REUSED,2);
  assert.equal(out.diagnostics.reasonCounts.PROVIDER_EVENT_ID_CHANGED,1);
});

for(const legacy of [true,false])test('Missing '+(legacy?'retained':'incoming')+' provider identity cannot be inferred from the other observation',()=>{
  const j=journal(),s=j.snapshots[0],a=later(s),good=later(j.snapshots[1]);
  if(legacy)delete s.providerEventId;else delete a.providerEventId;
  const before=structuredClone(j),out=prepareCaptureAdmission(j,[a,good],READ);
  assert.deepEqual(out.accepted,[good]);assert.deepEqual(out.skipped[0].reasons,['PROVIDER_EVENT_ID_UNVERIFIED']);
  assert.throws(()=>updateJournal(j,[a],[],READ),/Provider event identity/);
  validateRetainedJournal(j,READ);assert.deepEqual(j,before);
});

test('Append-only public reader rejects changed or reused provider additions, preserving accepted digest and recovery',async()=>{
  for(const reused of [false,true]){
    const baseline=journal(),candidate=structuredClone(baseline);
    candidate.snapshots.push(later(baseline.snapshots[0],{providerEventId:reused?baseline.snapshots[1].providerEventId:'replacement'}));
    assert.throws(()=>assertAppendOnlyEvidence(baseline,candidate),/PROVIDER_EVENT_ID_CONTINUITY_REQUIRED/);
    let now=READ;
    const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>now,
      fetchImpl:async()=>new Response(JSON.stringify(candidate))});
    const initial=feed.peekSnapshot();
    const rejected=await feed.getSnapshot();
    assert.deepEqual(rejected.journal,baseline);assert.equal(rejected.publication.journalSha256,initial.publication.journalSha256);
    assert.equal(rejected.publication.lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
    candidate.snapshots[candidate.snapshots.length-1]=later(baseline.snapshots[0]);now+=300001;
    const recovered=await feed.getSnapshot();assert.equal(recovered.publication.lastError,null);
    assert.equal(recovered.journal.snapshots.length,baseline.snapshots.length+1);
  }
});

test('Legacy missing provider identity remains readable, but a new same-game public append fails closed',()=>{
  const previous=journal(),candidate=structuredClone(previous);delete previous.snapshots[0].providerEventId;
  candidate.snapshots=structuredClone(previous.snapshots);candidate.snapshots.push(later(journal().snapshots[0]));
  validateRetainedJournal(previous,READ);
  assert.throws(()=>assertAppendOnlyEvidence(previous,candidate),/PROVIDER_EVENT_ID_CONTINUITY_REQUIRED/);
  candidate.snapshots.pop();candidate.snapshots.push(later(previous.snapshots[1]));
  assert.equal(assertAppendOnlyEvidence(previous,candidate),candidate);
});

test('Direct writer rejects malformed capture containers and null records before identity checks',()=>{
  for(const captures of [null,{},[null],[{}]])assert.throws(()=>updateJournal(emptyJournal(2026),captures,[],READ),/Invalid/);
});

test('Exact retained-journal provider drift reproduction is rejected without changing any historical bytes',()=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),bytes=readFileSync(path,'utf8');
  const j=JSON.parse(bytes),before=JSON.stringify(j),s=j.snapshots.at(-1);
  const now=Math.max(...j.snapshots.map(s=>Date.parse(s.capturedAt)),...j.settlements.map(r=>Date.parse(r.verifiedAt)))+60000;
  const fake={...s,id:s.id+'-synthetic-provider-change',capturedAt:iso(now),sourceReceivedAt:iso(now-1000),
    marketNewestQuoteAt:iso(now-2000),providerEventId:'replacement-synthetic-event-id'};
  const out=prepareCaptureAdmission(j,[fake],now);
  assert.deepEqual(out.accepted,[]);assert.equal(out.diagnostics.quarantinedCaptures,1);
  assert.deepEqual(out.skipped[0].reasons,['PROVIDER_EVENT_ID_CHANGED']);
  assert.equal(JSON.stringify(j),before);assert.equal(readFileSync(path,'utf8'),bytes);
  const summary=summarizeEvidence(j,READ);
  assert.equal(summary.totalSnapshots,323);assert.equal(summary.prospectiveGames,44);
  assert.equal(summary.settledGames,18);assert.equal(summary.sourceCorroboratedSettledGames,0);
  assert.equal(summary.legacyMarketSnapshotsWithoutOldestQuoteTime,320);
});


test('Derived-feed startup preserves a legacy fallback with missing provider identity, but rejects a same-game append',async()=>{
  const baseline=journal(1,1);delete baseline.snapshots[0].providerEventId;
  delete baseline.snapshots[0].marketOldestQuoteAt;
  const candidate=structuredClone(baseline);candidate.snapshots.push(later(journal(1,1).snapshots[0]));
  const before=JSON.stringify(baseline);
  const derived=createDerivedForwardMarketFeed({fallbackJournal:baseline,clock:()=>READ,
    fetchImpl:async()=>new Response(JSON.stringify(candidate))});
  const full=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>READ,fetchImpl:null});
  assert.equal(full.peekSnapshot().summary.totalSnapshots,1);
  assert.equal(buildGameDossier(baseline,{gameId:baseline.snapshots[0].gameId,now:READ}).available,true);
  const result=await derived.get();
  assert.equal(result.refreshStatus,'REFRESH_FAILED_USING_RETAINED_EVIDENCE');
  assert.equal(result.snapshotMarketAvailable,0);
  assert.equal(result.prospectiveModelLeadDiagnostic.gamesWithSnapshots,1);
  assert.equal(JSON.stringify(baseline),before);
});
