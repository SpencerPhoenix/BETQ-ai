import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {readScheduleSourceBytes,prepareScheduleReconciliation} from '../src/schedule-source-receipt.mjs';
import {resultsFromSchedule,updateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
const AT='2026-11-15T12:00:00.000Z',NOW=Date.parse(AT);
const bytes=s=>new TextEncoder().encode(s);
const sourceText='game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location\nfixture-game-0,2026,REG,2026-11-08,KC,LV,27,17,Home\n';
const journal=()=>({...syntheticScoringJournal(1),settlements:[]});
const extendedText=sourceText.replace('location\n','location,status,commenceTime\n').replace('Home\n','Home,FINAL,2026-11-08T18:00:00.000Z\n');

test('Receipt hashes exact response bytes and never supplies absent kickoff or final status',()=>{
  const source=readScheduleSourceBytes(bytes(sourceText),AT);
  assert.equal(source.sourceReceipt.sha256,createHash('sha256').update(bytes(sourceText)).digest('hex'));
  assert.equal(source.sourceReceipt.observedAt,AT);assert.equal(source.sourceReceipt.source,'NFLVERSE_SCHEDULES');
  assert.equal(Object.hasOwn(source.rows[0],'status'),false);assert.equal(Object.hasOwn(source.rows[0],'commenceTime'),false);
  assert.notEqual(readScheduleSourceBytes(bytes(sourceText.replaceAll('\n','\r\n')),AT).sourceReceipt.sha256,source.sourceReceipt.sha256);
});
test('Realistic nflverse score-only contract stays blocked despite an actual-byte receipt',()=>{
  const j=journal(),before=JSON.stringify(j),source=readScheduleSourceBytes(bytes(sourceText),AT);
  const prepared=prepareScheduleReconciliation(j,source.rows,NOW,{sourceReceipt:source.sourceReceipt});
  assert.equal(prepared.results.length,0);assert.equal(prepared.diagnostics.blockedGames,1);
  assert.equal(prepared.diagnostics.blockers.MISSING_EXPLICIT_FINAL_STATUS,1);
  assert.equal(prepared.diagnostics.blockers.MISSING_CANONICAL_SOURCE_KICKOFF,1);
  assert.equal(prepared.diagnostics.sourceReceiptStructurallyValid,true);
  assert.equal(prepared.diagnostics.scoringQualification,'NOT_SUPPLIED_BY_SCHEDULE_SOURCE');
  assert.equal(prepared.diagnostics.sourceIndependenceVerified,false);assert.equal(JSON.stringify(j),before);
});
test('Only an explicit compatible offline source fixture passes the unchanged finality gate',()=>{
  const j=journal(),source=readScheduleSourceBytes(bytes(extendedText),AT);
  const prepared=prepareScheduleReconciliation(j,source.rows,NOW,{sourceReceipt:source.sourceReceipt});
  assert.equal(prepared.results.length,1);assert.equal(prepared.diagnostics.blockedGames,0);
  const r=prepared.results[0];assert.equal(r.terminalStatusReceipt.bindingPolicy,'FROZEN_RESULT_RECEIPT_V1');
  for(const key of ['gameId','season','home','away','gameDate','commenceTime','homeScore','awayScore'])assert.equal(r.terminalStatusReceipt[key],r[key]);
  const updated=updateJournal(j,[],prepared.results,NOW);
  assert.equal(updated.settlementRevisions,1);assert.equal(summarizeEvidence(updated.journal,NOW).sourceCorroboratedSettledGames,0);
});
for(const [name,mutate] of Object.entries({
  identity:r=>r.gameId='other',home:r=>r.home='BUF',away:r=>r.away='BAL',date:r=>r.gameDate='2026-11-09',
  kickoff:r=>r.commenceTime='2026-11-08T19:00:00.000Z',season:r=>r.season=2025,
  homeScore:r=>r.homeScore=28,awayScore:r=>r.awayScore=18,status:r=>r.status='IN_PROGRESS',
  source:r=>r.source='BALLDONTLIE_NFL_GAMES',policy:r=>delete r.bindingPolicy,
  receiptTime:r=>r.observedAt='2026-11-15T10:00:00.000Z',hash:r=>r.sha256='invalid'
}))test('Both admission and scoring reject contradictory terminal receipt: '+name,()=>{
  const j=syntheticScoringJournal(1),record=j.settlements[0];mutate(record.terminalStatusReceipt);
  assert.equal(isSourceCorroboratedSettlement(record,j.snapshots[0]),false);
  assert.throws(()=>updateJournal({...j,settlements:[]},[],[record],NOW),/identity or finality/);
});
test('Missing terminal receipt can never qualify an otherwise matching historical record',()=>{
  const j=syntheticScoringJournal(1);delete j.settlements[0].terminalStatusReceipt;
  assert.equal(summarizeEvidence(j,NOW).settledGames,1);assert.equal(summarizeEvidence(j,NOW).sourceCorroboratedSettledGames,0);
});
for(const [name,value] of Object.entries({gameId:'other',home:'BUF',away:'BAL',season:2025,
  gameDate:'2026-11-09',commenceTime:'2026-11-08T19:00:00.000Z',homeScore:28,awayScore:18,
  source:'OTHER',bindingPolicy:undefined,sha256:'c'.repeat(64),collectorObservedAt:'2026-11-15T11:59:59.000Z'}))
  test('Community receipt must bind the same identity, scores and exact source receipt: '+name,()=>{
    const j=syntheticScoringJournal(1);j.settlements[0].communitySourceVintage[name]=value;
    assert.equal(isSourceCorroboratedSettlement(j.settlements[0],j.snapshots[0]),false);
  });
test('Diagnostics report source absence, duplicates, pending scores, delay and stale receipt without guessing',()=>{
  const j=journal(),source=readScheduleSourceBytes(bytes(sourceText),AT),row=source.rows[0];
  assert.equal(prepareScheduleReconciliation(j,[],NOW).diagnostics.blockers.MISSING_SOURCE_ROW,1);
  assert.equal(prepareScheduleReconciliation(j,[row,row],NOW).diagnostics.blockers.DUPLICATE_SOURCE_ROW,1);
  const pending={...row,home_score:'',away_score:''};
  const diag=prepareScheduleReconciliation(j,[pending],Date.parse('2026-11-09T17:00:00.000Z')).diagnostics;
  assert.equal(diag.blockers.SCORES_NOT_AVAILABLE,1);assert.equal(diag.blockers.FINALITY_DELAY_NOT_REACHED,1);
  assert.equal(diag.blockers.MISSING_INVALID_OR_STALE_SOURCE_RECEIPT,1);
  const full=readScheduleSourceBytes(bytes(extendedText),AT);
  assert.equal(prepareScheduleReconciliation(j,full.rows,NOW+3600001,{sourceReceipt:full.sourceReceipt}).diagnostics.blockers.MISSING_INVALID_OR_STALE_SOURCE_RECEIPT,1);
});
test('Diagnostic output is bounded allowlisted metadata, not raw source or result text',()=>{
  const j=journal(),source=readScheduleSourceBytes(bytes(sourceText),AT);
  source.rows[0].status='<script>SECRET</script>';source.rows[0].game_type='SECRET';
  const text=JSON.stringify(prepareScheduleReconciliation(j,source.rows,NOW,{sourceReceipt:source.sourceReceipt}).diagnostics);
  assert.doesNotMatch(text,/SECRET|fixture-game|sha256|home_score|27|script/);
});
test('Source reader rejects malformed timestamps, encoding, duplicate headers and oversized input',()=>{
  for(const at of ['bad','2026-11-15T12:00:00Z','2026-02-30T00:00:00.000Z'])assert.throws(()=>readScheduleSourceBytes(bytes(sourceText),at));
  for(const b of [new Uint8Array(),new Uint8Array([0xff]),new Uint8Array(12000001),sourceText])assert.throws(()=>readScheduleSourceBytes(b,AT));
  assert.throws(()=>readScheduleSourceBytes(bytes(sourceText.replace('location\n','location,home_score\n')),AT),/HEADERS/);
});
test('Pinned real evidence remains byte-identical and unqualified',async()=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),before=await readFile(path,'utf8');
  const j=JSON.parse(before),out=summarizeEvidence(j,NOW);
  assert.equal(out.totalSnapshots,323);assert.equal(out.settledGames,18);assert.equal(out.sourceCorroboratedSettledGames,0);
  assert.equal(out.forwardMetrics,null);assert.equal(await readFile(path,'utf8'),before);
});


test('Caller-provided wrong source is rejected rather than relabeled as nflverse',()=>{
  const j=journal(),source=readScheduleSourceBytes(bytes(extendedText),AT);
  for(const supplied of ['BALLDONTLIE_NFL_GAMES','ESPN_SITE_SCOREBOARD_UNOFFICIAL',undefined]){
    const sourceReceipt={...source.sourceReceipt,source:supplied};
    const result=prepareScheduleReconciliation(j,source.rows,NOW,{sourceReceipt});
    assert.equal(result.results.length,0);assert.equal(result.diagnostics.sourceReceiptStructurallyValid,false);
    assert.equal(result.diagnostics.blockers.MISSING_INVALID_OR_STALE_SOURCE_RECEIPT,1);
  }
});
test('Malformed quoting or row widths cannot manufacture an explicit FINAL status',()=>{
  for(const malformed of [extendedText.replace('FINAL','FIN"AL"'),extendedText.replace('Home,FINAL','"Home"garbage,FINAL'),
    extendedText.trimEnd()+',unlabeled\n',extendedText.replace(',Home,FINAL,',',FINAL,'),extendedText.replace('FINAL','"FINAL')]){
    assert.throws(()=>readScheduleSourceBytes(bytes(malformed),AT));
  }
  for(const valid of [extendedText.replaceAll('\n','\r'),extendedText.replaceAll('\n','\r\n'),
    extendedText.replace('FINAL','"FINAL"'),extendedText.replace('Home','"Stadium, Home"')]){
    const source=readScheduleSourceBytes(bytes(valid),AT);assert.equal(source.rows[0].status,'FINAL');
  }
});

test('A genuinely bound terminal receipt can append an upgrade of an older unbound record',()=>{
  const j=journal(),source=readScheduleSourceBytes(bytes(extendedText),AT);
  const result=resultsFromSchedule(j,source.rows,NOW,{sourceReceipt:source.sourceReceipt})[0];
  const prior={...structuredClone(result),verifiedAt:AT,revision:1};
  delete prior.terminalStatusReceipt.bindingPolicy;delete prior.terminalStatusReceipt.gameId;
  j.settlements=[prior];const before=JSON.stringify(prior);
  const updated=updateJournal(j,[],[result],NOW);
  assert.equal(updated.settlementRevisions,1);assert.equal(updated.journal.settlements[1].revision,2);
  assert.equal(JSON.stringify(updated.journal.settlements[0]),before);
  assert.equal(updateJournal(updated.journal,[],[result],NOW).settlementRevisions,0);
  assert.equal(summarizeEvidence(updated.journal,NOW).sourceCorroboratedSettledGames,0);
});
