/**
 * Phase 3 forward evidence. Only independent model forecasts and aggregated
 * no-vig consensus are stored. Raw odds/bookmaker identities are never stored.
 * Forecast snapshots are immutable; verified results have revision history.
 */
import {pairedWeekBootstrap} from './statistical-audit.mjs';
import {timestamp, isProbability, validDay} from './integrity.mjs';
import { createHash } from 'node:crypto';
import { NFL_TEAMS, canonicalTeam } from './nfl-elo.mjs';
import {selectFinalizedResults} from './settlement-only.mjs';

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
  const at=timestamp(s.capturedAt),kick=timestamp(s.commenceTime);
  if(!Number.isFinite(at)||!Number.isFinite(kick)||at>=kick)return false;
  for(const key of ['modelBuiltAt','sourceReceivedAt'])
    if(s[key]!==undefined&&(!Number.isFinite(timestamp(s[key]))||timestamp(s[key])>at+60000||timestamp(s[key])>=kick))return false;
  if(s.marketHomeProbability!=null&&!isProbability(s.marketHomeProbability))return false;
  if(s.challengerHomeProbability!=null&&(!isProbability(s.challengerHomeProbability)||s.challengerResearchOnly!==true||
     !Number.isFinite(timestamp(s.challengerBuiltAt))||timestamp(s.challengerBuiltAt)>at+60000||timestamp(s.challengerBuiltAt)>=kick))return false;
  return true;
}
function validResult(r){
  return Boolean(r&&typeof r.gameId==='string'&&
    [r.homeScore,r.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=100)&&
    r.outcome===(r.homeScore===r.awayScore?'TIE':r.homeScore>r.awayScore?'HOME':'AWAY'));
}

export function matchSchedule(event,rows,season) {
  if (!event || !Array.isArray(rows)) return null;
  const home=NFL_TEAMS[event.homeTeam],away=NFL_TEAMS[event.awayTeam],kick=parsed(event.commenceTime);
  if (!home||!away||!Number.isFinite(kick)||home===away) return null;
  const matches=rows.filter(r => r && Number(r.season)===season&&gameTypes.has(r.game_type)&&
    canonicalTeam(r.home_team)===home&&canonicalTeam(r.away_team)===away&&
    r.game_id&&/^\d{4}-\d{2}-\d{2}$/.test(r.gameday)&&
    Math.abs(kick-parsed(r.gameday+'T12:00:00Z'))<=36*3600000
  ).sort((a,b)=>Math.abs(kick-parsed(a.gameday+'T12:00:00Z'))-
                 Math.abs(kick-parsed(b.gameday+'T12:00:00Z')));
  if(matches.length>1&&matches[0].gameday===matches[1].gameday) return null;
  return matches[0]||null;
}

export function observationsFromSlate(slate,rows,now=Date.now(),season=new Date(now).getUTCFullYear()) {
  if (slate?.demo!==false||slate.source!=='THE_ODDS_API_V4'||
      slate.sport!=='americanfootball_nfl'||slate.market!=='h2h'||
      !Array.isArray(slate.events)||!Array.isArray(rows)) throw Error('Real NFL moneylines only');
  const received=parsed(slate.receivedAt);
  if (!Number.isFinite(received)||received>now+60000||now-received>15*60000)
    throw Error('Provider snapshot timestamp stale');
  const accepted=[],skipped=[];
  for(const event of slate.events) {
    if(!event || typeof event!=='object') { skipped.push({reason:'INVALID_EVENT'});continue; }
    const kick=parsed(event.commenceTime),m=event.independentModel;
    if (!Number.isFinite(kick)||kick-now<5*60000||kick-now>14*86400000||
        !m?.available||m.method!=='NFL_ELO_HISTORICAL_OUTCOMES'||
        !m.independentOfOdds||m.use!=='RESEARCH_ONLY'||
        !Number.isFinite(m.homeWinProbability)||m.homeWinProbability<=0||
        m.homeWinProbability>=1||!Number.isFinite(parsed(m.modelBuiltAt))||
        parsed(m.modelBuiltAt)>now+60000) {
      skipped.push({eventId:String(event.id||''),reason:'PREGAME_MODEL_GATE'});continue;
    }
    const row=matchSchedule(event,rows,season);
    if(!row){skipped.push({eventId:String(event.id||''),reason:'NO_UNIQUE_SCHEDULE_MATCH'});continue;}
    const c=event.marketConsensus;
    const validMarket=c?.available&&c.method==='ALL_BOOKS_MEDIAN_DE_VIG'&&c.books>=3&&
      Number.isFinite(c.homeProbability)&&c.homeProbability>0&&c.homeProbability<1&&
      c.oldestQuoteAgeSeconds<=600&&parsed(c.latestQuoteAt)<=now+60000&&
      parsed(c.latestQuoteAt)<kick;
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
    accepted.push({
      id,gameId:row.game_id,providerEventId:String(event.id),
      season,home:canonicalTeam(row.home_team),away:canonicalTeam(row.away_team),
      gameDate:row.gameday,commenceTime:new Date(kick).toISOString(),
      capturedAt:new Date(now).toISOString(),sourceReceivedAt:new Date(received).toISOString(),
      window,hoursBeforeKickoff:round((kick-now)/3600000,2),
      modelVersion:String(m.modelVersion),modelBuiltAt:m.modelBuiltAt,
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
      marketBasis:validMarket?'NO_VIG_MULTI_BOOK_MEDIAN':'UNAVAILABLE',
      independentModel:true,researchOnly:true,verifiedInjuryAdjustment:false
    });
  }
  return {accepted,skipped};
}

/** Legacy public API now delegates to the same 24h+ community-source finality gate. */
export function resultsFromSchedule(journal,rows,now=Date.now()) {
  validateJournal(journal);
  return selectFinalizedResults(journal,rows,{now});
}

export function updateJournal(existing,captures,results,now=Date.now()) {
  const journal=structuredClone(validateJournal(existing));
  const ids=new Set(journal.snapshots.map(x=>x.id));
  let added=0,revisions=0;
  for(const s of captures){
    if(!validObservation(s,journal.season))throw Error('Invalid/post-kickoff forecast');
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
    if(!ids.has(s.id)){journal.snapshots.push(structuredClone(s));ids.add(s.id);added++;}
  }
  const tracked=new Set(journal.snapshots.map(x=>x.gameId));
  const latest=new Map(journal.settlements.map(s=>[s.gameId,s]));
  for(const result of results){
    if(!validResult(result))throw Error('Invalid result outcome / score');
    if(!tracked.has(result.gameId)||latest.get(result.gameId)?.resultHash===result.resultHash)continue;
    const revised={...structuredClone(result),verifiedAt:new Date(now).toISOString(),
      revision:(latest.get(result.gameId)?.revision||0)+1};
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
    if(!first.has(shot.gameId)||shot.capturedAt<first.get(shot.gameId).capturedAt)
      first.set(shot.gameId,shot);
    if(!byGame.has(shot.gameId))byGame.set(shot.gameId,[]);
    byGame.get(shot.gameId).push(shot);
  }
  const settled=new Map(journal.settlements.map(s=>[s.gameId,s]));
  const observed=[...first.values()].filter(s=>settled.has(s.gameId)&&settled.get(s.gameId).outcome!=='TIE')
    .map(s=>{const final=settled.get(s.gameId),y=final.outcome==='HOME'?1:0;
      return {s,final,y,model:loss(s.modelHomeProbability,y),
        market:Number.isFinite(s.marketHomeProbability)?loss(s.marketHomeProbability,y):null};});
  const paired=observed.filter(x=>x.market);
  const challengerPaired=[];
  for(const [gameId,shots] of byGame){
    const result=settled.get(gameId);
    if(!result||result.outcome==='TIE')continue;
    const s=[...shots].filter(x=>Number.isFinite(x.challengerHomeProbability)&&
      parsed(x.capturedAt)<parsed(x.commenceTime))
      .sort((a,b)=>a.capturedAt.localeCompare(b.capturedAt))[0];
    if(!s)continue;
    const y=result.outcome==='HOME'?1:0;
    challengerPaired.push({
      gameId,gameDate:s.gameDate,modelVersion:s.challengerModelVersion,
      baselineProbability:s.modelHomeProbability,challengerProbability:s.challengerHomeProbability,outcome:y,
      baseline:loss(s.modelHomeProbability,y),
      challenger:loss(s.challengerHomeProbability,y)
    });
  }
  const minMet=observed.length>=MIN_SAMPLE,pairedMet=paired.length>=MIN_SAMPLE;
  const differences=paired.map(x=>x.market.brier-x.model.brier);
  const movement=[];
  for(const [gameId,shots] of byGame){
    const firstShot=first.get(gameId);
    const near=shots.filter(s=>s.window==='NEAR_KICKOFF'&&s.id!==firstShot.id&&
      Number.isFinite(s.marketHomeProbability)&&parsed(s.capturedAt)<parsed(s.commenceTime))
      .sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0];
    if(near&&Number.isFinite(firstShot.marketHomeProbability))
      movement.push((near.marketHomeProbability-firstShot.marketHomeProbability)*100);
  }
  const pending=[...first.values()].filter(s=>!settled.has(s.gameId));
  return {
    schema:1,season:journal.season,generatedAt:new Date(now).toISOString(),
    provenance:journal.provenance,status:minMet?'FORWARD_SAMPLE_AVAILABLE':'COLLECTING_FORWARD_EVIDENCE',
    researchOnly:true,noWagering:true,marketBeatingEdgeEstablished:false,
    realizedROI:null,verifiedCLV:null,minimumScoredSample:MIN_SAMPLE,
    totalSnapshots:journal.snapshots.length,prospectiveGames:first.size,
    settledGames:observed.length,pendingGames:pending.length,
    pairedMarketGames:paired.length,nearKickoffConsensusPairs:movement.length,
    prospectiveChallengerGames:[...byGame.values()].filter(shots=>
      shots.some(s=>Number.isFinite(s.challengerHomeProbability))).length,
    pairedChallengerSettled:challengerPaired.length,
    challengerForwardComparison:challengerPaired.length>=MIN_SAMPLE?{
      n:challengerPaired.length,
      baselineBrier:round(avg(challengerPaired.map(x=>x.baseline.brier))),
      challengerBrier:round(avg(challengerPaired.map(x=>x.challenger.brier))),
      baselineLogLoss:round(avg(challengerPaired.map(x=>x.baseline.logLoss))),
      challengerLogLoss:round(avg(challengerPaired.map(x=>x.challenger.logLoss))),
      baselineMinusChallengerBrier:round(avg(challengerPaired.map(x=>
        x.baseline.brier-x.challenger.brier))),
      confidence95:ciPaired(challengerPaired.map(x=>
        x.baseline.brier-x.challenger.brier)),
      weekSensitivity:pairedWeekBootstrap(challengerPaired.map(x=>({id:x.gameId,date:x.gameDate,
        baseline:x.baselineProbability,challenger:x.challengerProbability,outcome:x.outcome}))),
      interpretation:'PAIRED_PROSPECTIVE_PREGAME_NOT_PROFIT_VALIDATION'
    }:null,
    tiesExcluded:[...first.keys()].filter(id=>settled.get(id)?.outcome==='TIE').length,
    forwardMetrics:minMet?{
      n:observed.length,brier:round(avg(observed.map(x=>x.model.brier))),
      logLoss:round(avg(observed.map(x=>x.model.logLoss))),
      winnerAccuracy:round(avg(observed.map(x=>x.model.correct)),4),
      calibration:bins(observed.map(x=>({p:x.s.modelHomeProbability,y:x.y})))
    }:null,
    marketComparison:pairedMet?{
      n:paired.length,modelBrier:round(avg(paired.map(x=>x.model.brier))),
      consensusBrier:round(avg(paired.map(x=>x.market.brier))),
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
      capturedAt:x.s.capturedAt,brier:round(x.model.brier)
    })),
    pendingPreview:pending.slice(0,12).map(x=>({
      gameId:x.gameId,home:x.home,away:x.away,gameDate:x.gameDate,
      capturedAt:x.capturedAt,modelHomeProbability:x.modelHomeProbability,
      marketHomeProbability:x.marketHomeProbability
    })),
    safeguards:[
      'Only pregame forecasts captured before outcomes, never reconstructed after games',
      'Original forecasts are append-only; corrected results retain settlement revisions',
      'At least 30 finalized non-ties before performance statistics are displayed',
      'Market consensus is paired at the same as-of snapshot, NOT genuine bookmaker closing-line value',
      'Only derived probabilities are journaled; no raw bookmaker prices or identities',
      'nflverse community-maintained results are not an official league certification',
      'No real wagers, account execution or realized ROI'
    ]
  };
}
