/**
 * nflverse weekly injury-report gateway. This is explicitly NOT a verified
 * starting-QB feed, not an injury-adjusted win model and not medical advice.
 * Community-sourced public reports may lag or omit players.
 */
import { canonicalTeam, NFL_TEAMS } from './nfl-elo.mjs';
import {scheduledInstant} from './schedule-review.mjs';
const allowedStatus=new Set(['OUT','DOUBTFUL','QUESTIONABLE']);
const practiceCodes=new Map([['DNP','DNP'],['DID NOT PARTICIPATE','DNP'],['LP','LP'],['LIMITED PARTICIPATION','LP'],['FP','FP'],['FULL PARTICIPATION','FP']]);
const norm=s=>String(s??'').trim();
const weekKey=(team,week)=>canonicalTeam(team)+':'+week;

export function parseGenericCsv(text) {
  if(typeof text!=='string'||text.length>8000000)throw Error('CSV input exceeds limit');
  let field='',row=[],records=[],inQuotes=false;
  const push=()=>{row.push(field);field='';};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(inQuotes){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')inQuotes=false;
      else field+=c;
    } else if(c==='"'){inQuotes=true;}
    else if(c===','){push();}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      push();if(row.some(x=>x!==''))records.push(row);row=[];
    }else field+=c;
  }
  if(inQuotes)throw Error('Malformed CSV quotes');
  if(field||row.length){push();records.push(row);}
  if(!records.length)throw Error('Empty CSV');
  const headers=records.shift().map((s,i)=>i===0?s.replace(/^\uFEFF/,''):s);
  for(const field of ['season','week','team','position','full_name','report_status']){
    if(!headers.includes(field))throw Error('Missing injury report column '+field);
  }
  return records.map(cols=>Object.fromEntries(headers.map((k,i)=>[k,cols[i]??''])));
}

export function compileInjuryReports(rows,{season,sourceUpdatedAt,now=Date.now(),includeParticipation=false}={}){
  if(!Number.isInteger(season)||season<2020||season>2100||!Array.isArray(rows))
    throw Error('Invalid injury season');
  const teams=new Set(Object.values(NFL_TEAMS));
  const latest=new Map();
  const conflicts=new Set();
  const srcAt=Date.parse(sourceUpdatedAt);
  for(const row of rows){
    if(Number(row.season)!==season)continue;
    const team=canonicalTeam(norm(row.team)),week=Number(row.week);
    if(!teams.has(team)||!Number.isInteger(week)||week<1||week>23)continue;
    const status=norm(row.report_status).toUpperCase();
    const practice=norm(row.practice_status);
    const name=norm(row.full_name);
    if(!name||name.length>100||!norm(row.position))continue;
    const actualUpdate=Date.parse(norm(row.date_modified));
    const at=Number.isFinite(actualUpdate)?actualUpdate:srcAt;
    if(!Number.isFinite(at)||at>now+60000)continue;
    const id=norm(row.gsis_id)||name;
    const key=weekKey(team,week)+':'+id;
    if(conflicts.has(key))continue;
    const old=latest.get(key);
    if(old&&old.dateEpoch>at)continue;
    // Equal observation times cannot order conflicting practice/designation rows.
    // This includes source-time fallback when player timestamps are unavailable.
    if(old&&old.dateEpoch===at&&
       (old.gameStatus!==(status||'NOT_REPORTED')||old.practiceStatus!==(practice||null))){
      latest.delete(key);conflicts.add(key);continue;
    }
    latest.set(key,{
      team,week,id,player:name,position:norm(row.position),
      gameStatus:status||'NOT_REPORTED',practiceStatus:practice||null,
      injury:norm(row.report_primary_injury)||null,
      dateEpoch:at,dateModified:Number.isFinite(actualUpdate)?new Date(actualUpdate).toISOString():null
    });
  }
  const buckets=new Map();
  for(const r of latest.values()){
    const k=weekKey(r.team,r.week);
    if(!buckets.has(k))buckets.set(k,[]);
    buckets.get(k).push(r);
  }
  const reports={};
  for(const [key,list] of buckets){
    const latestAt=Math.max(...list.map(x=>x.dateEpoch));
    const selected=list.filter(x=>allowedStatus.has(x.gameStatus));
    const qb=list.filter(x=>x.position==='QB');
    selected.sort((a,b)=>a.gameStatus.localeCompare(b.gameStatus)||a.player.localeCompare(b.player));
    const listPublic=a=>a.map(x=>({
      player:x.player,position:x.position,status:x.gameStatus,
      injury:x.injury,dateModified:x.dateModified
    }));
    reports[key]={
      team:list[0].team,week:list[0].week,
      lastPlayerUpdate:new Date(latestAt).toISOString(),
      individualTimestampAvailable:list.some(x=>x.dateModified!==null),
      flaggedCount:selected.length,
      statusCounts:{
        out:selected.filter(x=>x.gameStatus==='OUT').length,
        doubtful:selected.filter(x=>x.gameStatus==='DOUBTFUL').length,
        questionable:selected.filter(x=>x.gameStatus==='QUESTIONABLE').length
      },
      flaggedPlayers:listPublic(selected),
      reportedQBs:listPublic(qb),
      ...(includeParticipation?{participationRecords:list.map(x=>({player:x.player,position:x.position,
        practiceParticipation:practiceCodes.get(String(x.practiceStatus||'').toUpperCase())||'NOT_REPORTED',
        gameDesignation:allowedStatus.has(x.gameStatus)?x.gameStatus:'NOT_REPORTED',
        inactiveStatus:'NOT_VERIFIED',practiceType:'NOT_VERIFIED',dateModified:x.dateModified}))}:{})
    };
  }
  return {
    schema:1,season,source:'NFLVERSE_INJURIES',
    attribution:'nflverse injury reports (CC BY 4.0); upstream NFL injury report API',
    sourceUrl:'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_'+season+'.csv',
    sourceUpdatedAt:Number.isFinite(srcAt)?new Date(srcAt).toISOString():null,
    builtAt:new Date(now).toISOString(),
    reportCount:Object.keys(reports).length,
    ambiguousPlayerRecords:conflicts.size,
    perPlayerTimestampsAvailable:rows.some(x=>Number.isFinite(Date.parse(norm(x.date_modified)))),
    reports,
    advisory:'Reported player status is not confirmed quarterback starter status. Injury adjustments are not modeled.'
  };
}

export const INJURY_MAX_AGE_MS=72*3600000;
/** Source-file freshness is not per-player recency or a verified starter. */
export function injurySourceStatus(artifact,now=Date.now()){
  const base={available:false,reason:'INJURY_REPORT_NOT_CONFIGURED',
    starterVerified:false,modelProbabilitiesAdjusted:false};
  if(!artifact||artifact.schema!==1||artifact.source!=='NFLVERSE_INJURIES')return base;
  const vintage=Date.parse(artifact.sourceUpdatedAt),age=now-vintage;
  const date=new Date(now),season=date.getUTCMonth()<2?date.getUTCFullYear()-1:date.getUTCFullYear();
  const reason=!Number.isFinite(now)||!Number.isFinite(vintage)?'INJURY_SOURCE_TIME_INVALID':
    age<0?'INJURY_SOURCE_TIME_IN_FUTURE':age>INJURY_MAX_AGE_MS?'INJURY_SOURCE_STALE':
    artifact.season!==season?'INJURY_SEASON_MISMATCH':
    !(artifact.reportCount>0)?'INJURY_REPORTS_MISSING':null;
  return {...base,available:reason===null,reason,source:artifact.source,
    sourceUpdatedAt:artifact.sourceUpdatedAt,
    validUntil:Number.isFinite(vintage)?new Date(vintage+INJURY_MAX_AGE_MS).toISOString():null,
    sourceAgeSeconds:Number.isFinite(age)&&age>=0?Math.floor(age/1000):null,
    freshnessBasis:'SOURCE_FILE_ONLY',playerTimestampAvailable:artifact.perPlayerTimestampsAvailable===true,
    season:artifact.season,reportCount:artifact.reportCount,upcomingFixtures:artifact.fixtures?.length||0,
    advisory:'Reported player status is not confirmed quarterback starter status. Injury adjustments are not modeled.'};
}

export function injuryContextForGame(event,artifact,now=Date.now()){
  if(!artifact||artifact.schema!==1||artifact.source!=='NFLVERSE_INJURIES')
    return {available:false,reason:'INJURY_REPORT_NOT_CONFIGURED'};
  const home=NFL_TEAMS[event.home_team],away=NFL_TEAMS[event.away_team];
  const kick=scheduledInstant(event.commence_time);
  if(!Number.isFinite(kick))return {available:false,reason:'SCHEDULE_WEEK_NOT_VERIFIED'};
  const fixture=Number.isFinite(kick) && Array.isArray(artifact.fixtures) ?
    artifact.fixtures.find(f=>f.home===home&&f.away===away&&
      Math.abs(kick-Date.parse(f.gameDate+'T12:00:00Z'))<=36*3600000) : null;
  const week=Number(event.week ?? fixture?.week);
  if(!home||!away||!Number.isInteger(week)||week<1||week>23)
    return {available:false,reason:'SCHEDULE_WEEK_NOT_VERIFIED'};
  const sourceStatus=injurySourceStatus(artifact,now);
  if(!sourceStatus.available)return {...sourceStatus,probabilitiesAdjusted:false};
  const find=team=>{
    const report=artifact.reports?.[weekKey(team,week)];
    if(!report)return {reported:false,reason:'NO_REPORT_FOR_TEAM_WEEK'};
    return {
      reported:true,sourceLastModified:artifact.sourceUpdatedAt,
      individualTimestampAvailable:report.individualTimestampAvailable===true,
      // Legacy report aggregates mix player times with source-file fallback.
      // Only individual dateModified fields establish a player update.
      lastPlayerUpdateAt:null,
      count:report.flaggedCount,statusCounts:report.statusCounts,
      listedCount:report.flaggedPlayers.length,
      listComplete:report.flaggedPlayers.length===report.flaggedCount,
      omittedCount:Math.max(0,report.flaggedCount-report.flaggedPlayers.length),
      flaggedPlayers:report.flaggedPlayers,reportedQBs:report.reportedQBs,
      starterVerified:false
    };
  };
  const homeReport=find(home),awayReport=find(away);
  return {
    available:homeReport.reported||awayReport.reported,
    reason:homeReport.reported||awayReport.reported?null:'NO_REPORT_FOR_GAME_WEEK',
    week,source:artifact.source,
    sourceUpdatedAt:artifact.sourceUpdatedAt,
    home:homeReport,away:awayReport,
    freshnessBasis:sourceStatus.freshnessBasis,validUntil:sourceStatus.validUntil,
    starterVerified:false,probabilitiesAdjusted:false,
    caveat:'Public injury reports can lag. Reported quarterbacks are not necessarily starters.'
  };
}
