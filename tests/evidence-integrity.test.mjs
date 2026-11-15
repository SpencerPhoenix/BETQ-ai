import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {emptyJournal,validateJournal,updateJournal,resultsFromSchedule,summarizeEvidence,observationsFromSlate} from '../src/evidence.mjs';
import {isEligibleModelSnapshot,isEligibleMarketSnapshot,FINALITY_DELAY_MS} from '../src/evidence-integrity.mjs';
import {isEligibleFirstSnapshot,calculateSequentialEvidence} from '../src/market-sequential.mjs';
import {summarizeProspectiveDirection} from '../src/prospective-direction.mjs';
import {summarizeDerivedForwardMarkets,createDerivedForwardMarketFeed} from '../src/shadow-derived.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const NOW=Date.parse('2026-11-16T12:00:00.000Z');
const iso=x=>new Date(x).toISOString();
const journal=()=>({...syntheticScoringJournal(1),provenance:emptyJournal(2026).provenance});
const mutations={
  staleQuote:s=>s.marketNewestQuoteAt='2020-01-01T00:00:00.000Z',
  futureModelCutoff:s=>s.modelLastResultDate='2027-01-01',
  sameDayModelCutoff:s=>s.modelLastResultDate='2026-11-07',
  impossibleCutoff:s=>s.modelLastResultDate='2026-02-30',
  staleReceipt:s=>s.sourceReceivedAt='2020-01-01T00:00:00.000Z',
  quoteAfterReceipt:s=>s.sourceReceivedAt='2026-11-07T11:55:00.000Z',
  noncanonicalCapture:s=>s.capturedAt='2026-11-07T12:00:00Z',
  noncanonicalKickoff:s=>s.commenceTime='2026-11-08T18:00:00+00:00',
  futureBuild:s=>s.modelBuiltAt='2026-11-07T12:02:00.000Z'
};
for(const [name,change] of Object.entries(mutations))test('Every evidence reader rejects '+name,()=>{
  const j=journal();change(j.snapshots[0]);
  assert.equal(isEligibleFirstSnapshot(j.snapshots[0]),false);
  for(const reader of [validateJournal,summarizeEvidence,calculateSequentialEvidence,summarizeProspectiveDirection,summarizeDerivedForwardMarkets])
    assert.throws(()=>reader(j),/Invalid journal observation/);
});
test('Missing legacy provenance stays recorded but cannot enter any metric cohort',()=>{
  const j=journal();delete j.snapshots[0].modelLastResultDate;
  const before=JSON.stringify(j);validateJournal(j);
  assert.equal(isEligibleModelSnapshot(j.snapshots[0]),false);
  assert.equal(summarizeEvidence(j).settledGames,1);
  assert.equal(summarizeEvidence(j).sourceCorroboratedSettledGames,0);
  assert.equal(calculateSequentialEvidence(j).firstQualifyingPregameGames,0);
  assert.equal(summarizeDerivedForwardMarkets(j).pricedGames,0);
  assert.equal(JSON.stringify(j),before);
});
test('Shared quote-age boundary accepts ten minutes exactly, rejects older quotes',()=>{
  const s=journal().snapshots[0],capture=Date.parse(s.capturedAt);
  s.marketNewestQuoteAt=iso(capture-600000);assert.equal(isEligibleMarketSnapshot(s),true);
  s.marketNewestQuoteAt=iso(capture-600001);assert.equal(isEligibleMarketSnapshot(s),false);
});
const sourceRow=s=>({game_id:s.gameId,season:s.season,game_type:'REG',gameday:s.gameDate,
  home_team:s.home,away_team:s.away,commenceTime:s.commenceTime,status:'FINAL',home_score:'27',away_score:'17'});
const receipt=now=>({sourceReceipt:{observedAt:iso(now),sha256:'d'.repeat(64)}});
test('New finals require exact frozen identity, unique source row, receipt and full 24-hour buffer',()=>{
  const j=journal(),s=j.snapshots[0],row=sourceRow(s),at=Date.parse(s.commenceTime)+FINALITY_DELAY_MS;
  assert.equal(resultsFromSchedule(j,[row],at,receipt(at)).length,1);
  assert.equal(resultsFromSchedule(j,[row],at-1,receipt(at-1)).length,0);
  assert.equal(resultsFromSchedule(j,[row],at).length,0);
  assert.equal(resultsFromSchedule(j,[row,row],at,receipt(at)).length,0);
  for(const change of [{home_team:'BUF'},{away_team:'JAX'},{gameday:'2026-11-09'},
    {commenceTime:'2026-11-08T19:00:00.000Z'},{status:undefined},{status:'IN_PROGRESS'},
    {home_score:null},{home_score:true},{home_score:' '},{away_score:'101'}])
    assert.equal(resultsFromSchedule(j,[{...row,...change}],at,receipt(at)).length,0,JSON.stringify(change));
  assert.equal(resultsFromSchedule(j,[row],at,receipt(at-3600001)).length,0);
  j.snapshots.push({...s,id:'conflict',home:'BUF'});
  assert.equal(resultsFromSchedule(j,[row],at,receipt(at)).length,0);
});
test('Direct journal writes cannot bypass identity/finality, frozen IDs, or chronology',()=>{
  const j=journal(),s=j.snapshots[0],row=sourceRow(s),at=Date.parse(s.commenceTime)+FINALITY_DELAY_MS;
  const result=resultsFromSchedule(j,[row],at,receipt(at))[0];
  const existing={...j,settlements:[]};
  assert.equal(updateJournal(existing,[],[result],at).settlementRevisions,1);
  for(const bad of [{...result,home:'BUF'},{...result,terminalStatusReceipt:null}])
    assert.throws(()=>updateJournal(existing,[],[bad],at),/identity or finality/);
  assert.deepEqual(updateJournal(j,[{...s,modelHomeProbability:.8}],[],at).journal.snapshots,j.snapshots);
  const backdated={...s,id:'backdated',capturedAt:'2026-11-07T11:59:59.000Z'};
  assert.throws(()=>updateJournal(j,[backdated],[],at),/Backdated/);
});
test('Wrong-team receipt identities cannot qualify by matching game ID and date alone',()=>{
  for(const target of ['record','receipt']){
    const j=journal();(target==='record'?j.settlements[0]:j.settlements[0].finalityAttestation).home='BUF';
    assert.equal(summarizeEvidence(j).sourceCorroboratedSettledGames,0);
    assert.equal(calculateSequentialEvidence(j).eligibleSettledNonTieGames,0);
  }
});
test('Derived feed shares append-only, decoded private-data and future-time protection',async()=>{
  for(const mutate of [j=>j.snapshots.pop(),j=>j.snapshots[0].modelHomeProbability=.9,
    j=>j.snapshots[0].private={api_key:'SYNTHETIC_ONLY'},
    j=>j.settlements[0].verifiedAt=iso(NOW+3600000)]){
    const baseline=journal(),bad=structuredClone(baseline);mutate(bad);
    const feed=createDerivedForwardMarketFeed({fallbackJournal:baseline,clock:()=>NOW,
      fetchImpl:async(_url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(JSON.stringify(bad));}});
    const result=await feed.get();
    assert.equal(result.available,true);assert.equal(result.pricedGames,1);
    assert.equal(result.refreshStatus,'REFRESH_FAILED_USING_RETAINED_EVIDENCE');
    result.preview.push({fake:true});
    assert.equal((await feed.get()).preview.length,0);
  }
});
test('Ambiguous frozen identities cannot manufacture derived market movement',()=>{
  const j=journal();j.snapshots.push({...j.snapshots[0],id:'later',home:'BUF',capturedAt:'2026-11-07T12:30:00.000Z',
    sourceReceivedAt:'2026-11-07T12:29:59.000Z',marketNewestQuoteAt:'2026-11-07T12:29:58.000Z',marketHomeProbability:.7});
  assert.equal(summarizeDerivedForwardMarkets(j).pricedGames,0);
  assert.equal(summarizeProspectiveDirection(j).candidateMarketMovements,0);
});
test('Latest real journal remains unchanged with all existing observations and raw results',async()=>{
  const path=new URL('../data/evidence/nfl-2026.json',import.meta.url),before=await readFile(path,'utf8'),j=JSON.parse(before);
  validateJournal(j);const out=summarizeEvidence(j,NOW);
  assert.equal(out.totalSnapshots,132);assert.equal(out.settledGames,3);
  assert.equal(out.sourceCorroboratedSettledGames,0);assert.equal(out.forwardMetrics,null);
  assert.equal(await readFile(path,'utf8'),before);
});

test('Scheduled same-ID recaptures preserve the original quote without failing or overwriting',()=>{
  const j=journal(),s=j.snapshots[0],later={...s,capturedAt:'2026-11-07T12:30:00.000Z',
    sourceReceivedAt:'2026-11-07T12:29:59.000Z',marketNewestQuoteAt:'2026-11-07T12:29:58.000Z',marketHomeProbability:.7};
  const result=updateJournal(j,[later],[],NOW);
  assert.equal(result.added,0);assert.deepEqual(result.journal,j);
});
test('A real terminal provenance upgrade appends without rewriting the legacy score record',()=>{
  const j=journal(),s=j.snapshots[0],at=Date.parse(s.commenceTime)+FINALITY_DELAY_MS;
  const result=resultsFromSchedule(j,[sourceRow(s)],at,receipt(at))[0];
  const legacy={gameId:s.gameId,gameDate:s.gameDate,homeScore:27,awayScore:17,outcome:'HOME',
    resultHash:result.resultHash,verifiedAt:iso(at),revision:1,source:'NFLVERSE_SCHEDULES'};
  j.settlements=[legacy];
  const updated=updateJournal(j,[],[result],at);
  assert.equal(updated.settlementRevisions,1);assert.deepEqual(updated.journal.settlements[0],legacy);
  assert.equal(updated.journal.settlements[1].revision,2);
  assert.equal(updateJournal(updated.journal,[],[result],at).settlementRevisions,0);
  assert.equal(summarizeEvidence(updated.journal).sourceCorroboratedSettledGames,0);
});


test('Server seeds both public readers from the same sanitized bundled journal',async()=>{
  const server=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(server,/const NFL_EVIDENCE_JOURNAL=loadEvidenceJournal\(\);/);
  assert.match(server,/createJournalEvidenceFeed\(\{fallbackJournal:NFL_EVIDENCE_JOURNAL\}\)/);
  assert.match(server,/createDerivedForwardMarketFeed\(\{fallbackJournal:NFL_EVIDENCE_JOURNAL\}\)/);
});


test('Direct writes reject invalid clocks and future captures, including same-ID recaptures',()=>{
  const s=journal().snapshots[0],at=Date.parse(s.capturedAt);
  for(const now of [NaN,Infinity,'2026-11-07',at-60001])
    assert.throws(()=>updateJournal(emptyJournal(2026),[s],[],now),/Invalid/);
  assert.equal(updateJournal(emptyJournal(2026),[s],[],at-60000).added,1);
  assert.throws(()=>updateJournal(journal(),[s],[],at-60001),/future/);
});

test('Score corrections cannot be discarded by reusing a prior caller-supplied digest',()=>{
  const j=journal(),s=j.snapshots[0],at=Date.parse(s.commenceTime)+FINALITY_DELAY_MS;
  const result=resultsFromSchedule(j,[sourceRow(s)],at,receipt(at))[0];
  const first=updateJournal({...j,settlements:[]},[],[result],at);
  const previous=structuredClone(first.journal.settlements[0]);
  const correction={...result,homeScore:17,awayScore:27,outcome:'AWAY',resultHash:previous.resultHash};
  const updated=updateJournal(first.journal,[],[correction],at);
  assert.equal(updated.settlementRevisions,1);
  assert.deepEqual(updated.journal.settlements[0],previous);
  assert.equal(updated.journal.settlements[1].outcome,'AWAY');
  assert.notEqual(updated.journal.settlements[1].resultHash,previous.resultHash);
  assert.equal(updateJournal(updated.journal,[],[{...correction,resultHash:'caller_changed'}],at).settlementRevisions,0);
});
