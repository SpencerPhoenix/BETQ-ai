import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyJournal,matchSchedule,observationsFromSlate,prepareCaptureAdmission,updateJournal,resultsFromSchedule} from '../src/evidence.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';

// All identities, timestamps and outcomes in this suite are fabricated fixtures.
const NOW=Date.parse('2026-11-07T13:00:00.000Z');
const iso=n=>new Date(n).toISOString();
function journal(){const j=syntheticScoringJournal(2,0);j.settlements=[];return j;}
function later(s,changes={}){
  return {...s,id:s.id+'-later',capturedAt:iso(NOW),sourceReceivedAt:iso(NOW-1000),
    marketNewestQuoteAt:iso(NOW-2000),marketOldestQuoteAt:iso(NOW-2000),...changes};
}
const reasons=(frozen=0,payload=0)=>({FROZEN_GAME_IDENTITY_CONFLICT:frozen,SNAPSHOT_ID_PAYLOAD_CONFLICT:payload,PROVIDER_EVENT_ID_UNVERIFIED:0,PROVIDER_EVENT_ID_CHANGED:0,PROVIDER_EVENT_ID_REUSED:0});

for(const [label,change] of Object.entries({
  'twenty minutes later':s=>s.commenceTime=iso(Date.parse(s.commenceTime)+1200000),
  'twenty minutes earlier':s=>s.commenceTime=iso(Date.parse(s.commenceTime)-1200000),
  'one millisecond later':s=>s.commenceTime=iso(Date.parse(s.commenceTime)+1),
  'next day':s=>{s.commenceTime=iso(Date.parse(s.commenceTime)+86400000);s.gameDate='2026-11-09';},
  'different home team':s=>s.home='BUF',
  'different away team':s=>s.away='SEA',
  'different game date':s=>s.gameDate='2026-11-09'
}))test('Capture admission quarantines '+label+' without losing another game',()=>{
  const j=journal(),before=structuredClone(j),conflict=later(j.snapshots[0]),good=later(j.snapshots[1]);
  change(conflict);
  const out=prepareCaptureAdmission(j,[conflict,good],NOW);
  assert.deepEqual(out.accepted,[good]);assert.equal(out.skipped[0].gameId,conflict.gameId);
  assert.deepEqual(out.diagnostics.reasonCounts,reasons(1));
  assert.equal(out.diagnostics.quarantinedGames,1);
  const written=updateJournal(j,out.accepted,[],NOW);
  assert.equal(written.added,1);
  for(const s of before.snapshots)assert.deepEqual(written.journal.snapshots.find(x=>x.id===s.id),s);
  assert.deepEqual(j,before);
  assert.throws(()=>updateJournal(j,[conflict,good],[],NOW),/conflicting frozen identity/);
});

test('Changed kickoff is diagnosed before an existing deterministic ID can hide it',()=>{
  const j=journal(),s=j.snapshots[0],conflict={...s,commenceTime:iso(Date.parse(s.commenceTime)+1200000)};
  const out=prepareCaptureAdmission(j,[conflict],NOW);
  assert.deepEqual(out.accepted,[]);assert.deepEqual(out.diagnostics.reasonCounts,reasons(1,1));
  assert.deepEqual(out.skipped[0].reasons,['FROZEN_GAME_IDENTITY_CONFLICT','SNAPSHOT_ID_PAYLOAD_CONFLICT']);
  // The strict writer's existing first-record-wins API remains unchanged.
  assert.deepEqual(updateJournal(j,[conflict],[],NOW).journal,j);
});

test('Same-ID changed probabilities or capture times are routine duplicates, never overwritten',()=>{
  const j=journal(),s=j.snapshots[0];
  for(const duplicate of [{...s,marketHomeProbability:.7},later(s,{id:s.id})]){
    const out=prepareCaptureAdmission(j,[duplicate],NOW);
    assert.deepEqual(out.accepted,[duplicate]);assert.deepEqual(out.diagnostics.reasonCounts,reasons());
    assert.equal(out.diagnostics.routineDuplicateCaptures,1);assert.equal(out.diagnostics.quarantinedGames,0);
    assert.deepEqual(updateJournal(j,out.accepted,[],NOW).journal,j);
  }
});

test('Exact repeats stay idempotent and do not fabricate conflicts',()=>{
  const j=journal(),out=prepareCaptureAdmission(j,[structuredClone(j.snapshots[0])],NOW);
  assert.equal(out.accepted.length,1);assert.equal(out.skipped.length,0);
  assert.equal(out.diagnostics.routineDuplicateCaptures,1);
  assert.deepEqual(out.diagnostics.reasonCounts,reasons());
  assert.equal(updateJournal(j,out.accepted,[],NOW).added,0);
});

function generatedCapture(at,marketHomeProbability,{challenger=false}={}){
  const event={id:'offline-repeated-provider-event',homeTeam:'Kansas City Chiefs',awayTeam:'Las Vegas Raiders',
    commenceTime:'2026-11-08T18:00:00.000Z',independentModel:{available:true,
      method:'NFL_ELO_HISTORICAL_OUTCOMES',independentOfOdds:true,use:'RESEARCH_ONLY',
      homeWinProbability:.6,modelVersion:'offline-elo',modelBuiltAt:'2026-11-07T11:00:00.000Z',throughGameDate:'2026-11-06'},
    marketConsensus:{available:true,method:'ALL_BOOKS_MEDIAN_DE_VIG',books:4,
      homeProbability:marketHomeProbability,oldestQuoteAgeSeconds:2,oldestQuoteAt:iso(at-2000),latestQuoteAt:iso(at-2000),disagreementPoints:1}};
  if(challenger)event.efficiencyChallenger={available:true,independentOfOdds:true,researchOnly:true,
    automaticSelection:false,modelVersion:'offline-challenger',homeWinProbability:.65,generatedAt:'2026-11-07T11:00:00.000Z'};
  return observationsFromSlate({demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',
    market:'h2h',receivedAt:iso(at-1000),events:[event]},[{game_id:'2026_09_LV_KC',season:2026,
    game_type:'REG',gameday:'2026-11-08',home_team:'KC',away_team:'LV'}],at,2026).accepted[0];
}

test('Real observation builder same-day recapture changes time and price without a schedule incident',()=>{
  const first=generatedCapture(NOW-3600000,.55),repeat=generatedCapture(NOW,.58);
  assert.ok(first);assert.ok(repeat);assert.equal(first.id,repeat.id);
  assert.notEqual(first.capturedAt,repeat.capturedAt);assert.notEqual(first.marketHomeProbability,repeat.marketHomeProbability);
  const j=updateJournal(emptyJournal(2026),[first],[],NOW).journal;
  const out=prepareCaptureAdmission(j,[repeat],NOW),written=updateJournal(j,out.accepted,[],NOW);
  assert.equal(out.diagnostics.routineDuplicateCaptures,1);assert.deepEqual(out.diagnostics.reasonCounts,reasons());
  assert.equal(out.diagnostics.quarantinedCaptures,0);assert.equal(written.added,0);
  assert.deepEqual(written.journal,j);
});

test('Routine recapture does not quarantine a new challenger ID for the same game',()=>{
  const first=generatedCapture(NOW-3600000,.55),repeat=generatedCapture(NOW,.58),challenger=generatedCapture(NOW,.58,{challenger:true});
  assert.notEqual(first.id,challenger.id);assert.equal(first.gameId,challenger.gameId);
  const j=updateJournal(emptyJournal(2026),[first],[],NOW).journal;
  for(const captures of [[repeat,challenger],[challenger,repeat]]){
    const out=prepareCaptureAdmission(j,captures,NOW),written=updateJournal(j,out.accepted,[],NOW);
    assert.equal(out.diagnostics.routineDuplicateCaptures,1);assert.equal(out.diagnostics.quarantinedCaptures,0);
    assert.deepEqual(out.diagnostics.reasonCounts,reasons());assert.equal(written.added,1);
    assert.deepEqual(written.journal.snapshots.find(s=>s.id===first.id),first);
    assert.deepEqual(written.journal.snapshots.find(s=>s.id===challenger.id),challenger);
  }
});

test('Same-ID changed quote within a fresh batch remains first-record-wins, not game quarantine',()=>{
  const first=generatedCapture(NOW-3600000,.55),repeat=generatedCapture(NOW,.58);
  const out=prepareCaptureAdmission(emptyJournal(2026),[first,repeat],NOW);
  assert.equal(out.diagnostics.routineDuplicateCaptures,1);assert.equal(out.diagnostics.quarantinedCaptures,0);
  const written=updateJournal(emptyJournal(2026),out.accepted,[],NOW);
  assert.equal(written.added,1);assert.deepEqual(written.journal.snapshots,[first]);
});

test('Whole-game quarantine and reason counts are independent of capture order',()=>{
  const j=journal(),valid=later(j.snapshots[0]),conflict=later(j.snapshots[0],{
    id:'conflicting-variant',commenceTime:'2026-11-08T18:20:00.000Z'}),other=later(j.snapshots[1]);
  for(const captures of [[valid,other,conflict],[conflict,valid,other],[other,conflict,valid]]){
    const out=prepareCaptureAdmission(j,captures,NOW);
    assert.deepEqual(out.accepted,[other]);assert.equal(out.skipped.length,2);
    assert.deepEqual(out.diagnostics.reasonCounts,reasons(2));
    assert.equal(out.diagnostics.quarantinedGames,1);
  }
});

test('Conflicting identities in a previously unseen game are both quarantined',()=>{
  const a=later(journal().snapshots[0]),b={...a,id:'different-id',commenceTime:'2026-11-08T18:20:00.000Z'};
  for(const captures of [[a,b],[b,a]]){
    const out=prepareCaptureAdmission(emptyJournal(2026),captures,NOW);
    assert.deepEqual(out.accepted,[]);assert.deepEqual(out.diagnostics.reasonCounts,reasons(2));
  }
});

test('Same-ID payload collisions within a batch quarantine all affected games',()=>{
  const j=journal(),a=later(j.snapshots[0]),b=later(j.snapshots[1],{id:a.id});
  for(const captures of [[a,b],[b,a]]){
    const out=prepareCaptureAdmission(j,captures,NOW);
    assert.deepEqual(out.accepted,[]);assert.deepEqual(out.diagnostics.reasonCounts,reasons(0,2));
    assert.equal(out.diagnostics.quarantinedGames,2);
  }
});

test('Reusing another retained game snapshot ID also quarantines its new capture',()=>{
  const j=journal(),a=later(j.snapshots[0]),b=later(j.snapshots[1],{id:j.snapshots[0].id});
  const out=prepareCaptureAdmission(j,[a,b],NOW);
  assert.deepEqual(out.accepted,[]);assert.equal(out.diagnostics.quarantinedGames,2);
  assert.deepEqual(out.diagnostics.reasonCounts,reasons(0,2));
});

for(const [label,change] of Object.entries({
  'invalid kickoff':s=>s.commenceTime='not-a-time',
  'noncanonical kickoff':s=>s.commenceTime='2026-11-08T18:20:00Z',
  'post-kickoff capture':s=>s.capturedAt=s.commenceTime,
  'future capture':s=>{s.capturedAt=iso(NOW+60001);s.sourceReceivedAt=s.capturedAt;s.marketNewestQuoteAt=s.capturedAt;},
  'missing provenance':s=>delete s.modelBuiltAt,
  'invalid probability':s=>s.modelHomeProbability=2,
  'invalid ID':s=>s.id='',
  'backdated capture':s=>{s.capturedAt='2026-11-07T11:59:00.000Z';s.sourceReceivedAt=s.capturedAt;s.marketNewestQuoteAt=s.capturedAt;}
}))test('Malformed '+label+' is a hard failure, even for an already conflicted game',()=>{
  const j=journal(),conflict=later(j.snapshots[0],{commenceTime:'2026-11-08T18:20:00.000Z'}),bad=later(j.snapshots[0],{id:'malformed'});
  change(bad);
  assert.throws(()=>prepareCaptureAdmission(j,[conflict,bad],NOW),/Invalid|Backdated/);
});

test('Corrupt retained journals are never silently converted into capture skips',()=>{
  const j=journal();j.snapshots.push({...j.snapshots[0],id:'retained-conflict',commenceTime:'2026-11-08T18:20:00.000Z',home:'BUF'});
  assert.throws(()=>prepareCaptureAdmission(j,[],NOW),/retained frozen identity/);
  assert.throws(()=>prepareCaptureAdmission({},[],NOW),/Invalid journal/);
  const duplicate=journal();duplicate.snapshots.push({...duplicate.snapshots[0]});
  assert.throws(()=>prepareCaptureAdmission(duplicate,[],NOW),/Invalid journal observation/);
  const contradictory=syntheticScoringJournal(1,0);
  contradictory.settlements.push({...contradictory.settlements[0],homeScore:28});
  assert.throws(()=>prepareCaptureAdmission(contradictory,[],Date.parse('2026-11-16T12:00:00.000Z')),/Contradictory finalized results/);
});

test('Admission validates its own input and does not mutate candidate records',()=>{
  const j=journal(),captures=[later(j.snapshots[0])],before=structuredClone(captures);
  for(const now of [NaN,Infinity,'2026-11-07'])assert.throws(()=>prepareCaptureAdmission(j,captures,now),/Invalid/);
  for(const bad of [null,{},Array(10001).fill(null)])assert.throws(()=>prepareCaptureAdmission(j,bad,NOW),/Invalid/);
  prepareCaptureAdmission(j,captures,NOW);assert.deepEqual(captures,before);
});

test('Capture conflict handling does not grant corrected kickoff final receipts eligibility',()=>{
  const j=journal(),s=j.snapshots[0],after=Date.parse('2026-11-10T12:00:00.000Z');
  const row={game_id:s.gameId,season:s.season,game_type:'REG',gameday:s.gameDate,home_team:s.home,
    away_team:s.away,commenceTime:'2026-11-08T18:20:00.000Z',status:'FINAL',home_score:27,away_score:17};
  assert.deepEqual(resultsFromSchedule(j,[row],after,{sourceReceipt:{source:'NFLVERSE_SCHEDULES',
    observedAt:iso(after),sha256:'a'.repeat(64)}}),[]);
});

function scheduleInput(commenceTime){
  const parsed=Date.parse(commenceTime),kick=Number.isFinite(parsed)?parsed:Date.parse('2026-11-08T18:00:00.000Z');
  const at=kick-86400000,event={id:'offline-schedule-parser',homeTeam:'Kansas City Chiefs',awayTeam:'Las Vegas Raiders',
    commenceTime,independentModel:{available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',independentOfOdds:true,
      use:'RESEARCH_ONLY',homeWinProbability:.6,modelVersion:'offline-parser-model',
      modelBuiltAt:iso(at-3600000),throughGameDate:iso(at-2*86400000).slice(0,10)}};
  const rows=[{game_id:'2026_09_LV_KC',season:2026,game_type:'REG',gameday:iso(kick).slice(0,10),home_team:'KC',away_team:'LV'}];
  return {at,event,rows,slate:{demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',market:'h2h',
    receivedAt:iso(at),events:[event]}};
}

for(const kickoff of ['2026-11-08','2026-11-08T18:00:00','2026-11-08 18:00:00Z',
  '11/08/2026 18:00:00','2026-02-30T18:00:00Z','2026-11-31T18:00:00Z','2026-11-08T24:00:00Z'])
  test('Direct collector input rejects ambiguous or rolled-calendar kickoff '+kickoff,()=>{
    const input=scheduleInput(kickoff);
    assert.equal(matchSchedule(input.event,input.rows,2026),null);
    const out=observationsFromSlate(input.slate,input.rows,input.at,2026);
    assert.equal(out.accepted.length,0);assert.deepEqual(out.skipped,[{eventId:input.event.id,reason:'PREGAME_MODEL_GATE'}]);
  });

test('Direct collector accepts explicit offsets and normalizes only the newly observed kickoff',()=>{
  for(const kickoff of ['2026-11-08T18:00:00Z','2026-11-08T10:00:00-08:00','2026-11-09T03:00:00+09:00']){
    const input=scheduleInput(kickoff),before=structuredClone(input);
    assert.equal(matchSchedule(input.event,input.rows,2026),input.rows[0]);
    const out=observationsFromSlate(input.slate,input.rows,input.at,2026);
    assert.equal(out.accepted.length,1);assert.equal(out.accepted[0].commenceTime,'2026-11-08T18:00:00.000Z');
    assert.deepEqual(input,before);
  }
});

test('Schedule matching rejects a rolled calendar day before deriving a forecast',()=>{
  const input=scheduleInput('2026-03-02T18:00:00Z');input.rows[0].gameday='2026-02-30';
  assert.equal(matchSchedule(input.event,input.rows,2026),null);
  const out=observationsFromSlate(input.slate,input.rows,input.at,2026);
  assert.equal(out.accepted.length,0);assert.deepEqual(out.skipped,[{eventId:input.event.id,reason:'NO_UNIQUE_SCHEDULE_MATCH'}]);
});

const OBSERVED_AT=Date.parse('2026-11-07T19:43:37.000Z');
const KNOWN_PROVIDER_ID='ac9d38a18d5c92814233a31aa9a48d78';
function reviewedScheduleInput(at,kickoff='2026-11-08T21:05:00.000Z',providerId=KNOWN_PROVIDER_ID){
  const input=scheduleInput(kickoff);input.at=at;input.slate.receivedAt=iso(at);
  Object.assign(input.event,{id:providerId,homeTeam:'San Francisco 49ers',awayTeam:'Las Vegas Raiders'});
  Object.assign(input.event.independentModel,{modelBuiltAt:iso(at-3600000),throughGameDate:'2026-11-05'});
  Object.assign(input.rows[0],{game_id:'2026_09_LV_SF',home_team:'SF',away_team:'LV',gameday:'2026-11-08'});
  return input;
}

test('Known stale kickoff is accepted before the dated observation and blocked at or after it',()=>{
  for(const delta of [-1,0,1]){
    const input=reviewedScheduleInput(OBSERVED_AT+delta),before=structuredClone(input);
    const out=observationsFromSlate(input.slate,input.rows,input.at,2026);
    if(delta<0){assert.equal(out.accepted.length,1);assert.deepEqual(out.skipped,[]);}
    else{
      assert.deepEqual(out.accepted,[]);
      assert.deepEqual(out.skipped,[{eventId:KNOWN_PROVIDER_ID,reason:'SCHEDULE_RECONCILIATION_REQUIRED'}]);
    }
    assert.deepEqual(input,before);
  }
});

test('Incoming schedule review flags cannot bypass the locally recomputed dated observation',()=>{
  const input=reviewedScheduleInput(OBSERVED_AT+60000);
  input.event.scheduleReview={status:'MATCHES_DATED_SCHEDULE_OBSERVATION',currentScheduleVerified:true};
  input.slate.scheduleReview={status:'CURRENT_SCHEDULE_UNVERIFIED'};
  const out=observationsFromSlate(input.slate,input.rows,input.at,2026);
  assert.equal(out.accepted.length,0);assert.equal(out.skipped[0].reason,'SCHEDULE_RECONCILIATION_REQUIRED');
});

test('Corrected kickoff derives a new observation but cannot bypass older frozen schedule history',()=>{
  const before=reviewedScheduleInput(OBSERVED_AT-60000),after=reviewedScheduleInput(OBSERVED_AT+60000,'2026-11-08T21:25:00.000Z');
  const first=observationsFromSlate(before.slate,before.rows,before.at,2026).accepted;
  const j=updateJournal(emptyJournal(2026),first,[],before.at).journal,original=JSON.stringify(j);
  const corrected=observationsFromSlate(after.slate,after.rows,after.at,2026);
  assert.equal(corrected.accepted.length,1);assert.deepEqual(corrected.skipped,[]);
  assert.equal(corrected.accepted[0].commenceTime,'2026-11-08T21:25:00.000Z');
  const admission=prepareCaptureAdmission(j,corrected.accepted,after.at);
  assert.deepEqual(admission.accepted,[]);assert.equal(admission.diagnostics.quarantinedGames,1);
  assert.equal(admission.diagnostics.reasonCounts.FROZEN_GAME_IDENTITY_CONFLICT,1);
  assert.equal(JSON.stringify(updateJournal(j,admission.accepted,[],after.at).journal),original);
  assert.equal(JSON.stringify(j),original);
});

test('Unknown provider identity and unrelated games are not blocked by the local dated note',()=>{
  const unknown=reviewedScheduleInput(OBSERVED_AT+60000,undefined,'offline-unknown-provider');
  unknown.event.scheduleReview={status:'SCHEDULE_RECONCILIATION_REQUIRED'};
  const unknownOut=observationsFromSlate(unknown.slate,unknown.rows,unknown.at,2026);
  assert.equal(unknownOut.accepted.length,1);assert.deepEqual(unknownOut.skipped,[]);
  const known=reviewedScheduleInput(OBSERVED_AT+60000),unrelated=scheduleInput('2026-11-08T18:00:00Z').event;
  known.slate.events.push(unrelated);known.rows.push({game_id:'2026_09_LV_KC',season:2026,game_type:'REG',
    gameday:'2026-11-08',home_team:'KC',away_team:'LV'});
  const mixed=observationsFromSlate(known.slate,known.rows,known.at,2026);
  assert.equal(mixed.accepted.length,1);assert.equal(mixed.accepted[0].gameId,'2026_09_LV_KC');
  assert.deepEqual(mixed.skipped,[{eventId:KNOWN_PROVIDER_ID,reason:'SCHEDULE_RECONCILIATION_REQUIRED'}]);
});
