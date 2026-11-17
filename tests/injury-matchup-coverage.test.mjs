import test from 'node:test';
import assert from 'node:assert/strict';
import {compileInjuryReports} from '../src/injuries.mjs';
import {injuryMatchupCoverage} from '../src/injury-matchup-coverage.mjs';
const now=Date.parse('2026-11-17T15:00:00Z'),sourceUpdatedAt='2026-11-17T14:00:00.000Z';
const row=(team,practice_status='',report_status='')=>({season:2026,week:11,team,position:'QB',full_name:`Synthetic ${team}`,practice_status,report_status});
const build=rows=>compileInjuryReports(rows,{season:2026,sourceUpdatedAt,now,includeParticipation:true});
test('practice and designation are separate and never imply inactives/starters/probability effects',()=>{
 const a=build([row('IND','Did Not Participate'),row('HOU','Full Participation','Questionable')]);
 const c=injuryMatchupCoverage('2026_11_IND_HOU',a,{now});
 assert.equal(c.coverage,'BOTH_TEAM_WEEK_RECORDS');
 const ind=c.teams[0].participationRecords[0],hou=c.teams[1].participationRecords[0];
 assert.equal(ind.practiceParticipation,'DNP');assert.equal(ind.gameDesignation,'NOT_REPORTED');
 assert.equal(hou.practiceParticipation,'FP');assert.equal(hou.gameDesignation,'QUESTIONABLE');
 assert.equal(ind.inactiveStatus,'NOT_VERIFIED');assert.equal(ind.practiceType,'NOT_VERIFIED');
 assert.equal(c.starterVerified,false);assert.equal(c.probabilitiesAdjusted,false);
 assert.equal(c.sourcePublishedAt,null);assert.equal(c.observedAt,null);
});
test('global fresh data does not imply game-week coverage or complete rosters',()=>{
 const a=build([row('BAL','DNP')]);
 const c=injuryMatchupCoverage('2026_11_IND_HOU',a,{now});
 assert.equal(c.sourceAvailable,true);assert.equal(c.available,false);assert.equal(c.coverage,'NO_TEAM_WEEK_RECORDS');
 assert.ok(c.teams.every(x=>x.rosterCompletenessVerified===false));
 assert.equal(injuryMatchupCoverage('2026_11_IND_HOU',build([row('IND','DNP')]),{now}).coverage,'ONE_TEAM_WEEK_RECORD');
});
test('wrong week/season and stale source never expose other records',()=>{
 const a=build([row('IND','DNP'),row('HOU','LP')]);
 for(const [id,t] of [['2026_10_IND_HOU',now],['2025_11_IND_HOU',now],['2026_11_IND_HOU',now+4*86400000]]){
  const c=injuryMatchupCoverage(id,a,{now:t});assert.equal(c.coverage,'NO_TEAM_WEEK_RECORDS');assert.ok(c.teams.every(t=>!t.participationRecords.length));
 }
 assert.throws(()=>injuryMatchupCoverage('2026_11_IND_EVIL',a,{now}));
});
test('legacy records remain unknown and compiler emission is opt-in for safe deployment ordering',()=>{
 const a=compileInjuryReports([row('IND','DNP')],{season:2026,sourceUpdatedAt,now});
 assert.equal(a.reports['IND:11'].participationRecords,undefined);
 const c=injuryMatchupCoverage('2026_11_IND_HOU',a,{now});
 assert.equal(c.teams[0].practiceFieldsRetained,false);assert.deepEqual(c.teams[0].participationRecords,[]);
});
test('conflicting untimed practice rows do not pick arbitrary latest participation',()=>{
 const a=build([row('IND','DNP'),row('IND','FP')]);
 assert.equal(a.ambiguousPlayerRecords,1);assert.equal(a.reportCount,0);
});

test('equal valid timestamps with conflicting practice fail closed independent of row order',()=>{
 const a={...row('IND','DNP'),date_modified:sourceUpdatedAt},b={...row('IND','FP'),date_modified:sourceUpdatedAt};
 for(const rows of [[a,b],[b,a]]){const r=build(rows);assert.equal(r.ambiguousPlayerRecords,1);assert.equal(r.reportCount,0);}
});

test('validator accepts opt-in schema but rejects contradictions and invalid inactive claims',async()=>{
 const {validateInjuryArtifact}=await import('../src/injury-feed.mjs');
 const a=build([row('IND','DNP','Out')]);a.fixtures=[];a.validUntil=new Date(Date.parse(sourceUpdatedAt)+72*3600000).toISOString();
 assert.equal(validateInjuryArtifact(a,now),a);
 for(const [key,value] of [['inactiveStatus','OUT'],['gameDesignation','QUESTIONABLE'],['practiceParticipation','OUT'],['practiceType','ACTUAL_PRACTICE']]){
  const b=structuredClone(a);b.reports['IND:11'].participationRecords[0][key]=value;assert.throws(()=>validateInjuryArtifact(b,now));
 }
});
