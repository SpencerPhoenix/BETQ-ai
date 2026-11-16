import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTrainingGames} from '../src/training-input-safety.mjs';
const row={game_id:'2026_10_NYG_PHI',season:'2026',game_type:'REG',week:'10',gameday:'2026-11-08',home_team:'PHI',away_team:'NYG',home_score:'11',away_score:'19',location:'Home'};
const at={asOf:'2026-11-09T12:00:00Z'};
test('Training excludes partial/current-day and date-only ambiguous recent scores',()=>{
  for(const asOf of ['2026-11-08T23:00:00Z','2026-11-09T04:00:00Z','2026-11-09T11:59:59Z'])assert.equal(selectTrainingGames([row],{asOf}).games.length,0);
  assert.equal(selectTrainingGames([row],at).games.length,1);
  assert.equal(selectTrainingGames([{...row,status:'FINAL'}],{asOf:'2026-11-08T23:00:00Z'}).games.length,0);
});
test('Training explicit nonfinal states and unknown venues fail closed',()=>{
  for(const status of ['IN_PROGRESS','POSTPONED','SUSPENDED','STATUS_SCHEDULED','unknown'])assert.equal(selectTrainingGames([{...row,status}],at).games.length,0);
  assert.equal(selectTrainingGames([{...row,status:'FINAL',game_status:'IN_PROGRESS'}],at).games.length,0);
  for(const location of ['',undefined,'Away','neutral'])assert.equal(selectTrainingGames([{...row,location}],at).games.length,0);
  assert.equal(selectTrainingGames([{...row,status:'FINAL',location:'Neutral'}],at).games[0].neutral,true);
});
test('Training conflicts cannot silently use first row; identical duplicates dedupe',()=>{
  assert.equal(selectTrainingGames([row,{...row,home_score:'14'}],at).games.length,0);
  assert.equal(selectTrainingGames([row,{...row}],at).games.length,1);
});
test('Training coverage explicitly separates observed source rows from verified coverage/finality',()=>{
  const {report}=selectTrainingGames([row],at);
  assert.equal(report.independentlyVerifiedFinality,false);
  assert.equal(report.completeScheduleCoverageVerified,false);
  assert.deepEqual(report.teams.PHI,{games:1,lastGameDate:'2026-11-08'});
  assert.equal(report.teams.NYG.games,1);
  assert.throws(()=>selectTrainingGames([row],{asOf:'nonsense'}));
  assert.equal(selectTrainingGames([{...row,home_score:''}],at).games.length,0);
});
