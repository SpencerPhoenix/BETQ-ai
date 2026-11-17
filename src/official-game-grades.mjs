/** Read-only descriptive finals. Does not write settlements or qualify aggregate evidence. */
import {gradeRetainedGames,descriptiveForecastMetrics} from './game-grading.mjs';
import {isEligibleModelSnapshot} from './evidence-integrity.mjs';
import {officialWeeklyUrl,OFFICIAL_FINALITY_POLICY} from './nfl-official-finality.mjs';
export const OFFICIAL_GRADE_POLICY='OFFICIAL_FINAL_DESCRIPTIVE_V1';
const score=n=>Number.isInteger(n)&&n>=0&&n<=100;
export async function gradeGamesWithOfficialFinals(journal,feed,{clock=Date.now}={}){
 const report=gradeRetainedGames(journal,{now:clock()});
 if(!report.available)return report;
 const weeks=new Map();
 for(const g of report.games){
  const m=/^(20\d{2})_(0[1-9]|1[0-8])_/.exec(g.gameId);
  if(m&&Date.parse(g.commenceTime)<clock()&&g.status!=='SCHEDULE_CONFLICT_QUARANTINED')weeks.set(m[1]+':'+m[2],[+m[1],+m[2]]);
 }
 const scopes=[...weeks].slice(-18),reads=[];
 // Bound simultaneous page bodies; the shared feed coalesces matching requests.
 for(let i=0;i<scopes.length;i+=3)reads.push(...await Promise.all(scopes.slice(i,i+3).map(async([key,[season,week]])=>{
  try{return [key,await feed.getWeek(season,week)];}catch{return [key,null];}
 })));
 const byWeek=new Map(reads),now=clock();let officialGradedGames=0;
 for(const g of report.games){
  if(g.status==='SCHEDULE_CONFLICT_QUARANTINED'||Date.parse(g.commenceTime)>=now)continue;
  const [season,week]=g.gameId.split('_'),read=byWeek.get(season+':'+week),r=read?.receipt;
  const observed=Date.parse(r?.observedAt);
  if(!read?.available||r?.schema!==1||r.policy!==OFFICIAL_FINALITY_POLICY||r.season!==+season||r.week!==+week||
   r.sourceUrl!==officialWeeklyUrl(+season,+week)||!Number.isFinite(observed)||observed>now||now-observed>=300000||
   !/^[a-f0-9]{64}$/.test(r.sourceBodySha256)||r.aggregateScoringEligible!==false||!Array.isArray(r.games))continue;
  const matches=r.games.filter(x=>x.gameId===g.gameId);if(matches.length!==1)continue;
  const o=matches[0];
  const conflict=o.home!==g.home||o.away!==g.away||o.season!==+season||o.week!==+week||o.gameDate!==g.gameDate||o.kickoff!==g.commenceTime;
  const final=o.final===true&&o.summaryQuarter==='END_OF_GAME'&&['FINAL','FINAL_OVERTIME'].includes(o.summaryPhase)&&score(o.homeScore)&&score(o.awayScore)&&observed>Date.parse(o.kickoff);
  const withdrawnFinal=o.final===false&&typeof o.summaryPhase==='string'&&!['FINAL','FINAL_OVERTIME'].includes(o.summaryPhase)&&g.status==='GRADED';
  const scoreConflict=final&&g.result&&(g.result.homeScore!==o.homeScore||g.result.awayScore!==o.awayScore);
  if(conflict||scoreConflict||withdrawnFinal){
   g.status='UNGRADED';g.metrics=null;g.reasons.push(conflict?'OFFICIAL_IDENTITY_CONFLICT':withdrawnFinal?'OFFICIAL_FINAL_STATUS_CONFLICT':'OFFICIAL_FINAL_SCORE_CONFLICT');
   g.officialResultCheck={status:'CONFLICT',sourceUrl:r.sourceUrl,observedAt:r.observedAt};continue;
  }
  if(!final||g.status==='GRADED')continue;
  const s=journal.snapshots.find(s=>s.id===g.baselineSnapshotId);
  const eligible=!!s&&isEligibleModelSnapshot(s)&&Date.parse(s.capturedAt)<Date.parse(o.kickoff);
  const outcome=o.homeScore===o.awayScore?'TIE':o.homeScore>o.awayScore?'HOME':'AWAY';
  g.result={homeScore:o.homeScore,awayScore:o.awayScore,outcome,revision:null,verifiedAt:r.observedAt,
   source:'NFL_OFFICIAL_WEEKLY',sourceCorroborated:false,descriptivelyQualified:true,aggregateScoringEligible:false,
   qualificationDetails:{policyId:OFFICIAL_GRADE_POLICY,source:'NFL_OFFICIAL_WEEKLY',label:'Official NFL final score',
    sourceUrl:r.sourceUrl,sourceBodySha256:r.sourceBodySha256,verifiedAt:r.observedAt,descriptivelyQualified:true,
    aggregateScoringEligible:false,sourceIndependenceVerified:false,historicalAsOfVerified:false}};
  g.status=outcome==='TIE'?'TIE_EXCLUDED':eligible?'GRADED':'UNGRADED';
  g.metrics=outcome==='TIE'||!eligible?null:descriptiveForecastMetrics(s,g.result,{scoringEligible:true});
  g.reasons=g.reasons.filter(x=>!['NO_RETAINED_FINAL_RESULT','RESULT_NOT_SOURCE_CORROBORATED'].includes(x));
  g.reasons.push('OFFICIAL_FINAL_DESCRIPTIVE_ONLY');g.hasObservedOfficialFinal=true;
  if(g.status==='GRADED')officialGradedGames++;
 }
 const games=report.games,c=report.coverage;
 Object.assign(c,{gradedGames:games.filter(g=>g.status==='GRADED').length,
  recordedResults:games.filter(g=>g.hasRecordedResult).length,availableFinalScores:games.filter(g=>g.result!==null).length,ungradedGames:games.filter(g=>(g.hasRecordedResult||g.hasObservedOfficialFinal)&&g.status!=='GRADED').length,
  pendingGames:games.filter(g=>!g.hasRecordedResult&&!g.hasObservedOfficialFinal).length,officialGradedGames,
  sourceCorroboratedV2GradedGames:games.filter(g=>g.status==='GRADED'&&g.result.sourceCorroborated).length,
  reviewedBdlGradedGames:games.filter(g=>g.status==='GRADED'&&g.result.qualificationDetails?.policyId==='BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1').length});
 report.generatedAt=new Date(now).toISOString();
 report.officialFinals={readOnly:true,checkedWeeks:reads.length,availableWeeks:reads.filter(([,r])=>r?.available).length,providerCreditsUsed:0};
 report.limitations.notice+=' Official-final grades are a separate descriptive cohort matched to the unchanged original forecast. They do not enter qualified aggregate reports. Official observations are read on request, cached for five minutes, and not saved to the retained journal; these grades are unavailable if the source cannot be read. Current official observations are not evidence of historical source availability. Unavailable or conflicting observations never create a grade.';
 return report;
}
