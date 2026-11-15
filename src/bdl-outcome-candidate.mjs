/** Offline policy candidate only. No transport, credentials, persistence or production integration. */
import {createHash} from 'node:crypto';
import {canonicalTimestamp,validFrozenIdentity,FINALITY_DELAY_MS} from './evidence-integrity.mjs';
import {validateJournal} from './evidence.mjs';
import {unambiguousFrozenGameIds} from './settlement-qualification.mjs';
import {NFL_TEAMS,canonicalTeam} from './nfl-elo.mjs';
import {nflGameDate} from './integrity.mjs';
import {readScheduleSourceBytes} from './schedule-source-receipt.mjs';

export const BDL_CANDIDATE_POLICY='BDL_NATIVE_FINAL_NFLVERSE_SCORE_CANDIDATE_V1';
const flags=()=>({policyId:BDL_CANDIDATE_POLICY,activationStatus:'DISABLED',researchOnly:true,
  qualifiesForCurrentScoring:false,qualifiedOutcomes:0,sourceIndependenceVerified:false,
  officialLeagueCertification:false,historicalAsOfVerified:false,sourceFreshnessVerified:false,
  providerPublicationTimeVerified:false,archiveVerified:false});
class InputError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new InputError(code);};
const instant=value=>{const n=canonicalTimestamp(value);if(!Number.isFinite(n))fail('INVALID_TIMESTAMP');return n;};
const object=x=>Boolean(x&&typeof x==='object'&&!Array.isArray(x));
const id=x=>Number.isSafeInteger(x)&&x>0;
const score=x=>Number.isInteger(x)&&x>=0&&x<=100;
const teams=new Set(Object.values(NFL_TEAMS));
const team=value=>{
  const code=value==='LAR'?'LA':canonicalTeam(value);
  return typeof value==='string'&&teams.has(code)?code:null;
};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// JSON.parse alone silently keeps the last duplicate key. Validate the original
// tokens too, so even escaped duplicate field names cannot replace a status/ID.
function parseProviderBytes(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>262144)fail('INVALID_PROVIDER_BYTES');
  let text,payload;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);payload=JSON.parse(text);}catch{fail('INVALID_PROVIDER_JSON');}
  let at=0;
  const space=()=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;};
  const string=()=>{
    const start=at++;
    while(at<text.length){const c=text[at++];if(c==='\\')at++;else if(c==='"')break;}
    return JSON.parse(text.slice(start,at));
  };
  const value=depth=>{
    if(depth>32)fail('PROVIDER_JSON_DEPTH_LIMIT');space();
    if(text[at]==='{'){
      at++;space();const keys=new Set();
      if(text[at]==='}'){at++;return;}
      for(;;){space();const key=string();if(keys.has(key))fail('DUPLICATE_PROVIDER_JSON_KEY');keys.add(key);
        space();at++;value(depth+1);space();if(text[at++]==='}')return;}
    }
    if(text[at]==='['){at++;space();if(text[at]===']'){at++;return;}
      for(;;){value(depth+1);space();if(text[at++]===']')return;}}
    if(text[at]==='"'){string();return;}
    while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
  };
  value(0);
  if(!object(payload)||!object(payload.data)||Object.hasOwn(payload,'meta'))fail('SINGLE_GAME_RESPONSE_REQUIRED');
  return payload.data;
}

/**
 * Evaluate supplied bytes, not a URL or credential. This function cannot enable
 * ingestion. A matched result remains a separate nonqualifying candidate.
 */
export function assessBdlOutcomeCandidate(input){
  try{
    if(!object(input))fail('INVALID_INPUT');
    const evaluated=instant(input.evaluatedAt),bdlAt=instant(input.bdlRetrievedAt),nflAt=instant(input.nflverseRetrievedAt);
    if([bdlAt,nflAt].some(at=>at>evaluated||at<evaluated-3600000))fail('RETRIEVAL_TIME_OUTSIDE_REVIEW_WINDOW');
    if(!id(input.expectedProviderGameId)||typeof input.gameId!=='string'||
      !/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(input.gameId))fail('INVALID_TARGET_ID');
    let journal;
    try{journal=validateJournal(input.journal);}catch{fail('INVALID_FROZEN_JOURNAL');}
    const snapshots=journal.snapshots.filter(s=>s.gameId===input.gameId),snapshot=snapshots[0];
    if(!snapshot||!validFrozenIdentity(snapshot)||!unambiguousFrozenGameIds(journal.snapshots).has(input.gameId))
      fail('MISSING_OR_CONFLICTING_FROZEN_IDENTITY');
    const kick=instant(snapshot.commenceTime),home=team(snapshot.home),away=team(snapshot.away);
    const parts=input.gameId.split('_'),kickDate=new Date(kick),seasonAtKick=kickDate.getUTCFullYear()-(kickDate.getUTCMonth()<2?1:0);
    if(!home||!away||home===away||Number(parts[0])!==snapshot.season||team(parts[2])!==away||team(parts[3])!==home||
      snapshot.season!==seasonAtKick||snapshot.season!==journal.season||
      nflGameDate({commence_time:snapshot.commenceTime})!==snapshot.gameDate)fail('INVALID_FROZEN_GAME_IDENTITY');
    if(journal.snapshots.some(s=>s.gameId!==snapshot.gameId&&s.season===snapshot.season&&
      team(s.home)===home&&team(s.away)===away&&canonicalTimestamp(s.commenceTime)===kick))
      fail('FROZEN_EVENT_IDENTITY_COLLISION');
    if(Math.min(evaluated,bdlAt,nflAt)<kick+FINALITY_DELAY_MS)fail('FINALITY_DELAY_NOT_REACHED');
    let source;
    try{source=readScheduleSourceBytes(input.nflverseBytes,input.nflverseRetrievedAt);}catch{fail('INVALID_NFLVERSE_BYTES');}
    const rows=source.rows.filter(r=>r.game_id===input.gameId);
    if(rows.length!==1)fail(rows.length?'AMBIGUOUS_COMMUNITY_GAME':'MISSING_COMMUNITY_GAME');
    const row=rows[0];
    if(!/^\d{4}$/.test(row.season)||Number(row.season)!==snapshot.season||row.gameday!==snapshot.gameDate||
      team(row.home_team)!==home||team(row.away_team)!==away||!['REG','WC','DIV','CON','SB'].includes(row.game_type))
      fail('COMMUNITY_IDENTITY_MISMATCH');
    if(![row.home_score,row.away_score].every(x=>/^\d{1,3}$/.test(x)&&score(Number(x))))fail('INVALID_COMMUNITY_SCORES');
    const event=parseProviderBytes(input.bdlBytes);
    if(!id(event.id)||event.id!==input.expectedProviderGameId)fail('PROVIDER_GAME_ID_MISMATCH');
    if(!id(event.home_team?.id)||!id(event.visitor_team?.id)||event.home_team.id===event.visitor_team.id||
      team(event.home_team.abbreviation)!==home||team(event.visitor_team.abbreviation)!==away||
      event.season!==snapshot.season)fail('PROVIDER_TEAM_OR_SEASON_MISMATCH');
    if(instant(event.date)!==kick)fail('PROVIDER_KICKOFF_MISMATCH');
    if(typeof event.postseason!=='boolean'||event.postseason!==(row.game_type!=='REG'))fail('SEASON_PHASE_MISMATCH');
    if(event.status_state!=='final'||typeof event.status!=='string'||!/^Final(?:\/(?:[1-9]\d?)?OT)?$/.test(event.status))
      fail('EXPLICIT_CONSISTENT_PROVIDER_FINAL_REQUIRED');
    if(!score(event.home_team_score)||!score(event.visitor_team_score)||
      event.home_team_score!==Number(row.home_score)||event.visitor_team_score!==Number(row.away_score))fail('FINAL_SCORE_MISMATCH');
    if(event.postseason&&event.home_team_score===event.visitor_team_score)fail('POSTSEASON_TIE_REQUIRES_REVIEW');
    const updated=instant(event.updated_at);
    if(updated<kick||updated>bdlAt)fail('PROVIDER_RECORD_TIME_CONFLICT');
    const frozenIdentity={gameId:snapshot.gameId,season:snapshot.season,gameDate:snapshot.gameDate,
      home:snapshot.home,away:snapshot.away,commenceTime:snapshot.commenceTime};
    const homeScore=event.home_team_score,awayScore=event.visitor_team_score;
    return {...flags(),status:'MATCHED_NONQUALIFYING_CANDIDATE',reason:null,evaluatedAt:input.evaluatedAt,
      candidate:{...frozenIdentity,source:'BALLDONTLIE_NFLVERSE_CANDIDATE',policyId:BDL_CANDIDATE_POLICY,
        homeScore,awayScore,outcome:homeScore===awayScore?'TIE':homeScore>awayScore?'HOME':'AWAY',
        qualifiesForCurrentScoring:false,sourceIndependenceVerified:false,
        nativeFinalObservation:{source:'BALLDONTLIE_NFL_GAMES',providerGameId:event.id,
          providerHomeTeamId:event.home_team.id,providerAwayTeamId:event.visitor_team.id,
          home,away,season:event.season,postseason:event.postseason,providerScheduledKickoff:event.date,
          statusState:'final',status:event.status,homeScore,awayScore,
          providerRecordUpdatedAt:event.updated_at,collectorRetrievedAt:input.bdlRetrievedAt,
          providerPublicationTimeVerified:false,providerStatusChangedAt:null,sourceFreshnessVerified:false,
          bodySha256:hash(input.bdlBytes)},
        communityScoreObservation:{source:'NFLVERSE_SCHEDULES',gameId:row.game_id,season:Number(row.season),
          gameDate:row.gameday,home:team(row.home_team),away:team(row.away_team),gameType:row.game_type,
          homeScore:Number(row.home_score),awayScore:Number(row.away_score),
          collectorRetrievedAt:input.nflverseRetrievedAt,bodySha256:source.sourceReceipt.sha256,
          providerPublicationTimeVerified:false,explicitFinalStatusObserved:false,exactKickoffObserved:false}}};
  }catch(error){
    return {...flags(),status:'REJECTED',reason:error instanceof InputError?error.code:'INVALID_CANDIDATE_INPUT',candidate:null};
  }
}
