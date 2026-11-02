#!/usr/bin/env node
/**
 * Build source-vintage-verified public NFL injury report context.
 * This does NOT identify confirmed starters or modify probabilities.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseCsv } from '../src/nfl-elo.mjs';
import { parseGenericCsv, compileInjuryReports } from '../src/injuries.mjs';

const now=Date.now(),date=new Date(now);
const season=date.getUTCMonth()<2?date.getUTCFullYear()-1:date.getUTCFullYear();
const injuriesUrl='https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_'+season+'.csv';
const releaseUrl='https://api.github.com/repos/nflverse/nflverse-data/releases/tags/injuries';
const schedulesUrl='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
async function getJson(url){
  const r=await fetch(url,{headers:{Accept:'application/vnd.github+json','User-Agent':'BETQ-research'},
    signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Upstream release metadata HTTP '+r.status);
  const s=await r.text();
  if(s.length>1500000)throw Error('Release metadata size limit');
  return JSON.parse(s);
}
async function getCsv(url,limit){
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Upstream CSV HTTP '+r.status);
  const s=await r.text();
  if(s.length>limit)throw Error('Source CSV exceeded size limit');
  return s;
}
const meta=await getJson(releaseUrl);
const asset=meta.assets?.find(a=>a.name==='injuries_'+season+'.csv');
if(!asset||!asset.updated_at||Date.parse(asset.updated_at)>now+60000)
  throw Error('Current season injury report metadata missing or invalid');
const [injuriesText,scheduleText]=await Promise.all([
  getCsv(injuriesUrl,8000000),getCsv(schedulesUrl,12000000)
]);
console.log('Current nflverse injury source column names:',injuriesText.split(/\r?\n/)[0]);
const rows=parseGenericCsv(injuriesText);
const data=compileInjuryReports(rows,{season,sourceUpdatedAt:asset.updated_at,now});
const schedule=parseCsv(scheduleText);
const today=new Date(now).toISOString().slice(0,10);
const fixtures=schedule.filter(row=>
  Number(row.season)===season&&row.home_score===''&&row.away_score===''&&
  /^\d{4}-\d{2}-\d{2}$/.test(row.gameday)&&row.gameday>=today&&
  row.gameday<=new Date(now+14*86400000).toISOString().slice(0,10)
).map(row=>({
  gameId:row.game_id,week:Number(row.week),gameDate:row.gameday,
  home:row.home_team,away:row.away_team
})).filter(x=>x.gameId&&Number.isInteger(x.week)&&x.week>0);
data.fixtures=fixtures;
data.validUntil=new Date(Date.parse(asset.updated_at)+72*3600000).toISOString();
const path='data/nfl_injuries.json';
const prev=await readFile(path,'utf8').then(JSON.parse).catch(()=>null);
if(prev?.sourceUpdatedAt===data.sourceUpdatedAt&&
   JSON.stringify(prev.fixtures)===JSON.stringify(data.fixtures)){
  console.log('No source-vintage or upcoming fixture changes');
  process.exit(0);
}
await mkdir(dirname(path),{recursive:true});
await writeFile(path,JSON.stringify(data,null,2)+'\n','utf8');
console.log(JSON.stringify({
  season,sourceUpdatedAt:data.sourceUpdatedAt,reportCount:data.reportCount,
  upcomingFixtures:fixtures.length,reportedPlayers:rows.length,
  caveat:'Injury status is reported, not a verified starting QB decision or probability adjustment'
},null,2));
