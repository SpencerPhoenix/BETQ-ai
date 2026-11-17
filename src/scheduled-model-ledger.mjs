/** Append-only separate model-only study. No market qualification or independent timestamp claim. */
import {isDeepStrictEqual} from 'node:util';
import {receiptDigest,freezeModelOnlyReceipt,assertModelOnlyReceipt} from './model-only-receipt.mjs';
import {gameScope} from './on-demand-game.mjs';
import {officialWeeklyUrl} from './nfl-official-finality.mjs';
export const LEDGER_POLICY=Object.freeze({name:'BETQ_SCHEDULED_MODEL_ONLY_V1',windowOpenMinutes:90,windowCloseMinutes:45,firstReservationOnly:true,marketEvidenceEligible:false,upstreamIndependenceVerified:false});
export const NFLVERSE_SCHEDULE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const instant=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const fail=()=>{throw Error('MODEL_LEDGER_INVALID');};
const types=new Set(['RUN','RESERVED','MISSED','CAPTURED','CAPTURE_FAILED','CUSTODY','FINAL','RESULT_CONFLICT']);
export function emptyModelLedger(now){return {schema:1,policy:{...LEDGER_POLICY},createdAt:new Date(now).toISOString(),artifacts:{},events:[]};}
export function ledgerEvent(ledger,type,gameId,payload,at){
 const body={type,gameId:gameId??null,at:new Date(at).toISOString(),payload},event={...body,id:receiptDigest(body)};
 if(!ledger.events.some(e=>e.id===event.id))ledger.events.push(event);return event;
}
const first=(l,type,id)=>l.events.find(e=>e.type===type&&e.gameId===id);
const reservation=(l,id)=>first(l,'RESERVED',id);
function validOfficial(g){
 const {season,week}=gameScope(g?.gameId);
 return g.season===season&&g.week===week&&typeof g.providerGameId==='string'&&g.providerGameId.length>0&&g.providerGameId.length<100&&instant(g.kickoff)&&
  g.gameId===`${season}_${String(week).padStart(2,'0')}_${g.away}_${g.home}`&&typeof g.neutralSite==='boolean';
}
export function sameOfficialFinal(a,b){return ['gameId','providerGameId','kickoff','home','away','neutralSite','gameDate','homeScore','awayScore','final','summaryPhase'].every(k=>a?.[k]===b?.[k]);}
export function validateModelLedger(l){
 if(l?.schema!==1||!isDeepStrictEqual(l.policy,LEDGER_POLICY)||!instant(l.createdAt)||!Array.isArray(l.events)||l.events.length>20000||!l.artifacts||Object.keys(l.artifacts).length>1000)fail();
 const ids=new Set(),seen=new Map();
 for(const [hash,artifact] of Object.entries(l.artifacts))if(hash!==receiptDigest(artifact))fail();
 for(const e of l.events){
  const {id,...body}=e;if(!types.has(e.type)||!instant(e.at)||Date.parse(e.at)<Date.parse(l.createdAt)||id!==receiptDigest(body)||ids.has(id))fail();ids.add(id);
  if(e.type==='RUN'){if(e.gameId!==null||!Array.isArray(e.payload.failedWeeks)||typeof e.payload.runKey!=='string')fail();continue;}
  gameScope(e.gameId);const p=e.payload,prior=seen.get(e.gameId)||{};
  if(e.type==='RESERVED'){
   if(prior.RESERVED||prior.MISSED||!validOfficial(p.game)||p.game.gameId!==e.gameId||!/^\d+\.\d+$/.test(p.runKey))fail();
   if(p.source?.url!==officialWeeklyUrl(p.game.season,p.game.week)||!instant(p.source.observedAt)||Date.parse(p.source.observedAt)>Date.parse(e.at)||Date.parse(e.at)-Date.parse(p.source.observedAt)>=300000||!/^[a-f0-9]{64}$/.test(p.source.bodySha256))fail();
   const minutes=(Date.parse(p.game.kickoff)-Date.parse(e.at))/60000;
   if(minutes<45||minutes>90||p.game.final||p.game.scheduleStatus!=='SCHEDULED'||p.game.summaryPhase!=='PREGAME')fail();
  }
  if(e.type==='MISSED'&&!['WINDOW_ELAPSED','POLICY_STARTED_AFTER_WINDOW','RESERVATION_UNRESOLVED'].includes(p.reason))fail();
  if(e.type==='CAPTURE_FAILED'&&(!prior.RESERVED||p.reservationId!==prior.RESERVED.id||prior.CAPTURED))fail();
  if(e.type==='CAPTURED'){
   if(!prior.RESERVED||prior.CAPTURED||prior.CAPTURE_FAILED||p.reservationId!==prior.RESERVED.id)fail();
   const r=p.record,art=l.artifacts[p.artifactKey],chall=p.challengerKey?l.artifacts[p.challengerKey]:undefined;
   assertModelOnlyReceipt(r,{artifact:art,challengerArtifact:chall});
   if(r.response.fixture.providerGameId!==prior.RESERVED.payload.game.providerGameId||r.response.fixture.neutralSite!==prior.RESERVED.payload.game.neutralSite||r.gameId!==e.gameId||r.kickoff!==prior.RESERVED.payload.game.kickoff||r.receivedAt!==e.at||Date.parse(r.requestStartedAt)<Date.parse(prior.RESERVED.at)||
    Date.parse(r.receivedAt)>Date.parse(r.kickoff)-45*60000)fail();
  }
  if(e.type==='CUSTODY'){
   const c=prior.CAPTURED;if(!c||prior.CUSTODY||p.captureId!==c.id||!/^[a-f0-9]{40}$/.test(p.remoteCommit)||
    p.assurance!=='OPERATOR_OBSERVED_AUTHENTICATED_GITHUB_READBACK'||p.timestampBasis!=='GITHUB_DATE_UPPER_BOUND_1S'||
    !instant(p.remoteObservedAt)||e.at!==p.remoteObservedAt||Date.parse(e.at)<Date.parse(c.at)||Date.parse(e.at)>=Date.parse(c.payload.record.kickoff))fail();
  }
  if(e.type==='RESULT_CONFLICT'&&(!prior.CUSTODY||!['FINAL_SOURCES_DISAGREE_OR_MISSING','FINAL_IDENTITY_OR_KICKOFF_CONFLICT','OFFICIAL_FINAL_STATE_WITHDRAWN'].includes(p.reason)))fail();
  if(e.type==='FINAL'){
   const g=p.officialGame,r=prior.RESERVED;if(!prior.CUSTODY||!r||!validOfficial(g)||!g.final||g.gameId!==e.gameId||
    g.providerGameId!==r.payload.game.providerGameId||g.kickoff!==r.payload.game.kickoff||g.home!==r.payload.game.home||g.away!==r.payload.game.away||g.neutralSite!==r.payload.game.neutralSite||
    !Number.isInteger(g.homeScore)||!Number.isInteger(g.awayScore)||g.homeScore<0||g.awayScore<0||g.homeScore>100||g.awayScore>100||Date.parse(e.at)<=Date.parse(g.kickoff)||
    p.nflverse?.url!==NFLVERSE_SCHEDULE||p.nflverse.gameId!==e.gameId||p.nflverse.home!==g.home||p.nflverse.away!==g.away||p.nflverse.homeScore!==g.homeScore||p.nflverse.awayScore!==g.awayScore||p.nflverse.date!==g.gameDate||
    !/^[a-f0-9]{64}$/.test(p.nflverse.bodySha256)||!instant(p.nflverse.receivedAt)||!instant(p.officialSource?.observedAt)||Date.parse(p.officialSource.observedAt)>Date.parse(e.at)||Date.parse(p.nflverse.receivedAt)>Date.parse(e.at)||
    p.officialSource.url!==officialWeeklyUrl(g.season,g.week)||!/^[a-f0-9]{64}$/.test(p.officialSource.bodySha256))fail();
  }
  prior[e.type]=e;seen.set(e.gameId,prior);
 }
 return l;
}
export function assertLedgerAppend(previous,next){
 validateModelLedger(previous);validateModelLedger(next);
 if(previous.createdAt!==next.createdAt||next.events.length<previous.events.length||previous.events.some((e,i)=>!isDeepStrictEqual(e,next.events[i]))||Object.entries(previous.artifacts).some(([k,v])=>!isDeepStrictEqual(v,next.artifacts[k])))throw Error('MODEL_LEDGER_HISTORY_CHANGED');
}
export function reserveModelGames(ledger,officialReceipts,{now,runKey,failedWeeks=[]}){
 validateModelLedger(ledger);if(!/^\d+\.\d+$/.test(runKey))fail();const next=structuredClone(ledger);
 ledgerEvent(next,'RUN',null,{runKey,failedWeeks},now);
 for(const receipt of officialReceipts){
  if(!instant(receipt.observedAt)||Date.parse(receipt.observedAt)>now||now-Date.parse(receipt.observedAt)>=300000)continue;
  for(const game of receipt.games){
   if(!validOfficial(game))continue;const at=Date.parse(game.kickoff),minutes=(at-now)/60000,id=game.gameId,old=reservation(next,id);
   if(at<now-7*86400000||at>now+7*86400000)continue;
   if(old){if(old.payload.runKey!==runKey&&!first(next,'CAPTURED',id)&&!first(next,'CAPTURE_FAILED',id)&&!first(next,'MISSED',id))ledgerEvent(next,'MISSED',id,{kickoff:old.payload.game.kickoff,reason:'RESERVATION_UNRESOLVED'},now);continue;}
   if(minutes<45){if(!first(next,'MISSED',id))ledgerEvent(next,'MISSED',id,{kickoff:game.kickoff,reason:at-45*60000<Date.parse(next.createdAt)?'POLICY_STARTED_AFTER_WINDOW':'WINDOW_ELAPSED'},now);continue;}
   if(first(next,'MISSED',id)||minutes>90||game.final||game.scheduleStatus!=='SCHEDULED'||game.summaryPhase!=='PREGAME')continue;
   ledgerEvent(next,'RESERVED',id,{runKey,game,source:{url:receipt.sourceUrl,observedAt:receipt.observedAt,bodySha256:receipt.sourceBodySha256}},now);
  }
 }
 assertLedgerAppend(ledger,next);return next;
}
export function appendModelCapture(ledger,gameId,response,{artifact,challengerArtifact,requestStartedAt,receivedAt,runKey}){
 validateModelLedger(ledger);const res=reservation(ledger,gameId);
 if(!res||res.payload.runKey!==runKey||first(ledger,'CAPTURED',gameId)||first(ledger,'CAPTURE_FAILED',gameId))throw Error('CAPTURE_RESERVATION_UNAVAILABLE');
 const record=freezeModelOnlyReceipt(response,{artifact,challengerArtifact,requestStartedAt,receivedAt});
 const next=structuredClone(ledger),artifactKey=receiptDigest(artifact),challengerKey=challengerArtifact?receiptDigest(challengerArtifact):null;
 next.artifacts[artifactKey]=structuredClone(artifact);if(challengerKey)next.artifacts[challengerKey]=structuredClone(challengerArtifact);
 ledgerEvent(next,'CAPTURED',gameId,{reservationId:res.id,record,artifactKey,challengerKey},Date.parse(receivedAt));assertLedgerAppend(ledger,next);return next;
}
export function confirmModelPublication(ledger,{remoteCommit,serverDate,now=Date.now()}){
 validateModelLedger(ledger);const raw=Date.parse(serverDate),observed=raw+1000;
 if(!/^[a-f0-9]{40}$/.test(remoteCommit)||!Number.isFinite(raw)||observed>now+1500||now-raw>120000)throw Error('REMOTE_READBACK_TIME_INVALID');
 const next=structuredClone(ledger);
 for(const e of ledger.events.filter(e=>e.type==='CAPTURED')){
  if(first(ledger,'CUSTODY',e.gameId)||observed<Date.parse(e.at)||observed>=Date.parse(e.payload.record.kickoff))continue;
  ledgerEvent(next,'CUSTODY',e.gameId,{captureId:e.id,remoteCommit,remoteObservedAt:new Date(observed).toISOString(),assurance:'OPERATOR_OBSERVED_AUTHENTICATED_GITHUB_READBACK',timestampBasis:'GITHUB_DATE_UPPER_BOUND_1S'},observed);
 }
 assertLedgerAppend(ledger,next);return next;
}
export function modelLedgerSummary(ledger,now=Date.now()){
 validateModelLedger(ledger);const lastRun=ledger.events.filter(e=>e.type==='RUN').at(-1);const gameIds=[...new Set(ledger.events.filter(e=>e.gameId).map(e=>e.gameId))];
 const games=gameIds.map(gameId=>{
  const res=reservation(ledger,gameId),capture=first(ledger,'CAPTURED',gameId),custody=first(ledger,'CUSTODY',gameId),finals=ledger.events.filter(e=>e.type==='FINAL'&&e.gameId===gameId),final=finals.at(-1),missed=first(ledger,'MISSED',gameId),failed=first(ledger,'CAPTURE_FAILED',gameId);
  const latestConflict=ledger.events.filter(e=>e.type==='RESULT_CONFLICT'&&e.gameId===gameId).at(-1);
  const conflict=latestConflict&&(!final||ledger.events.indexOf(latestConflict)>ledger.events.indexOf(final));
  const status=conflict?'RESULT_CONFLICT_GRADE_WITHHELD':final?'PROVISIONAL_TWO_SOURCE_GRADE':custody?(now-Date.parse(res.payload.game.kickoff)>14*86400000?'MANUAL_RESULT_RECONCILIATION_REQUIRED':'REMOTE_PREGAME_CUSTODY_RECORDED'):capture?'CAPTURED_CUSTODY_UNCONFIRMED':failed?'CAPTURE_FAILED':missed?missed.payload.reason:res?'RESERVED_AWAITING_CAPTURE':'UNKNOWN';
  let grade=null;if(final&&custody&&!conflict){const g=final.payload.officialGame,p=capture.payload.record.response.baseline.homeWinProbability,tie=g.homeScore===g.awayScore,outcome=g.homeScore>g.awayScore?1:0;
   grade={homeScore:g.homeScore,awayScore:g.awayScore,tie,pickWon:tie||p===.5?null:(p>.5)===(outcome===1),brier:tie?null:(p-outcome)**2,logLoss:tie?null:-Math.log(outcome?p:1-p),qualification:'PROVISIONAL_ONLY_UPSTREAM_INDEPENDENCE_NOT_VERIFIED',revisions:finals.length};}
  return {gameId,kickoff:res?.payload.game.kickoff??missed?.payload.kickoff??null,status,captureId:capture?.payload.record.id??null,forecastEvaluatedAt:capture?.payload.record.forecastEvaluatedAt??null,homeWinProbability:capture?.payload.record.response.baseline.homeWinProbability??null,custody: custody?.payload??null,grade};
 });
 return {schema:1,policy:LEDGER_POLICY.name,generatedAt:new Date(now).toISOString(),lastRunAt:lastRun?.at??null,schedulerStale:!lastRun||now-Date.parse(lastRun.at)>30*60000,
  latestFailedWeeks:lastRun?.payload.failedWeeks??[],productionCompatible:lastRun?.payload.productionCompatible??null,finalSourceAvailable:lastRun?.payload.finalSourceAvailable??null,resultConflicts:lastRun?.payload.resultConflicts??[],games,marketEvidenceEligible:false,qualifiedScoringEligible:false,verifiedCLV:null,verifiedROI:null,completeLeagueCoverageVerified:false};
}
