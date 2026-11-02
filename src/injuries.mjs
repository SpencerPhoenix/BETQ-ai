/**
 * nflverse weekly injury-report gateway. This is explicitly NOT a verified
 * starting-QB feed, not an injury-adjusted win model and not medical advice.
 * Community-sourced public reports may lag or omit players.
 */
import { canonicalTeam, NFL_TEAMS } from './nfl-elo.mjs';
const allowedStatus=new Set(['OUT','DOUBTFUL','QUESTIONABLE']);
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
  for(const field of ['season','week','team','position','full_name','report_status','date_modified']){
    if(!headers.includes(field))throw Error('Missing injury report column '+field);
  }
  return records.map(cols=>Object.fromEntries(headers.map((k,i)=>[k,cols[i]??''])));
}

export function compileInjuryReports(rows,{season,sourceUpdatedAt,now=Date.now()}={}){
  if(!Number.isInteger(season)||season<2020||season>2100||!Array.isArray(rows))
    throw Error('Invalid injury season');
  const teams=new Set(Object.values(NFL_TEAMS));
  const latest=new Map();
  const srcAt=Date.parse(sourceUpdatedAt);
  for(const row of rows){
    if(Number(row.season)!==season)continue;
    const team=canonicalTeam(norm(row.team)),week=Number(row.week);
    if(!teams.has(team)||!Number.isInteger(week)||week<1||week>23)continue;
    const status=norm(row.report_status).toUpperCase();
    const practice=norm(row.practice_status);
    const name=norm(row.full_name);
    if(!name||name.length>100||!norm(row.position))continue;
    const at=Date.parse(norm(row.date_modified));
    if(!Number.isFinite(at)||at>now+60000)continue;
    const id=norm(row.gsis_id)||name;
    const key=weekKey(team,week)+':'+id;
    const old=latest.get(key);
    if(old&&old.dateEpoch>at)continue;
    latest.set(key,{
      team,week,id,player:name,position:norm(row.position),
      gameStatus:status||'NOT_REPORTED',practiceStatus:practice||null,
      injury:norm(row.report_primary_injury)||null,
      dateEpoch:at,dateModified:new Date(at).toISOString()
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
    const listPublic=a=>a.slice(0,8).map(x=>({
      player:x.player,position:x.position,status:x.gameStatus,
      injury:x.injury,dateModified:x.dateModified
    }));
    reports[key]={
      team:list[0].team,week:list[0].week,
      lastPlayerUpdate:new Date(latestAt).toISOString(),
      flaggedCount:selected.length,
      statusCounts:{
        out:selected.filter(x=>x.gameStatus==='OUT').length,
        doubtful:selected.filter(x=>x.gameStatus==='DOUBTFUL').length,
        questionable:selected.filter(x=>x.gameStatus==='QUESTIONABLE').length
      },
      flaggedPlayers:listPublic(selected),
      reportedQBs:listPublic(qb)
    };
  }
  return {
    schema:1,season,source:'NFLVERSE_INJURIES',
    attribution:'nflverse injury reports (CC BY 4.0); upstream NFL injury report API',
    sourceUrl:'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_'+season+'.csv',
    sourceUpdatedAt:Number.isFinite(srcAt)?new Date(srcAt).toISOString():null,
    builtAt:new Date(now).toISOString(),
    reportCount:Object.keys(reports).length,
    reports,
    advisory:'Reported player status is not confirmed quarterback starter status. Injury adjustments are not modeled.'
  };
}

export function injuryContextForGame(event,artifact,now=Date.now()){
  if(!artifact||artifact.schema!==1||artifact.source!=='NFLVERSE_INJURIES')
    return {available:false,reason:'INJURY_REPORT_NOT_CONFIGURED'};
  const home=NFL_TEAMS[event.home_team],away=NFL_TEAMS[event.away_team];
  const kick=Date.parse(event.commence_time || '');
  const fixture=Number.isFinite(kick) && Array.isArray(artifact.fixtures) ?
    artifact.fixtures.find(f=>f.home===home&&f.away===away&&
      Math.abs(kick-Date.parse(f.gameDate+'T12:00:00Z'))<=36*3600000) : null;
  const week=Number(event.week ?? fixture?.week);
  if(!home||!away||!Number.isInteger(week)||week<1||week>23)
    return {available:false,reason:'SCHEDULE_WEEK_NOT_VERIFIED'};
  const vintage=Date.parse(artifact.sourceUpdatedAt);
  if(!Number.isFinite(vintage)||vintage>now+60000||now-vintage>72*3600000)
    return {available:false,reason:'INJURY_SOURCE_STALE',
      sourceUpdatedAt:artifact.sourceUpdatedAt};
  const find=team=>{
    const report=artifact.reports[weekKey(team,week)];
    if(!report)return {reported:false,reason:'NO_REPORT_FOR_TEAM_WEEK'};
    return {
      reported:true,sourceLastModified:report.lastPlayerUpdate,
      count:report.flaggedCount,statusCounts:report.statusCounts,
      flaggedPlayers:report.flaggedPlayers,reportedQBs:report.reportedQBs,
      starterVerified:false
    };
  };
  return {
    available:true,week,source:artifact.source,
    sourceUpdatedAt:artifact.sourceUpdatedAt,
    home:find(home),away:find(away),
    starterVerified:false,probabilitiesAdjusted:false,
    caveat:'Public injury reports can lag. Reported quarterbacks are not necessarily starters.'
  };
}
