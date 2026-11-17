/** Context only. A source file being fresh does not establish matchup coverage. */
import {gameScope} from './on-demand-game.mjs';
import {injurySourceStatus} from './injuries.mjs';
const officialLinks={
 '2026_11_IND_HOU':[
  {title:'Texans official Week 11 report (external; not ingested)',url:'https://www.houstontexans.com/news/week-11-injury-report-texans-vs-colts'},
  {title:'Colts Monday walkthrough report (external; not ingested)',url:'https://www.colts.com/news/practice-notebook-colts-conduct-monday-walkthrough'}
 ]
};
export function injuryMatchupCoverage(gameId,artifact,{now=Date.now()}={}){
 const {season,week}=gameScope(gameId),[, ,away,home]=gameId.split('_');
 const source=injurySourceStatus(artifact,now);
 const eligible=source.available&&artifact.season===season;
 const rows=[away,home].map(team=>{
  const r=eligible?artifact.reports?.[`${team}:${week}`]:null;
  return {team,teamWeekRecordPresent:!!r,reason:r?null:'NO_USABLE_TEAM_WEEK_REPORT',
   participationRecords:structuredClone(r?.participationRecords||[]),
   practiceFieldsRetained:Array.isArray(r?.participationRecords),
   gameDayInactivesVerified:false,rosterCompletenessVerified:false};
 });
 const count=rows.filter(r=>r.teamWeekRecordPresent).length;
 return {gameId,season,week,home,away,sourceAvailable:source.available,
  sourceReason:source.reason,sourceUpdatedAt:source.sourceUpdatedAt||null,
  sourcePublishedAt:null,observedAt:null,validUntil:source.validUntil||null,
  freshnessBasis:'SOURCE_FILE_ONLY',coverage:count===2?'BOTH_TEAM_WEEK_RECORDS':count===1?'ONE_TEAM_WEEK_RECORD':'NO_TEAM_WEEK_RECORDS',
  available:count>0,teams:rows,officialSourceLinks:officialLinks[gameId]||[],
  starterVerified:false,probabilitiesAdjusted:false,
  caveat:'Team-week record presence is not complete roster coverage or a current practice report. DNP is not OUT; FP is not a confirmed starter. Practice may be estimated walkthrough participation. Missing designations and inactives remain unknown. External official links are not ingested or independently verified here.'};
}
