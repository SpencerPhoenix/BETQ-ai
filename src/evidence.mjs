import {validProjectionDelivery} from './model-delivery.mjs';
/**
 * Phase 3 forward evidence. Only independent model forecasts and aggregated
 * no-vig consensus are stored. Raw odds/bookmaker identities are never stored.
 * Forecast snapshots are immutable; verified results have revision history.
 */
import {OUTCOME_SCORING_POLICY,isSourceCorroboratedSettlement,latestSettlementsByRevision,unambiguousFrozenGameIds} from './settlement-qualification.mjs';
import {pairedWeekBootstrap} from './statistical-audit.mjs';
import {isProbability, validDay} from './integrity.mjs';
import {validSnapshotChronology,validFrozenIdentity,sameFrozenIdentity,isEligibleModelSnapshot,isEligibleMarketSnapshot,isEligibleChallengerSnapshot,validNewFinalResult,FINAL_RECEIPT_BINDING_POLICY,MARKET_FRESHNESS_POLICY,validProviderEventId,providerContinuityConflicts} from './evidence-integrity.mjs';
import { createHash } from 'node:crypto';
import { NFL_TEAMS, canonicalTeam } from './nfl-elo.mjs';
import {scheduledInstant,scheduleReviewFor} from './schedule-review.mjs';
import {validateRetainedIdentityState,scheduleQuarantineMetadata} from './retained-schedule-quarantine.mjs';
import {assessFutureMarketCapture,summarizeDerivedMarketObservations} from './market-capture-diagnostics.mjs';

export const MIN_SAMPLE = 30;
const round = (n,d=5) => Number.isFinite(n)?Number(n.toFixed(d)):null;
const parsed = x => Date.parse(x||'');
const hash = s => createHash('sha256').update(s).digest('hex').slice(0,24);
const gameTypes = new Set(['REG','WC','DIV','CON','SB']);
const clamp = p => Math.max(1e-6,Math.min(1-1e-6,p));
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;

export function emptyJournal(season) {
  if (!Number.isInteger(season)||season<2020||season>2100) throw Error('Invalid season');
  return {schema:1,season,sport:'americanfootball_nfl',
    provenance:{model:'BETQ_NFL_ELO',market:'THE_ODDS_API_V4_DERIVED',
      results:'NFLVERSE_SCHEDULES_CC_BY_4_0'},
    snapshots:[],settlements:[]};
}
export function validateJournal(j) {
  if (!j||j.schema!==1||j.sport!=='americanfootball_nfl'||!Number.isInteger(j.season)||
      !Array.isArray(j.snapshots)||!Array.isArray(j.settlements)||
      j.snapshots.length>10000||j.settlements.length>1000) throw Error('Invalid journal');
  const ids=new Set();
  for(const s of j.snapshots){
    if(!validObservation(s,j.season)||ids.has(s.id))throw Error('Invalid journal observation');
    ids.add(s.id);
  }
  for(const r of j.settlements)if(!validResult(r))throw Error('Invalid journal result');
  return j;
}
function validObservation(s,season){
  if(!s||typeof s.id!=='string'||typeof s.gameId!=='string'||s.season!==season||!isProbability(s.modelHomeProbability))return false;
  if(!validSnapshotChronology(s))return false;
  if(s.marketHomeProbability!=null&&!isProbability(s.marketHomeProbability))return false;
  if(s.challengerHomeProbability!=null&&(!isProbability(s.challengerHomeProbability)||s.challengerResearchOnly!==true||
     s.challengerBuiltAt==null))return false;
  return true;
}
function validResult(r){
  return Boolean(r&&typeof r.gameId==='string'&&
    [r.homeScore,r.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=100)&&
    r.outcome===(r.homeScore===r.awayScore?'TIE':r.homeScore>r.awayScore?'HOME':'AWAY'));
}

export function matchSchedule(event,rows,season) {
  if (!event || !Array.isArray(rows)) return null;
  const home=NFL_TEAMS[event.homeTeam],away=NFL_TEAMS[event.awayTeam],kick=scheduledInstant(event.commenceTime);
  if (!home||!away||!Number.isFinite(kick)||home===away) return null;
  const matches=rows.filter(r => r && Number(r.season)===season&&gameTypes.has(r.game_type)&&
    canonicalTeam(r.home_team)===home&&canonicalTeam(r.away_team)===away&&
    r.game_id&&validDay(r.gameday)&&
    Math.abs(kick-parsed(r.gameday+'T12:00:00Z'))<=36*3600000
  ).sort((a,b)=>Math.abs(kick-parsed(a.gameday+'T12:00:00Z'))-
                 Math.abs(kick-parsed(b.gameday+'T12:00:00Z')));
  if(matches.length>1) return null;
  return matches[0]||null;
}

export function observationsFromSlate(slate,rows,now=Date.now(),season=new Date(now).getUTCFullYear()) {
  if (slate?.demo!==false||slate.source!=='THE_ODDS_API_V4'||
      slate.sport!=='americanfootball_nfl'||slate.market!=='h2h'||
      !Array.isArray(slate.events)||!Array.isArray(rows)) throw Error('Real NFL moneylines only');
  const received=parsed(slate.receivedAt);
  if (!Number.isFinite(received)||received>now+60000||now-received>10*60000)
    throw Error('Provider snapshot timestamp stale');
  const accepted=[],skipped=[],marketObservations=[];
  for(const event of slate.events) {
    if(!event || typeof event!=='object') { skipped.push({reason:'INVALID_EVENT'});continue; }
    if(!validProviderEventId(event.id)){skipped.push({eventId:'',reason:'INVALID_PROVIDER_EVENT_ID'});continue;}
    const kick=scheduledInstant(event.commenceTime),m=event.independentModel;
    if (!Number.isFinite(kick)||kick-now<5*60000||kick-now>14*86400000||
        m?.available!==true||m.method!=='NFL_ELO_HISTORICAL_OUTCOMES'||
        !m.independentOfOdds||m.use!=='RESEARCH_ONLY'||
        !Number.isFinite(m.homeWinProbability)||m.homeWinProbability<=0||
        m.homeWinProbability>=1||!Number.isFinite(parsed(m.modelBuiltAt))||
        parsed(m.modelBuiltAt)>now+60000) {
      skipped.push({eventId:String(event.id||''),reason:'PREGAME_MODEL_GATE'});continue;
    }
    if((m.deliveryIdentity!=null||slate.nflModelDelivery!=null)&&!validProjectionDelivery(m,slate.nflModelDelivery)){
      skipped.push({eventId:event.id,reason:'MODEL_DELIVERY_BINDING_INVALID'});continue;
    }
    const row=matchSchedule(event,rows,season);
    if(!row){skipped.push({eventId:String(event.id||''),reason:'NO_UNIQUE_SCHEDULE_MATCH'});continue;}
    const c=event.marketConsensus;
    const marketObservation=assessFutureMarketCapture(c,{capturedAt:new Date(now).toISOString(),
      sourceReceivedAt:slate.receivedAt,commenceTime:new Date(kick).toISOString()});
    const validMarket=marketObservation.eligible;
    const cModel=event.efficiencyChallenger;
    const validChallenger=cModel?.available===true &&
      cModel.independentOfOdds===true && cModel.researchOnly===true &&
      cModel.automaticSelection===false &&
      typeof cModel.modelVersion==='string' && cModel.modelVersion.length<60 &&
      Number.isFinite(cModel.homeWinProbability) &&
      cModel.homeWinProbability>0 && cModel.homeWinProbability<1 &&
      Number.isFinite(parsed(cModel.generatedAt)) &&
      parsed(cModel.generatedAt)<=now+60000 &&
      parsed(cModel.generatedAt)<kick;
    const window=kick-now<=90*60000?'NEAR_KICKOFF':'DAILY';
    // A new independent model may enter the research journal later on the
    // same day without rewriting previously frozen Elo-only observations.
    const key=[season,row.game_id,new Date(now).toISOString().slice(0,10),window];
    if(validChallenger)key.push('CHALLENGER:'+cModel.modelVersion);
    const id=hash(key.join('|'));
    const snapshot={
      id,gameId:row.game_id,providerEventId:String(event.id),
      season,home:canonicalTeam(row.home_team),away:canonicalTeam(row.away_team),
      gameDate:row.gameday,commenceTime:new Date(kick).toISOString(),
      capturedAt:new Date(now).toISOString(),sourceReceivedAt:new Date(received).toISOString(),
      window,hoursBeforeKickoff:round((kick-now)/3600000,2),
      modelVersion:String(m.modelVersion),modelBuiltAt:m.modelBuiltAt,
      modelArtifactCanonicalSha256:m.deliveryIdentity?.artifactCanonicalSha256??null,
      modelDeliveryPolicy:m.deliveryIdentity?.policy??null,
      modelLastResultDate:m.throughGameDate,
      modelHomeProbability:round(m.homeWinProbability,6),
      challengerHomeProbability:validChallenger?
        round(cModel.homeWinProbability,6):null,
      challengerModelVersion:validChallenger?cModel.modelVersion:null,
      challengerBuiltAt:validChallenger?cModel.generatedAt:null,
      challengerResearchOnly:true,
      marketHomeProbability:validMarket?round(c.homeProbability,6):null,
      marketBookCount:validMarket?c.books:0,
      marketDisagreementPoints:validMarket?c.disagreementPoints:null,
      marketNewestQuoteAt:validMarket?c.latestQuoteAt:null,
      marketOldestQuoteAt:validMarket?c.oldestQuoteAt:null,
      marketBasis:validMarket?'NO_VIG_MULTI_BOOK_MEDIAN':'UNAVAILABLE',
      independentModel:true,researchOnly:true,verifiedInjuryAdjustment:false
    };
    if(!validObservation(snapshot,season)||!isEligibleModelSnapshot(snapshot)){
      skipped.push({eventId:String(event.id||''),reason:'INVALID_FORECAST_PROVENANCE'});continue;
    }
    // Recompute the dated local review from the observed identity. Caller-supplied
    // slate flags cannot authorize new captures against a known stale schedule.
    if(scheduleReviewFor(snapshot,now).status==='SCHEDULE_RECONCILIATION_REQUIRED'){
      skipped.push({eventId:String(event.id||''),reason:'SCHEDULE_RECONCILIATION_REQUIRED'});continue;
    }
    accepted.push(snapshot);
    marketObservations.push(marketObservation);
  }
  return {accepted,skipped,marketDiagnostics:summarizeDerivedMarketObservations(marketObservations)};
}

/**
 * Quarantine a conflicting game's whole capture batch before daily-ID deduplication.
 * This is not schedule reconciliation: no time tolerance, identity merge or rewrite.
 * Malformed input and non-schedule identity corruption remain hard failures. Reason
 * counts describe affected captures; one capture can have more than one reason.
 * Same-ID recaptures of the same frozen identity are routine duplicates, even
 * when receipt times or quotes change. The writer keeps the first record intact.
 */
export function prepareCaptureAdmission(existing,captures,now=Date.now()) {
  validateJournal(existing);
  if(!Array.isArray(captures)||captures.length>10000||!Number.isFinite(now))
    throw Error('Invalid capture admission input');
  const byGame=new Map(),byId=new Map(),conflicts=new Map();
  const reasonOrder=['FROZEN_GAME_IDENTITY_CONFLICT','SNAPSHOT_ID_PAYLOAD_CONFLICT',
    'PROVIDER_EVENT_ID_UNVERIFIED','PROVIDER_EVENT_ID_CHANGED','PROVIDER_EVENT_ID_REUSED'];
  const mark=(gameId,reason)=>{
    if(!conflicts.has(gameId))conflicts.set(gameId,new Set());
    conflicts.get(gameId).add(reason);
  };
  let retainedSchedules;
  try{retainedSchedules=validateRetainedIdentityState(existing,now).schedules;}
  catch(error){
    if(error?.message==='INVALID_RETAINED_GAME_IDENTITY')throw Error('Invalid/conflicting retained frozen identity');
    throw error;
  }
  for(const gameId of retainedSchedules.blocked)mark(gameId,'FROZEN_GAME_IDENTITY_CONFLICT');
  for(const s of existing.snapshots){
    if(!validFrozenIdentity(s)||(byGame.has(s.gameId)&&!sameFrozenIdentity(byGame.get(s.gameId),s)&&!retainedSchedules.blocked.has(s.gameId)))
      throw Error('Invalid/conflicting retained frozen identity');
    if(!byGame.has(s.gameId))byGame.set(s.gameId,s);
    byId.set(s.id,s);
  }
  // Do not disguise contradictory retained results as an ordinary capture skip.
  latestSettlementsByRevision(existing.settlements);
  const captureFloor=existing.snapshots.reduce((max,s)=>Math.max(max,parsed(s.capturedAt)),-Infinity);
  for(const s of captures){
    if(!validObservation(s,existing.season)||!s.id||s.id.length>200||
       !validFrozenIdentity(s)||!isEligibleModelSnapshot(s)||parsed(s.capturedAt)>now+60000)
      throw Error('Invalid/future/post-kickoff capture admission');
    if(!byId.has(s.id)&&(parsed(s.capturedAt)<captureFloor||existing.snapshots.some(old=>
      old.gameId===s.gameId&&old.capturedAt===s.capturedAt&&
      (s.id<old.id||s.id.localeCompare(old.id)<0))))throw Error('Backdated capture admission');
    const game=byGame.get(s.gameId),previous=byId.get(s.id);
    if(game&&!sameFrozenIdentity(game,s))mark(s.gameId,'FROZEN_GAME_IDENTITY_CONFLICT');
    if(previous&&!sameFrozenIdentity(previous,s)){
      mark(previous.gameId,'SNAPSHOT_ID_PAYLOAD_CONFLICT');
      mark(s.gameId,'SNAPSHOT_ID_PAYLOAD_CONFLICT');
    }
    if(!game)byGame.set(s.gameId,s);
    if(!previous)byId.set(s.id,s);
  }
  for(const [gameId,reasons] of providerContinuityConflicts([...existing.snapshots,...captures]))
    for(const reason of reasons)mark(gameId,reason);
  const accepted=[],skipped=[],reasonCounts=Object.fromEntries(reasonOrder.map(reason=>[reason,0]));
  const affectedGames=new Set(),admittedIds=new Set(existing.snapshots.map(s=>s.id));
  let routineDuplicateCaptures=0;
  for(const s of captures){
    if(!conflicts.has(s.gameId)){
      if(admittedIds.has(s.id))routineDuplicateCaptures++;
      admittedIds.add(s.id);accepted.push(s);continue;
    }
    const reasons=reasonOrder.filter(reason=>conflicts.get(s.gameId).has(reason));
    for(const reason of reasons)reasonCounts[reason]++;
    affectedGames.add(s.gameId);
    skipped.push({gameId:s.gameId,snapshotId:s.id,reasons});
  }
  return {accepted,skipped,diagnostics:{policy:'FROZEN_CAPTURE_IDENTITY_V2',
    consideredCaptures:captures.length,admissibleCaptures:accepted.length,
    routineDuplicateCaptures,quarantinedCaptures:skipped.length,quarantinedGames:affectedGames.size,reasonCounts,
    retainedScheduleQuarantine:scheduleQuarantineMetadata(existing,retainedSchedules)}};
}

export function resultsFromSchedule(journal,rows,now=Date.now(),{sourceReceipt=null}={}) {
  validateJournal(journal);
  if(!Array.isArray(rows)||!Number.isFinite(now))throw Error('Invalid result source');
  const unambiguous=unambiguousFrozenGameIds(journal.snapshots),results=[];
  for(const gameId of unambiguous){
    const snapshot=journal.snapshots.find(s=>s.gameId===gameId);
    // Duplicate source identities, including conflicting scores or reschedules,
    // cannot be resolved by arbitrary row order.
    const matches=rows.filter(row=>row?.game_id===gameId);
    if(matches.length!==1)continue;
    const row=matches[0];
    if(Number(row.season)!==journal.season||!gameTypes.has(row.game_type)||
       !validDay(row.gameday)||row.home_score==null||row.away_score==null||
       ![row.home_score,row.away_score].every(value=>(typeof value==='number'||typeof value==='string')&&/^\d{1,3}$/.test(String(value))))continue;
    const homeScore=Number(row.home_score),awayScore=Number(row.away_score);
    const result={gameId,season:Number(row.season),gameDate:row.gameday,
      home:canonicalTeam(row.home_team),away:canonicalTeam(row.away_team),
      commenceTime:row.commenceTime,homeScore,awayScore,
      outcome:homeScore===awayScore?'TIE':homeScore>awayScore?'HOME':'AWAY',
      source:'NFLVERSE_SCHEDULES',resultHash:hash(gameId+'|'+homeScore+'|'+awayScore),
      terminalStatusReceipt:sourceReceipt?.source==='NFLVERSE_SCHEDULES'&&{bindingPolicy:FINAL_RECEIPT_BINDING_POLICY,gameId,season:Number(row.season),gameDate:row.gameday,
        home:canonicalTeam(row.home_team),away:canonicalTeam(row.away_team),commenceTime:row.commenceTime,
        homeScore,awayScore,source:'NFLVERSE_SCHEDULES',status:row.status,
        observedAt:sourceReceipt.observedAt,sha256:sourceReceipt.sha256}};
    if(validResult(result)&&validNewFinalResult(result,snapshot,now))results.push(result);
  }
  return results;
}

export function updateJournal(existing,captures,results,now=Date.now()) {
  if(!Number.isFinite(now))throw Error('Invalid journal write time');
  if(!Array.isArray(captures)||captures.length>10000||!Array.isArray(results)||results.length>1000)
    throw Error('Invalid journal write input');
  const journal=structuredClone(validateJournal(existing));
  const retainedSchedules=validateRetainedIdentityState(journal,now).schedules;
  if(captures.some(s=>retainedSchedules.blocked.has(s?.gameId))||results.some(r=>retainedSchedules.blocked.has(r?.gameId)))
    throw Error('Quarantined schedule identity cannot receive captures or results');
  for(const s of captures)if(!validObservation(s,journal.season)||parsed(s.capturedAt)>now+60000)
    throw Error('Invalid/future/post-kickoff forecast');
  const ids=new Set(journal.snapshots.map(x=>x.id));
  const captureFloor=existing.snapshots.reduce((max,s)=>Math.max(max,parsed(s.capturedAt)),-Infinity);
  // Direct callers cannot bypass the provider continuity guard for new records.
  const providerConflicts=providerContinuityConflicts([...existing.snapshots,...captures]);
  if(captures.some(s=>!ids.has(s.id)&&providerConflicts.has(s.gameId)))
    throw Error('Provider event identity requires explicit continuity review');
  let added=0,revisions=0;
  for(const s of captures){
    if(!validObservation(s,journal.season)||parsed(s.capturedAt)>now+60000)throw Error('Invalid/future/post-kickoff forecast');
    if(s.season!==journal.season||!s.id||!s.gameId||!Number.isFinite(s.modelHomeProbability)||
       s.modelHomeProbability<=0||s.modelHomeProbability>=1||
       parsed(s.capturedAt)>=parsed(s.commenceTime)||
       (s.challengerHomeProbability!==undefined&&s.challengerHomeProbability!==null&&
         (!Number.isFinite(s.challengerHomeProbability)||
          s.challengerHomeProbability<=0||s.challengerHomeProbability>=1||
          s.challengerResearchOnly!==true||
          !Number.isFinite(parsed(s.challengerBuiltAt))||
          parsed(s.challengerBuiltAt)>parsed(s.capturedAt)+60000)))
      throw Error('Invalid/post-kickoff forecast');
    // Scheduled recaptures reuse the deterministic daily/window ID. Keep the
    // first record exactly as stored, even when the later quote has changed.
    if(!ids.has(s.id)){
      if(parsed(s.capturedAt)<captureFloor||existing.snapshots.some(old=>old.gameId===s.gameId&&
        old.capturedAt===s.capturedAt&&(s.id<old.id||s.id.localeCompare(old.id)<0)))throw Error('Backdated forecast addition');
      if(!isEligibleModelSnapshot(s)||!validFrozenIdentity(s)||journal.snapshots.some(old=>
        old.gameId===s.gameId&&!sameFrozenIdentity(old,s)))throw Error('Invalid/conflicting frozen identity or provenance');
      journal.snapshots.push(structuredClone(s));ids.add(s.id);added++;
    }
  }
  const tracked=new Set(journal.snapshots.map(x=>x.gameId));
  const latest=latestSettlementsByRevision(journal.settlements);
  const unambiguous=unambiguousFrozenGameIds(journal.snapshots);
  for(const result of results){
    if(!validResult(result))throw Error('Invalid result outcome / score');
    if(!tracked.has(result.gameId))continue;
    if(!unambiguous.has(result.gameId)||!validNewFinalResult(result,journal.snapshots.find(s=>s.gameId===result.gameId),now))
      throw Error('Invalid result identity or finality receipt');
    const prior=latest.get(result.gameId);
    const revised={...structuredClone(result),
      resultHash:hash(result.gameId+'|'+result.homeScore+'|'+result.awayScore),
      verifiedAt:new Date(now).toISOString(),
      revision:(prior?.revision||0)+1};
    // A real provenance upgrade may append a revision without changing scores.
    // Routine repeats must not manufacture new outcome samples or revisions.
    const snapshot=journal.snapshots.find(s=>s.gameId===result.gameId);
    if(prior&&['homeScore','awayScore','outcome'].every(key=>prior[key]===result[key])&&
      validNewFinalResult(prior,snapshot,parsed(prior.verifiedAt))&&
      (!isSourceCorroboratedSettlement(revised,snapshot)||isSourceCorroboratedSettlement(prior,snapshot)))continue;
    journal.settlements.push(revised);latest.set(result.gameId,revised);revisions++;
  }
  journal.snapshots.sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.id.localeCompare(b.id));
  validateJournal(journal);
  return {journal,added,settlementRevisions:revisions};
}
function loss(p,y) {
  p=clamp(p);
  return {brier:(p-y)**2,logLoss:-(y*Math.log(p)+(1-y)*Math.log(1-p)),
    correct:Number((p>=0.5)===(y===1))};
}
function ciPaired(diffs) {
  if(diffs.length<MIN_SAMPLE)return null;
  let seed=318901;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const stats=[];
  for(let b=0;b<1200;b++){
    let total=0;for(let i=0;i<diffs.length;i++)total+=diffs[Math.floor(rnd()*diffs.length)];
    stats.push(total/diffs.length);
  }
  stats.sort((a,b)=>a-b);
  return {method:'PAIRED_BOOTSTRAP_1200',lower:round(stats[29]),upper:round(stats[1169])};
}
function bins(rows) {
  const result=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,n:0,sum:0,wins:0}));
  for(const {p,y} of rows){const b=result[Math.min(9,Math.floor(p*10))];b.n++;b.sum+=p;b.wins+=y;}
  return result.map(b=>({from:b.from,to:b.to,n:b.n,
    predicted:b.n?round(b.sum/b.n,4):null,observed:b.n?round(b.wins/b.n,4):null}));
}

export function summarizeEvidence(journal,now=Date.now()) {
  validateJournal(journal);
  const first=new Map(),byGame=new Map();
  for(const shot of journal.snapshots) {
    if(parsed(shot.capturedAt)>=parsed(shot.commenceTime))continue;
    if(!first.has(shot.gameId)||(shot.capturedAt<first.get(shot.gameId).capturedAt||
      (shot.capturedAt===first.get(shot.gameId).capturedAt&&shot.id<first.get(shot.gameId).id)))
      first.set(shot.gameId,shot);
    if(!byGame.has(shot.gameId))byGame.set(shot.gameId,[]);
    byGame.get(shot.gameId).push(shot);
  }
  const settled=latestSettlementsByRevision(journal.settlements);
  const unambiguous=unambiguousFrozenGameIds(journal.snapshots);
  const observed=[...first.values()].filter(s=>settled.has(s.gameId)&&settled.get(s.gameId).outcome!=='TIE')
    .map(s=>{const final=settled.get(s.gameId),y=final.outcome==='HOME'?1:0;
      return {s,final,y,model:loss(s.modelHomeProbability,y),
        market:Number.isFinite(s.marketHomeProbability)?loss(s.marketHomeProbability,y):null};});
  const paired=observed.filter(x=>x.market);
  const scored=observed.filter(x=>(unambiguous.has(x.s.gameId)&&isEligibleModelSnapshot(x.s)&&isSourceCorroboratedSettlement(x.final,x.s)));
  const scoredPaired=scored.filter(x=>x.market&&isEligibleMarketSnapshot(x.s));
  const challengerPaired=[];
  for(const [gameId,shots] of byGame){
    const result=settled.get(gameId);
    if(!result||result.outcome==='TIE')continue;
    const s=[...shots].filter(x=>Number.isFinite(x.challengerHomeProbability)&&
      parsed(x.capturedAt)<parsed(x.commenceTime))
      .sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt)||a.id.localeCompare(b.id))[0];
    if(!s)continue;
    const y=result.outcome==='HOME'?1:0;
    challengerPaired.push({
      gameId,gameDate:s.gameDate,modelVersion:s.challengerModelVersion,
      sourceCorroborated:unambiguous.has(gameId)&&isEligibleChallengerSnapshot(s)&&isSourceCorroboratedSettlement(result,s),
      baselineProbability:s.modelHomeProbability,challengerProbability:s.challengerHomeProbability,outcome:y,
      baseline:loss(s.modelHomeProbability,y),
      challenger:loss(s.challengerHomeProbability,y)
    });
  }
  const scoredChallenger=challengerPaired.filter(x=>x.sourceCorroborated);
  const minMet=scored.length>=MIN_SAMPLE,pairedMet=scoredPaired.length>=MIN_SAMPLE;
  const differences=scoredPaired.map(x=>x.market.brier-x.model.brier);
  const movement=[];
  for(const [gameId,shots] of byGame){
    const firstShot=first.get(gameId);
    const near=shots.filter(s=>unambiguous.has(gameId)&&isEligibleMarketSnapshot(s)&&s.window==='NEAR_KICKOFF'&&s.id!==firstShot.id&&
      Number.isFinite(s.marketHomeProbability)&&parsed(s.capturedAt)<parsed(s.commenceTime))
      .sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0];
    if(near&&isEligibleMarketSnapshot(firstShot))
      movement.push((near.marketHomeProbability-firstShot.marketHomeProbability)*100);
  }
  const pending=[...first.values()].filter(s=>!settled.has(s.gameId));
  return {
    schema:1,season:journal.season,generatedAt:new Date(now).toISOString(),
    provenance:journal.provenance,status:minMet?'FORWARD_SAMPLE_AVAILABLE':'COLLECTING_FORWARD_EVIDENCE',
    outcomeScoringPolicy:OUTCOME_SCORING_POLICY,sourceIndependenceVerified:false,
    marketFreshnessPolicy:MARKET_FRESHNESS_POLICY,
    legacyMarketSnapshotsWithoutOldestQuoteTime:journal.snapshots.filter(s=>Number.isFinite(s.marketHomeProbability)&&s.marketOldestQuoteAt==null).length,
    researchOnly:true,noWagering:true,marketBeatingEdgeEstablished:false,
    realizedROI:null,verifiedCLV:null,minimumScoredSample:MIN_SAMPLE,
    totalSnapshots:journal.snapshots.length,prospectiveGames:first.size,
    settledGames:observed.length,pendingGames:pending.length,
    sourceCorroboratedSettledGames:scored.length,
    sourceUncorroboratedSettledGames:observed.length-scored.length,
    sourceCorroboratedMarketGames:scoredPaired.length,
    sourceCorroboratedChallengerGames:scoredChallenger.length,
    pairedMarketGames:paired.length,nearKickoffConsensusPairs:movement.length,
    prospectiveChallengerGames:[...byGame.values()].filter(shots=>
      shots.some(s=>Number.isFinite(s.challengerHomeProbability))).length,
    pairedChallengerSettled:challengerPaired.length,
    challengerForwardComparison:scoredChallenger.length>=MIN_SAMPLE?{
      n:scoredChallenger.length,
      baselineBrier:round(avg(scoredChallenger.map(x=>x.baseline.brier))),
      challengerBrier:round(avg(scoredChallenger.map(x=>x.challenger.brier))),
      baselineLogLoss:round(avg(scoredChallenger.map(x=>x.baseline.logLoss))),
      challengerLogLoss:round(avg(scoredChallenger.map(x=>x.challenger.logLoss))),
      baselineMinusChallengerBrier:round(avg(scoredChallenger.map(x=>
        x.baseline.brier-x.challenger.brier))),
      confidence95:ciPaired(scoredChallenger.map(x=>
        x.baseline.brier-x.challenger.brier)),
      weekSensitivity:pairedWeekBootstrap(scoredChallenger.map(x=>({id:x.gameId,date:x.gameDate,
        baseline:x.baselineProbability,challenger:x.challengerProbability,outcome:x.outcome}))),
      interpretation:'PAIRED_PROSPECTIVE_PREGAME_NOT_PROFIT_VALIDATION'
    }:null,
    tiesExcluded:[...first.keys()].filter(id=>settled.get(id)?.outcome==='TIE').length,
    forwardMetrics:minMet?{
      n:scored.length,brier:round(avg(scored.map(x=>x.model.brier))),
      logLoss:round(avg(scored.map(x=>x.model.logLoss))),
      winnerAccuracy:round(avg(scored.map(x=>x.model.correct)),4),
      calibration:bins(scored.map(x=>({p:x.s.modelHomeProbability,y:x.y})))
    }:null,
    marketComparison:pairedMet?{
      n:scoredPaired.length,modelBrier:round(avg(scoredPaired.map(x=>x.model.brier))),
      consensusBrier:round(avg(scoredPaired.map(x=>x.market.brier))),
      consensusMinusModelBrier:round(avg(differences)),
      confidence95:ciPaired(differences),
      basis:'SAME_SNAPSHOT_NON_CLOSING_CONSENSUS'
    }:null,
    consensusMovementPoints:movement.length>=MIN_SAMPLE?round(avg(movement),3):null,
    recentResults:observed.slice(-10).reverse().map(x=>({
      gameId:x.s.gameId,home:x.s.home,away:x.s.away,
      gameDate:x.s.gameDate,score:x.final.awayScore+'-'+x.final.homeScore,
      result:x.final.outcome,modelHomeProbability:x.s.modelHomeProbability,
      marketHomeProbability:x.s.marketHomeProbability,
      capturedAt:x.s.capturedAt,
      sourceCorroborated:(unambiguous.has(x.s.gameId)&&isEligibleModelSnapshot(x.s)&&isSourceCorroboratedSettlement(x.final,x.s)),
      brier:(unambiguous.has(x.s.gameId)&&isEligibleModelSnapshot(x.s)&&isSourceCorroboratedSettlement(x.final,x.s))?round(x.model.brier):null
    })),
    pendingPreview:pending.slice(0,12).map(x=>({
      gameId:x.gameId,home:x.home,away:x.away,gameDate:x.gameDate,
      capturedAt:x.capturedAt,modelHomeProbability:x.modelHomeProbability,
      marketHomeProbability:x.marketHomeProbability
    })),
    safeguards:[
      'Only pregame forecasts captured before outcomes, never reconstructed after games',
      'Original forecasts are append-only; corrected results retain settlement revisions',
      'At least 30 source-corroborated non-ties before aggregate outcome performance is displayed',
      'Market consensus is paired at the same as-of snapshot, NOT genuine bookmaker closing-line value',
      'Market scoring requires absolute oldest quote time fresh at capture; legacy missing timestamps are not reconstructed',
      'Only derived probabilities are journaled; no raw bookmaker prices or identities',
      'Legacy community scores remain recorded but do not qualify for outcome scoring',
      'Cross-source agreement does not establish upstream source independence or official league certification',
      'No real wagers, account execution or realized ROI'
    ]
  };
}
