import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGenericCsv, compileInjuryReports, injuryContextForGame } from '../src/injuries.mjs';
const NOW=Date.parse('2026-11-01T15:00:00Z');
const CSV=[
'season,week,team,position,full_name,gsis_id,report_status,practice_status,report_primary_injury,date_modified',
'2026,9,KC,QB,"Example, Quarterback",qb-1,Questionable,Limited Participation,Shoulder,2026-11-01T10:00:00Z',
'2026,9,KC,QB,"Example, Quarterback",qb-1,Out,Did Not Participate,Shoulder,2026-11-01T13:00:00Z',
'2026,9,LV,RB,Example Runner,rb-1,Questionable,Limited Participation,Ankle,2026-11-01T12:00:00Z',
'2026,9,KC,WR,Example Receiver,wr-1,,,Hamstring,2026-11-01T11:00:00Z',
'2025,9,KC,QB,Old Quarterback,qb-2,Out,Did Not Participate,Knee,2025-11-01T10:00:00Z'
].join('\n');

test('CSV parser handles quoted player names and latest report revision',()=>{
  const rows=parseGenericCsv(CSV);
  assert.equal(rows.length,5);
  assert.equal(rows[0].full_name,'Example, Quarterback');
  const report=compileInjuryReports(rows,{season:2026,sourceUpdatedAt:'2026-11-01T14:00:00Z',now:NOW});
  assert.equal(report.reports['KC:9'].flaggedCount,1);
  assert.equal(report.reports['KC:9'].reportedQBs[0].status,'OUT');
  assert.equal(report.reports['KC:9'].statusCounts.out,1);
  assert.equal(report.reports['LV:9'].statusCounts.questionable,1);
  assert.equal(report.reports['KC:9'].flaggedPlayers[0].player,'Example, Quarterback');
  assert.ok(!JSON.stringify(report).includes('Old Quarterback'));
});

test('Injury status is source-scoped, scheduled and never guarantees a starting quarterback',()=>{
  const artifact=compileInjuryReports(parseGenericCsv(CSV),{
    season:2026,sourceUpdatedAt:'2026-11-01T14:00:00Z',now:NOW
  });
  artifact.fixtures=[{gameId:'2026_09_LV_KC',week:9,gameDate:'2026-11-01',home:'KC',away:'LV'}];
  const event={home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    commence_time:'2026-11-01T20:00:00Z'};
  const data=injuryContextForGame(event,artifact,NOW);
  assert.equal(data.available,true);
  assert.equal(data.week,9);
  assert.equal(data.home.reportedQBs.length,1);
  assert.equal(data.starterVerified,false);
  assert.equal(data.probabilitiesAdjusted,false);
  assert.equal(injuryContextForGame(event,artifact,NOW+5*86400000).reason,'INJURY_SOURCE_STALE');
  assert.equal(injuryContextForGame({...event,away_team:'Buffalo Bills'},artifact,NOW).reason,'SCHEDULE_WEEK_NOT_VERIFIED');
});
test('Missing, malformed or stale inputs are blocked rather than interpreted as healthy',()=>{
  assert.throws(()=>parseGenericCsv('game_id,score\n1,2'),/Missing injury/);
  assert.equal(injuryContextForGame({home_team:'Kansas City Chiefs'},null,NOW).available,false);
  const data=compileInjuryReports([],{season:2026,sourceUpdatedAt:null,now:NOW});
  data.fixtures=[{gameDate:'2026-11-01',week:9,home:'KC',away:'LV'}];
  const result=injuryContextForGame({
    home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',commence_time:'2026-11-01T20:00:00Z'
  },data,NOW);
  assert.equal(result.available,false);
});
