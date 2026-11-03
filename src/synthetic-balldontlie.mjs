/** Offline fabricated-fixture adapter. No transport, credentials, storage or live integration. */
import {createHash} from 'node:crypto';
import {NFL_TEAMS,parseCsv} from './nfl-elo.mjs';
import {validateJournal} from './evidence.mjs';
import {selectFinalizedResults,nflSeasonAt} from './settlement-only.mjs';
import {validDay,nflGameDate} from './integrity.mjs';

const aliases=Object.freeze({WSH:'WAS',JAC:'JAX',LAR:'LA',STL:'LA',OAK:'LV',SD:'LAC'});
const teams=new Set(Object.values(NFL_TEAMS));
const team=value=>{
  if(typeof value!=='string'||!/^[A-Z]{2,3}$/.test(value))return null;
  const code=aliases[value]??value;return teams.has(code)?code:null;
};
const instant=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return NaN;
  const n=Date.parse(value);return Number.isFinite(n)&&new Date(n).toISOString()===value?n:NaN;
};
const bounded=text=>typeof text==='string'&&text.length>0&&Buffer.byteLength(text,'utf8')<=1000000;
const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const id=n=>Number.isSafeInteger(n)&&n>0;
const score=n=>Number.isInteger(n)&&n>=0&&n<=100;
// Validate CSV shape before the shared reader can discard extra columns or
// overwrite duplicate header names. Quoted cells follow the same RFC 4180 form.
function strictSchedule(text){
  const records=[];let row=[],cell='',state='plain';
  const pushCell=()=>{row.push(cell);cell='';state='plain';};
  const pushRow=()=>{pushCell();if(row.some(v=>v!==''))records.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(state==='quoted'){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else state='closed';}
      else cell+=c;
    }else if(c===',')pushCell();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}
    else if(c==='"'&&state==='plain'&&cell==='')state='quoted';
    else if(state==='closed'||c==='"')throw Error('INVALID_SYNTHETIC_CSV_QUOTING');
    else cell+=c;
    if(records.length>101)throw Error('SYNTHETIC_SCHEDULE_LIMIT');
  }
  if(state==='quoted')throw Error('INVALID_SYNTHETIC_CSV_QUOTING');
  if(cell||row.length||state==='closed')pushRow();
  const headers=(records[0]??[]).map((v,i)=>i===0?v.replace(/^\uFEFF/,''):v);
  if(!headers.length||headers.some(h=>!/^[a-z][a-z0-9_]*$/.test(h))||new Set(headers).size!==headers.length)
    throw Error('INVALID_OR_DUPLICATE_SCHEDULE_HEADER');
  if(records.slice(1).some(r=>r.length!==headers.length))throw Error('SCHEDULE_ROW_WIDTH_MISMATCH');
  return parseCsv(text);
}
const limits=()=>({syntheticOnly:true,liveCaptureEnabled:false,sourceIndependenceVerified:false,
  qualifiesForExistingCorroborationGate:false,officialLeagueCertification:false,
  publicationAuthorized:false,providerRequests:0,filesWritten:0,qualifiedOutcomes:0});

/** Only explicit synthetic opt-in can inspect a fabricated bounded input. */
export function crossCheckSyntheticBallDontLieFixture(fixture,{enabled=false}={}){
  if(typeof enabled!=='boolean')throw Error('BOOLEAN_SYNTHETIC_OPT_IN_REQUIRED');
  if(!enabled)return {enabled:false,...limits()};
  if(fixture?.schema!=='betq-synthetic-balldontlie-v1'||
    fixture.fixtureOrigin!=='FABRICATED_REPOSITORY_FIXTURE')throw Error('FABRICATED_FIXTURE_REQUIRED');
  const now=instant(fixture.evaluatedAt),nflAt=instant(fixture.nflverseObservedAt),bdlAt=instant(fixture.balldontlieObservedAt);
  if(!Number.isFinite(now)||[nflAt,bdlAt].some(at=>!Number.isFinite(at)||at>now||at<now-3600000))
    throw Error('INVALID_SYNTHETIC_RECEIPT_CHRONOLOGY');
  if(!bounded(fixture.nflverseCsv)||!bounded(fixture.balldontlieJson))throw Error('INVALID_SYNTHETIC_PAYLOAD_SIZE');
  const journal=validateJournal(fixture.journal);
  if(journal.snapshots.length>100)throw Error('SYNTHETIC_TRACKED_GAME_LIMIT');
  const identities=new Map();
  for(const s of journal.snapshots){
    const kick=instant(s.commenceTime);
    if(!validDay(s.gameDate)||!Number.isFinite(kick)||!team(s.home)||!team(s.away)||team(s.home)===team(s.away)||
      s.season<2020||s.season>2100||nflSeasonAt(kick)!==s.season||nflGameDate({commence_time:s.commenceTime})!==s.gameDate)
      throw Error('INVALID_FROZEN_GAME_IDENTITY');
    const identity=[s.season,team(s.home),team(s.away),kick].join('|');
    if(identities.has(identity)&&identities.get(identity)!==s.gameId)throw Error('FROZEN_EVENT_IDENTITY_COLLISION');
    identities.set(identity,s.gameId);
  }
  const rows=strictSchedule(fixture.nflverseCsv);
  if(rows.length>100)throw Error('SYNTHETIC_SCHEDULE_LIMIT');
  const payload=JSON.parse(fixture.balldontlieJson);
  if(!payload||!Array.isArray(payload.data)||payload.data.length>100||
    payload.meta?.next_cursor!==null||!Number.isInteger(payload.meta?.per_page)||
    payload.meta.per_page<1||payload.meta.per_page>100||payload.data.length>payload.meta.per_page)
    throw Error('COMPLETE_BOUNDED_SYNTHETIC_PAGE_REQUIRED');
  const ids=new Set(),teamIds=new Map(),teamCodes=new Map();
  for(const event of payload.data){
    if(!event||!id(event.id)||ids.has(event.id))throw Error('INVALID_OR_DUPLICATE_PROVIDER_GAME_ID');
    ids.add(event.id);
    if(!Number.isInteger(event.season)||!team(event.home_team?.abbreviation)||
      !team(event.visitor_team?.abbreviation)||team(event.home_team.abbreviation)===team(event.visitor_team.abbreviation)||
      !id(event.home_team.id)||!id(event.visitor_team.id)||event.home_team.id===event.visitor_team.id)
      throw Error('INVALID_PROVIDER_GAME_IDENTITY');
    for(const side of [event.home_team,event.visitor_team]){
      const code=team(side.abbreviation);
      if(teamIds.has(side.id)&&teamIds.get(side.id)!==code||teamCodes.has(code)&&teamCodes.get(code)!==side.id)
        throw Error('CONFLICTING_PROVIDER_TEAM_IDENTITY');
      teamIds.set(side.id,code);teamCodes.set(code,side.id);
    }
  }
  const candidates=new Map(selectFinalizedResults(journal,rows,{now}).map(r=>[r.gameId,r]));
  const tracked=new Map(journal.snapshots.map(s=>[s.gameId,s]));
  const crossChecks=[],rejected=[];
  for(const [gameId,game] of tracked){
    const reject=reason=>rejected.push({gameId,reason});
    const result=candidates.get(gameId);
    if(!result){reject('NFLVERSE_CANDIDATE_UNAVAILABLE_OR_TOO_EARLY');continue;}
    const sameRows=rows.filter(r=>r.game_id===gameId);
    if(sameRows.length!==1){reject('AMBIGUOUS_NFLVERSE_GAME');continue;}
    const matches=payload.data.filter(e=>e.season===game.season&&
      team(e.home_team.abbreviation)===team(game.home)&&team(e.visitor_team.abbreviation)===team(game.away));
    if(matches.length!==1){reject(matches.length?'AMBIGUOUS_PROVIDER_GAME':'NO_PROVIDER_GAME_MATCH');continue;}
    const event=matches[0],kick=instant(game.commenceTime),providerKick=instant(event.date);
    if(!Number.isFinite(kick)||providerKick!==kick||kick>=Math.min(nflAt,bdlAt)){
      reject('KICKOFF_OR_RECEIPT_MISMATCH');continue;
    }
    if(typeof event.postseason!=='boolean'||event.postseason!==(sameRows[0].game_type!=='REG')){
      reject('SEASON_PHASE_MISMATCH');continue;
    }
    if(event.status_state!=='final'||typeof event.status!=='string'||!/^Final(?:\/(?:[1-9]\d?)?OT)?$/.test(event.status)){
      reject('EXPLICIT_CONSISTENT_FINAL_REQUIRED');continue;
    }
    if(!score(event.home_team_score)||!score(event.visitor_team_score)||
      event.home_team_score!==result.homeScore||event.visitor_team_score!==result.awayScore){
      reject('FINAL_SCORE_MISMATCH');continue;
    }
    const updated=instant(event.updated_at);
    if(!Number.isFinite(updated)||updated<kick||updated>bdlAt){reject('INVALID_PROVIDER_RECORD_TIME');continue;}
    crossChecks.push({status:'CROSS_CHECKED_FINAL_INDEPENDENCE_UNVERIFIED',...limits(),
      source:'SYNTHETIC_BALLDONTLIE_NFLVERSE_CROSS_CHECK',gameId,gameDate:game.gameDate,
      season:game.season,home:team(game.home),away:team(game.away),commenceTime:game.commenceTime,
      homeScore:result.homeScore,awayScore:result.awayScore,outcome:result.outcome,
      providerGameId:event.id,
      sourceReceipts:{
        nflverse:{source:'NFLVERSE_SCHEDULES',sha256:sha256(fixture.nflverseCsv),collectorObservedAt:fixture.nflverseObservedAt},
        balldontlie:{source:'BALLDONTLIE_NFL_GAMES',sha256:sha256(fixture.balldontlieJson),collectorObservedAt:fixture.balldontlieObservedAt,
          providerRecordUpdatedAt:event.updated_at,providerPublicationTimeVerified:false,sourceFreshnessVerified:false}
      }});
  }
  return {enabled:true,...limits(),fixtureOrigin:fixture.fixtureOrigin,
    evaluatedAt:fixture.evaluatedAt,trackedGames:tracked.size,crossCheckedSyntheticGames:crossChecks.length,crossChecks,rejected};
}
