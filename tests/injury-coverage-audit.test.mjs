import test from 'node:test';
import assert from 'node:assert/strict';
import {compileInjuryReports} from '../src/injuries.mjs';
import {auditInjuryCoverage} from '../src/injury-coverage-audit.mjs';
const now=Date.parse('2026-11-17T16:00:00Z'),vintage='2026-11-17T07:00:00.000Z';
const row=(team,week=10)=>({season:2026,week,team,position:'QB',full_name:'Synthetic Player',report_status:'',practice_status:'DNP'});
function artifact(rows=[row('BAL')]){
 const a=compileInjuryReports(rows,{season:2026,sourceUpdatedAt:vintage,now});
 a.validUntil=new Date(Date.parse(vintage)+72*3600000).toISOString();
 a.fixtures=[{gameId:'2026_11_IND_HOU',week:11,gameDate:'2026-11-19',away:'IND',home:'HOU'}];return a;
}
test('fresh source with no next-week records explicitly reports league-wide absence',()=>{
 const a=artifact(),before=JSON.stringify(a),r=auditInjuryCoverage(a,{now});
 assert.equal(r.sourceAvailable,true);assert.equal(r.weeks[0].recordedTeamCount,0);
 assert.equal(r.weeks[0].reason,'NO_TEAM_WEEK_RECORDS');assert.deepEqual(r.games[0].missingTeams,['IND','HOU']);
 assert.equal(r.gamesWithBothRecords,0);assert.equal(r.status,'GAPS_OBSERVED');
 assert.equal(JSON.stringify(a),before);assert.equal(r.probabilitiesAdjusted,false);
});
test('partial and both-record presence never imply complete/verified rosters',()=>{
 const a=artifact([row('IND',11)]);assert.equal(auditInjuryCoverage(a,{now}).games[0].recordedTeamCount,1);
 const r=auditInjuryCoverage(artifact([row('IND',11),row('HOU',11)]),{now});
 assert.equal(r.gamesWithBothRecords,1);assert.equal(r.status,'RECORD_PRESENCE_ONLY');
 assert.equal(r.rosterCompletenessVerified,false);assert.equal(r.starterVerified,false);
});
test('stale source retains presence diagnostics while usable counts fail closed',()=>{
 const a=artifact([row('IND',11),row('HOU',11)]);a.fixtures[0].gameDate='2026-11-22';
 const r=auditInjuryCoverage(a,{now:now+4*86400000});
 assert.equal(r.gamesWithBothRecords,1);assert.equal(r.gamesWithBothUsableRecords,0);
 assert.equal(r.sourceReason,'INJURY_SOURCE_STALE');
});
test('invalid, wrong-season, duplicate and oversized fixture artifacts are rejected',()=>{
 for(const change of [a=>a.reportCount++,a=>a.season--,a=>a.fixtures.push(a.fixtures[0]),a=>a.fixtures=Array(101).fill(a.fixtures[0])]){
  const a=artifact();change(a);assert.throws(()=>auditInjuryCoverage(a,{now}),/INVALID_INJURY_ARTIFACT/);
 }
});
test('date-window candidates exclude past and far-future dates; no candidates is not ready',()=>{
 const a=artifact();a.fixtures[0].gameDate='2026-11-16';let r=auditInjuryCoverage(a,{now});
 assert.equal(r.candidateGameCount,0);assert.ok(r.reasons.includes('NO_DATE_WINDOW_FIXTURES'));
 a.fixtures[0].gameDate='2026-12-03';r=auditInjuryCoverage(a,{now});assert.equal(r.candidateGameCount,0);
});
test('Eastern evening fixtures remain candidates after UTC midnight',()=>{
 const a=artifact();a.fixtures[0].gameDate='2026-11-18';
 const r=auditInjuryCoverage(a,{now:Date.parse('2026-11-19T00:30:00Z')});
 assert.equal(r.dateWindow.from,'2026-11-18');assert.equal(r.candidateGameCount,1);
 assert.equal(r.dateWindow.timeZone,'America/New_York');
});
