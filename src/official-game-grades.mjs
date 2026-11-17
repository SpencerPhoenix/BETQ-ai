/** Read-only descriptive finals. Does not write settlements or qualify aggregate evidence. */
import {gradeRetainedGames,descriptiveForecastMetrics} from './game-grading.mjs';
import {latestOfficialResultObservations} from './official-result-ledger.mjs';
import {isEligibleModelSnapshot} from './evidence-integrity.mjs';
import {officialWeeklyUrl,OFFICIAL_FINALITY_POLICY} from './nfl-official-finality.mjs';
export const OFFICIAL_GRADE_POLICY='OFFICIAL_FINAL_DESCRIPTIVE_V1';
const score=n=>Number.isInteger(n)&&n>=0&&n<=100;
export async function gradeGamesWithOfficialFinals(journal,feed,{clock=Date.now,durableLedger=null,durableStatus=null,conflictMemory=new Map()}={}){
 const report=gradeRetainedGames(journal,{now:clock()});
 if(!report.available)return report;
 const unavailable=()=>({schema:1,available:false,researchOnly:true,reason:'DURABLE_RESULT_HISTORY_UNAVAILABLE_OR_INVALID'});
 if(['OFFICIAL_RESULT_LEDGER_INVALID_OR_REWRITTEN','OFFICIAL_RESULT_LEDGER_UNAVAILABLE'].includes(durableStatus?.reason))return unavailable();
 let durable=new Map(),durableValid=false;
 if(durableLedger)try{durable=latestOfficialResultObservations(durableLedger,journal,{now:clock()}).byGame;durableValid=true;}catch{return unavailable();}
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
 if(durableLedger)try{durable=latestOfficialResultObservations(durableLedger,journal,{now}).byGame;}catch{return unavailable();}
 for(const g of report.games){
  if(g.status==='SCHEDULE_CONFLICT_QUARANTINED'||Date.parse(g.commenceTime)>=now)continue;
  const [season,week]=g.gameId.split('_'),liveRead=byWeek.get(season+':'+week),saved=durable.get(g.gameId);
  if(saved&&['BASELINE_CHANGED','IDENTITY_CONFLICT','QUARANTINED'].includes(saved.status)){g.status='UNGRADED';g.metrics=null;g.reasons.push('SAVED_OFFICIAL_'+saved.status);continue;}
  const hold=conflictMemory.get(g.gameId);
  const liveAt=Date.parse(liveRead?.receipt?.observedAt);
  const lr=liveRead?.receipt;
  const liveFresh=liveRead?.available&&lr?.schema===1&&lr.policy===OFFICIAL_FINALITY_POLICY&&lr.season===+season&&lr.week===+week&&lr.sourceUrl===officialWeeklyUrl(+season,+week)&&/^[a-f0-9]{64}$/.test(lr.sourceBodySha256)&&lr.aggregateScoringEligible===false&&Array.isArray(lr.games)&&Number.isFinite(liveAt)&&liveAt<=now&&now-liveAt<300000;
  const newest=Math.max(liveFresh?liveAt:-Infinity,saved?Date.parse(saved.receipt.observedAt):-Infinity);
  if(hold&&newest<=hold.observedAt){g.status='UNGRADED';g.metrics=null;g.reasons.push('PREVIOUSLY_OBSERVED_OFFICIAL_CONFLICT');continue;}
  const useSaved=!!saved&&(!liveFresh||liveAt<Date.parse(saved.receipt.observedAt));
  if(useSaved&&saved.status!=='FINAL'){g.status='UNGRADED';g.metrics=null;g.reasons.push('SAVED_OFFICIAL_'+saved.status);continue;}
  const read=useSaved?{available:true,receipt:saved.receipt}:liveRead,r=read?.receipt;
  const observed=Date.parse(r?.observedAt);
  if(!read?.available||r?.schema!==1||r.policy!==OFFICIAL_FINALITY_POLICY||r.season!==+season||r.week!==+week||
   r.sourceUrl!==officialWeeklyUrl(+season,+week)||!Number.isFinite(observed)||observed>now||(!useSaved&&now-observed>=300000)||
   !/^[a-f0-9]{64}$/.test(r.sourceBodySha256)||r.aggregateScoringEligible!==false||!Array.isArray(r.games))continue;
  const matches=r.games.filter(x=>x.gameId===g.gameId);if(matches.length!==1){if(saved||hold){g.status='UNGRADED';g.metrics=null;g.reasons.push('OFFICIAL_MATCHUP_MISSING');conflictMemory.set(g.gameId,{observedAt:observed});}continue;}
  const o=matches[0];
  const conflict=(saved?.game&&o.providerGameId!==saved.game.providerGameId)||o.home!==g.home||o.away!==g.away||o.season!==+season||o.week!==+week||o.gameDate!==g.gameDate||o.kickoff!==g.commenceTime;
  const final=o.final===true&&o.summaryQuarter==='END_OF_GAME'&&['FINAL','FINAL_OVERTIME'].includes(o.summaryPhase)&&score(o.homeScore)&&score(o.awayScore)&&observed>Date.parse(o.kickoff);
  const withdrawnFinal=o.final===false&&!['FINAL','FINAL_OVERTIME'].includes(o.summaryPhase)&&(g.status==='GRADED'||saved?.status==='FINAL'||hold);
  const scoreConflict=final&&((g.result&&(g.result.homeScore!==o.homeScore||g.result.awayScore!==o.awayScore))||(!useSaved&&saved?.status==='FINAL'&&(saved.game.homeScore!==o.homeScore||saved.game.awayScore!==o.awayScore)));
  if(conflict||scoreConflict||withdrawnFinal){
   g.status='UNGRADED';g.metrics=null;g.reasons.push(conflict?'OFFICIAL_IDENTITY_CONFLICT':withdrawnFinal?'OFFICIAL_FINAL_STATUS_CONFLICT':'OFFICIAL_FINAL_SCORE_CONFLICT');
   conflictMemory.set(g.gameId,{observedAt:observed});
   g.officialResultCheck={status:'CONFLICT',sourceUrl:r.sourceUrl,observedAt:r.observedAt};continue;
  }
  if(final)conflictMemory.delete(g.gameId);
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
  const savedMatch=saved?.status==='FINAL'&&saved.game.homeScore===o.homeScore&&saved.game.awayScore===o.awayScore;
  g.officialPersistence={saved:savedMatch,ledgerEntrySha256:savedMatch?saved.entrySha256:null,recordedAt:savedMatch?saved.recordedAt:null,sourceObservedAt:savedMatch?saved.receipt.observedAt:null,sourceBodySha256:savedMatch?saved.receipt.sourceBodySha256:null,usingSavedObservation:useSaved};
  if(g.status==='GRADED')officialGradedGames++;
 }
 const games=report.games,c=report.coverage;
 Object.assign(c,{gradedGames:games.filter(g=>g.status==='GRADED').length,
  recordedResults:games.filter(g=>g.hasRecordedResult).length,availableFinalScores:games.filter(g=>g.result!==null).length,ungradedGames:games.filter(g=>['UNGRADED','TIE_EXCLUDED'].includes(g.status)).length,quarantinedGames:games.filter(g=>g.status==='SCHEDULE_CONFLICT_QUARANTINED').length,
  pendingGames:games.filter(g=>g.status==='PENDING_RESULT').length,officialGradedGames,
  sourceCorroboratedV2GradedGames:games.filter(g=>g.status==='GRADED'&&g.result.sourceCorroborated).length,
  reviewedBdlGradedGames:games.filter(g=>g.status==='GRADED'&&g.result.qualificationDetails?.policyId==='BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1').length});
 report.generatedAt=new Date(now).toISOString();
 report.officialFinals={readOnly:true,durableLedgerAvailable:durableValid,durableRefreshFailed:durableStatus?.refreshFailed===true,savedGrades:games.filter(g=>g.status==='GRADED'&&g.officialPersistence?.saved).length,checkedWeeks:reads.length,availableWeeks:reads.filter(([,r])=>r?.available).length,providerCreditsUsed:0};
 report.limitations.notice+=' Official-final grades are a separate descriptive cohort matched to the unchanged original forecast. They do not enter qualified aggregate reports. Fresh official observations are read on request and cached for five minutes. Separately saved official result observations can sustain descriptive grades during source outages, with their original observation dates shown. Neither path writes the qualified settlement journal. Current official observations are not evidence of historical source availability. Unavailable or conflicting observations never create a grade.';
 return report;
}
