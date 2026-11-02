import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,cleanGames,canonicalTeam,eloProbability,calibrate,
  walkForward,evaluate,predictNflEvent,MODEL_VERSION
} from '../src/nfl-elo.mjs';
const SAMPLE = [
  'game_id,season,game_type,week,gameday,away_team,away_score,home_team,home_score,location,stadium',
  '2024_01_LV_KC,2024,REG,1,2024-09-01,LV,10,KC,30,Home,"Arrowhead, Kansas City"',
  '2024_02_KC_LV,2024,REG,2,2024-09-08,KC,25,LV,30,Home,"Allegiant Stadium"',
  '2025_01_KC_LV,2025,REG,1,2025-09-01,KC,0,LV,0,Neutral,"Neutral Stadium"',
  '2025_02_LV_KC,2025,REG,2,2025-09-08,LV,,KC,,Home,"Unplayed"',
  '2025_03_PIT_NE,2025,REG,3,2025-09-14,PIT,21,NE,17,Home,"Stadium"',
].join('\n');

test('Quoted CSV fields, aliases, clean score checks and missing future scores',()=>{
  const rows=parseCsv(SAMPLE);
  assert.equal(rows.length,5);
  assert.equal(rows[0].stadium,'Arrowhead, Kansas City');
  assert.equal(canonicalTeam('OAK'),'LV');
  assert.equal(canonicalTeam('SD'),'LAC');
  assert.equal(canonicalTeam('STL'),'LA');
  assert.equal(cleanGames(rows).length,4);
  assert.equal(cleanGames(rows,{today:'2024-09-08'}).length,2);
  assert.equal(cleanGames(rows)[0].home,'KC');
  assert.throws(()=>parseCsv('foo,bar\n1,2'),/Missing NFL game column/);
});

test('Pregame prediction is recorded before outcome-driven Elo update',()=>{
  const games=cleanGames(parseCsv(SAMPLE));
  const track=walkForward(games,{k:32,homeAdv:0,regression:0,scale:1});
  assert.equal(track.history[0].prediction,0.5);
  assert.equal(track.history[0].actual,1);
  assert.ok(track.history[1].prediction<0.5);
  assert.ok(track.history[1].awayRating>track.history[1].homeRating);
  assert.equal(track.history[2].actual,0.5);
  assert.equal(evaluate(track.history).n,3);
  assert.equal(evaluate(track.history).tiesExcluded,1);
});

test('Neutral field removes home advantage; calibration bounds remain valid',()=>{
  assert.equal(eloProbability(1500,1500,70,true),0.5);
  assert.ok(eloProbability(1500,1500,70,false)>0.5);
  assert.equal(calibrate(0.5,0.7),0.5);
  assert.ok(calibrate(0.001,0.8)>0&&calibrate(0.999,0.8)<1);
});

test('Unknown, stale and unavailable model probabilities fail closed',()=>{
  const event={home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders'};
  const now=Date.parse('2026-11-01T20:00:00Z');
  assert.equal(predictNflEvent(event,null,now).available,false);
  const artifact={schema:1,version:MODEL_VERSION,readyForResearch:true,
    generatedAt:'2026-10-01T20:00:00Z',params:{homeAdv:55,scale:1},
    ratings:{KC:1550,LV:1450},lastGameDate:'2026-10-01',holdout:{n:280,brier:0.23,ece:0.04}};
  assert.equal(predictNflEvent(event,artifact,now).reason,'MODEL_SNAPSHOT_STALE');
  artifact.generatedAt='2026-11-01T19:00:00Z';
  const predicted=predictNflEvent(event,artifact,now);
  assert.equal(predicted.available,true);
  assert.equal(predicted.independentOfOdds,true);
  assert.equal(predicted.injuryAdjusted,false);
  assert.ok(predicted.homeWinProbability>0.5&&predicted.homeWinProbability<1);
  assert.ok(Math.abs(predicted.homeWinProbability+predicted.awayWinProbability-1)<1e-5);
  artifact.readyForResearch=false;
  assert.equal(predictNflEvent(event,artifact,now).available,false);
});
