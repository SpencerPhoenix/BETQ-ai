/** Offline coverage and misses. Existing validators remain the sole grading authority. */
import {gradeRetainedGames} from './game-grading.mjs';
import {gradeGamesWithOfficialFinals,OFFICIAL_GRADE_POLICY} from './official-game-grades.mjs';
import {BDL_REVIEWED_RESULT_POLICY} from './bdl-reviewed-result.mjs';
import {isEligibleMarketSnapshot,isEligibleModelSnapshot,sameFrozenIdentity,validProviderEventId} from './evidence-integrity.mjs';

const confidenceBins=['50_to_under_60','60_to_under_70','70_to_under_80','80_to_100'];
const leadBins=['under_24h','24_to_under_72h','72_to_under_120h','120_to_under_144h','144h_or_more'];
const leadGroup=()=>({values:[],bins:Object.fromEntries(leadBins.map(b=>[b,0]))});
const leadBin=h=>h<24?leadBins[0]:h<72?leadBins[1]:h<120?leadBins[2]:h<144?leadBins[3]:leadBins[4];
const roundHours=h=>Math.round(h*100)/100;
function addLead(group,h){group.values.push(h);group.bins[leadBin(h)]++;}
function summarizeLead({values,bins}){
 const sorted=values.sort((a,b)=>a-b),n=sorted.length;
 return {count:n,medianHours:n?roundHours((sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2):null,bins};
}
const cohortNames=['V2_CORROBORATED','REVIEWED_BDL_DESCRIPTIVE','SAVED_OFFICIAL_DESCRIPTIVE'];
const outcomes=()=>({graded:0,correct:0,incorrect:0,noModelLean:0});
function count(row,correct){
 row.graded++;
 row[correct===null?'noModelLean':correct?'correct':'incorrect']++;
}
function confidence(p){
 // Compare the probability directly to the mirrored interval boundaries.
 return p>=.8||p<=.2?confidenceBins[3]:p>=.7||p<=.3?confidenceBins[2]:p>=.6||p<=.4?confidenceBins[1]:confidenceBins[0];
}
const emptyGroup=()=>({tracked:0,withVisibleFinal:0,withoutVisibleFinal:0,recordedJournalResults:0,withheldRecordedFinal:0,quarantined:0,awaitingKickoff:0,finalMissingAfterKickoff:0,tieExcluded:0,finalUngraded:0,...outcomes()});
function cohort(g){
 if(g.result.sourceCorroborated===true)return cohortNames[0];
 if(g.result.qualificationDetails?.policyId===BDL_REVIEWED_RESULT_POLICY)return cohortNames[1];
 if(g.result.qualificationDetails?.policyId===OFFICIAL_GRADE_POLICY)return cohortNames[2];
 throw Error('UNEXPECTED_DESCRIPTIVE_GRADE_COHORT');
}
function coverageClass(g,now){
 if(g.status==='SCHEDULE_CONFLICT_QUARANTINED')return 'quarantined';
 if(g.status==='TIE_EXCLUDED')return 'tieExcluded';
 if(g.status==='GRADED')return 'graded';
 if(g.result!==null)return 'finalUngraded';
 return Date.parse(g.commenceTime)>now?'awaitingKickoff':'finalMissingAfterKickoff';
}
function addCoverage(row,g,category){
 row.tracked++;
 row[g.result===null?'withoutVisibleFinal':'withVisibleFinal']++;
 if(g.hasRecordedResult){row.recordedJournalResults++;if(g.result===null)row.withheldRecordedFinal++;}
 if(category==='graded')count(row,g.metrics.modelCorrect);
 else row[category]++;
}

const pairGroup=()=>({graded:0,pairs:0,unpaired:0,noFirstSide:0,noLateSide:0,firstCorrect:0,lateCorrect:0,sideFlips:0,firstBrierSum:0,lateBrierSum:0});
const side=p=>p===.5?null:p>.5?'HOME':'AWAY';
const roundScore=n=>Number(n.toFixed(6));
function summarizePairs({firstBrierSum,lateBrierSum,...row}){
 return {...row,firstMeanBrier:row.pairs?roundScore(firstBrierSum/row.pairs):null,
  lateMeanBrier:row.pairs?roundScore(lateBrierSum/row.pairs):null,
  lateMinusFirstMeanBrier:row.pairs?roundScore((lateBrierSum-firstBrierSum)/row.pairs):null};
}
function addPair(row,pair){
 row.graded++;
 if(!pair){row.unpaired++;return;}
 row.pairs++;
 if(pair.firstSide===null)row.noFirstSide++;
 if(pair.lateSide===null)row.noLateSide++;
 if(pair.firstSide===pair.outcome)row.firstCorrect++;
 if(pair.lateSide===pair.outcome)row.lateCorrect++;
 if(pair.firstSide&&pair.lateSide&&pair.firstSide!==pair.lateSide)row.sideFlips++;
 row.firstBrierSum+=pair.firstBrier;row.lateBrierSum+=pair.lateBrier;
}
function pairedTiming(first,shots,g,week,resultCohort){
 if(!validProviderEventId(first?.providerEventId))return null;
 const kickoff=Date.parse(first.commenceTime),start=kickoff-90*60000,end=kickoff-45*60000;
 const firstAt=Date.parse(first.capturedAt);
 if(firstAt>=start)return null;
 let later=null;
 for(const s of shots){
  const at=Date.parse(s.capturedAt);
  if(at<start||at>end||at<=firstAt||!sameFrozenIdentity(first,s)||s.providerEventId!==first.providerEventId||!isEligibleModelSnapshot(s))continue;
  if(!later||s.capturedAt>later.capturedAt||(s.capturedAt===later.capturedAt&&s.id<later.id))later=s;
 }
 if(!later)return null;
 const p=first.modelHomeProbability,q=later.modelHomeProbability,outcome=g.result.outcome,y=outcome==='HOME'?1:0;
 return {gameId:g.gameId,week,cohort:resultCohort,outcome,firstSnapshotId:first.id,lateSnapshotId:later.id,
  firstCapturedAt:first.capturedAt,lateCapturedAt:later.capturedAt,firstHomeProbability:p,lateHomeProbability:q,
  firstSide:side(p),lateSide:side(q),firstBrier:(p-y)**2,lateBrier:(q-y)**2};
}

export async function auditDescriptiveGrades(journal,{officialLedger=null,now=Date.now()}={}){
 if(!Number.isFinite(now))throw Error('INVALID_AUDIT_CLOCK');
 const grades=officialLedger===null?gradeRetainedGames(journal,{now}):await gradeGamesWithOfficialFinals(
  journal,{getWeek:async()=>({available:false})},{clock:()=>now,durableLedger:officialLedger});
 if(!grades.available)throw Error(grades.reason);
 const snapshots=new Map(journal.snapshots.map(s=>[s.id,s]));
 const gameSnapshots=new Map();
 for(const s of journal.snapshots){
  if(!gameSnapshots.has(s.gameId))gameSnapshots.set(s.gameId,[]);
  gameSnapshots.get(s.gameId).push(s);
 }
 const pairOverall=pairGroup(),pairWeeks={},pairs=[];
 const overall=emptyGroup(),weeks={},coverageReasons={},misses=[];
 const cohorts=Object.fromEntries(cohortNames.map(k=>[k,{...outcomes(),confidenceBins:Object.fromEntries(confidenceBins.map(b=>[b,outcomes()]))}]));
 const allGradedLead=leadGroup(),missLead=leadGroup();
 const marketEvidence={separateFromForecastGrades:true,firstSnapshotEligible:0,gradedForecastsWithEligibleMarketSnapshot:0,marketPerformanceReported:false};
 for(const g of grades.games){
  const pattern=/^(20\d{2})_(0[1-9]|1[0-8])_/.exec(g.gameId);
  const week=pattern?`${pattern[1]}-W${pattern[2]}`:'UNKNOWN_WEEK';
  const weekly=weeks[week]??=emptyGroup(),category=coverageClass(g,now);
  addCoverage(overall,g,category);addCoverage(weekly,g,category);
  if(category!=='graded')for(const reason of g.reasons){
   if(reason==='MISSING_REQUIRED_MARKET_PROVENANCE')continue; // Market input is not a grading blocker.
   coverageReasons[reason]=(coverageReasons[reason]??0)+1;
  }
  const marketEligible=category!=='quarantined'&&isEligibleMarketSnapshot(snapshots.get(g.baselineSnapshotId));
  if(marketEligible)marketEvidence.firstSnapshotEligible++;
  if(category!=='graded')continue;
  if(marketEligible)marketEvidence.gradedForecastsWithEligibleMarketSnapshot++;
  const key=cohort(g),p=g.modelHomeProbability,b=confidence(p);
  const pair=pairedTiming(snapshots.get(g.baselineSnapshotId),gameSnapshots.get(g.gameId),g,week,key);
  addPair(pairOverall,pair);addPair(pairWeeks[week]??=pairGroup(),pair);
  if(pair)pairs.push({...pair,firstBrier:roundScore(pair.firstBrier),lateBrier:roundScore(pair.lateBrier)});
  count(cohorts[key],g.metrics.modelCorrect);count(cohorts[key].confidenceBins[b],g.metrics.modelCorrect);
  const hours=(Date.parse(g.commenceTime)-Date.parse(g.capturedAt))/3600000;
  if(!Number.isFinite(hours)||hours<=0)throw Error('INVALID_BASELINE_LEAD_TIME');
  addLead(allGradedLead,hours);
  if(g.metrics.modelCorrect===false)addLead(missLead,hours);
  if(g.metrics.modelCorrect===false)misses.push({gameId:g.gameId,week,cohort:key,confidenceBin:b,
   baselineSnapshotId:g.baselineSnapshotId,capturedAt:g.capturedAt,commenceTime:g.commenceTime,modelVersion:g.modelVersion,
   captureLeadHours:roundHours(hours),captureLeadBin:leadBin(hours),
   pick:p>.5?g.home:g.away,originalModelHomeProbability:p,originalPickProbability:p>.5?p:1-p,
   winner:g.result.outcome==='HOME'?g.home:g.away,awayScore:g.result.awayScore,homeScore:g.result.homeScore,
   resultObservedAt:g.result.verifiedAt,resultSource:g.result.source});
 }
 return {schema:1,scope:'RETAINED_NFL_FIRST_FROZEN_FORECASTS',generatedAt:new Date(now).toISOString(),
  officialLedgerSupplied:officialLedger!==null,overall,weeks:Object.fromEntries(Object.entries(weeks).sort(([a],[b])=>a.localeCompare(b))),
  cohorts,coverageReasons,misses,marketEvidence,
  pairedTiming:{researchOnly:true,eligibleForPromotion:false,lateCaptureWindowMinutesBeforeKickoff:{earliest:90,latest:45,inclusive:true},
   overall:summarizePairs(pairOverall),weeks:Object.fromEntries(Object.entries(pairWeeks).sort(([a],[b])=>a.localeCompare(b)).map(([week,c])=>[week,summarizePairs(c)])),pairs,
   notice:'Matched descriptive subset only. First capture must strictly precede the window. Missing, conflicted and ungraded records produce no pair. Capture availability selects the sample; timing, information and model artifacts may differ. This comparison is not causal evidence or a promotion gate.'},
  captureLeadTime:{graded:summarizeLead(allGradedLead),misses:summarizeLead(missLead)},
  limitations:{leagueWideCompletenessVerified:false,independentOutcomeVerificationPerformed:false,historicalAsOfVerified:false,
   causalDiagnosisPerformed:false,aggregatePerformanceClaim:false,marketEdgeVerified:false,providerRequests:0,paidOddsRequests:0,
   notices:['Counts describe only the supplied retained records. The sample and confidence bins may be small, incomplete, or selected.',
    'Outcome sources are shown separately. Combined counts are coverage, not a validated estimate of predictive performance.',
    'A missed call identifies the first frozen pick and observed outcome, not the reason it lost. Capture lead time is descriptive and does not show what caused a miss.',
    'Without a saved result ledger, official-only grades are not available here. An absent eligible final is not a loss. Past kickoff does not imply a game has finished. A recorded final can be withheld from display.',
    'Market coverage is separate; this report does not measure market edge, closing-line value, or ROI.']}};
}
