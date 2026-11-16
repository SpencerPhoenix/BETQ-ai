/** Official club observations are separate contextual evidence, never model inputs. */
import {createHash} from 'node:crypto';
import {NFL_TEAMS} from './nfl-elo.mjs';
export const OFFICIAL_INJURY_URL='https://www.chargers.com/team/injury-report/';
export const OFFICIAL_REVIEW_MAX_AGE_MS=6*3600000;
const statuses=new Set(['OUT','DOUBTFUL','QUESTIONABLE','NO_GAME_STATUS']);
const clean=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const utc=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)).toISOString()===s;
const keys=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
const short=s=>typeof s==='string'&&s.length>0&&s.length<=100&&!/[\u0000-\u001f<>]/.test(s);
export function parseOfficialClubReport(html,{season,week,home,away}){
  if(typeof html!=='string'||Buffer.byteLength(html)>1000000||!Number.isInteger(season)||!Number.isInteger(week))throw Error('OFFICIAL_REPORT_INVALID');
  const selected=[...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].filter(m=>/\bselected\b/i.test(m[1]));
  if(selected.length!==1||!new RegExp(`value=["']/team/injury-report/week/REG-${week}["']`).test(selected[0][1])||
    !html.includes(`into the ${season} season`))throw Error('OFFICIAL_REPORT_GAME_CONTEXT_MISMATCH');
  const sections=[...html.matchAll(/<span class="nfl-o-injury-report__club-name">([\s\S]*?)<\/span>[\s\S]*?<table\b[^>]*>([\s\S]*?)<\/table>/g)];
  if(sections.length!==2)throw Error('OFFICIAL_REPORT_TEAM_TABLES_MISSING');
  const reports={};
  for(const [,label,table] of sections){
    const team=NFL_TEAMS[clean(label)];
    if(![home,away].includes(team)||reports[team])throw Error('OFFICIAL_REPORT_TEAM_MISMATCH');
    const head=[...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>clean(m[1]));
    if(head.length!==7||head[0]!=='Player'||head[1]!=='Position'||head[2]!=='Injury'||head[6]!=='Game Status')throw Error('OFFICIAL_REPORT_COLUMNS_CHANGED');
    const body=table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
    if(!body)throw Error('OFFICIAL_REPORT_ROWS_MISSING');
    const players=[];const seen=new Set();
    for(const [,row] of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
      const name=cells[0]?.match(/<span class="d3-o-player-roster__player-name">([\s\S]*?)<\/span>/)?.[1];
      if(cells.length!==7||!name)throw Error('OFFICIAL_REPORT_ROW_CHANGED');
      const player=clean(name),position=clean(cells[1]),injury=clean(cells[2]);
      const raw=clean(cells[6]).toUpperCase();const status=raw==='(-)'?'NO_GAME_STATUS':raw;
      if(!short(player)||!short(position)||!short(injury)||!statuses.has(status)||seen.has(norm(player)))throw Error('OFFICIAL_REPORT_PLAYER_INVALID');
      seen.add(norm(player));players.push({player,position,injury,status});
    }
    if(!players.length||players.length>100)throw Error('OFFICIAL_REPORT_PLAYER_COUNT_INVALID');
    reports[team]=players;
  }
  return reports;
}
export function createOfficialInjuryReceipt(html,{gameId,season,week,home,away,kickoff,observedAt}){
  const receipt={schema:1,source:'OFFICIAL_CLUB_WEBPAGE',sourceUrl:OFFICIAL_INJURY_URL,
    gameId,season,week,home,away,kickoff,observedAt,sourcePublishedAt:null,
    scheduleBasis:'UNANIMOUS_RETAINED_KICKOFF',bodySha256:createHash('sha256').update(html).digest('hex'),
    reports:parseOfficialClubReport(html,{season,week,home,away})};
  validateOfficialInjuryReceipt(receipt);return receipt;
}
export function validateOfficialInjuryReceipt(r){
  const bad=()=>{throw Error('INVALID_OFFICIAL_INJURY_RECEIPT');};
  if(!keys(r,['schema','source','sourceUrl','gameId','season','week','home','away','kickoff','observedAt','sourcePublishedAt','scheduleBasis','bodySha256','reports'])||
    r.schema!==1||r.source!=='OFFICIAL_CLUB_WEBPAGE'||r.sourceUrl!==OFFICIAL_INJURY_URL||
    !Number.isInteger(r.season)||r.season<2020||r.season>2100||!Number.isInteger(r.week)||r.week<1||r.week>18||
    (new Date(r.kickoff).getUTCFullYear()-(new Date(r.kickoff).getUTCMonth()<2?1:0))!==r.season||
    !Object.values(NFL_TEAMS).includes(r.home)||!Object.values(NFL_TEAMS).includes(r.away)||r.home===r.away||![r.home,r.away].includes('LAC')||
    r.gameId!==`${r.season}_${String(r.week).padStart(2,'0')}_${r.away}_${r.home}`||!utc(r.kickoff)||!utc(r.observedAt)||
    Date.parse(r.observedAt)>=Date.parse(r.kickoff)||Date.parse(r.kickoff)-Date.parse(r.observedAt)>7*86400000||
    r.sourcePublishedAt!==null||r.scheduleBasis!=='UNANIMOUS_RETAINED_KICKOFF'||!(/^[a-f0-9]{64}$/).test(r.bodySha256)||
    !keys(r.reports,[r.home,r.away])||Object.keys(r.reports).length!==2)bad();
  for(const team of [r.home,r.away]){
    const rows=r.reports[team];if(!Array.isArray(rows)||rows.length<1||rows.length>100)bad();
    const seen=new Set();
    for(const p of rows){
      if(!keys(p,['player','position','injury','status'])||!short(p.player)||!short(p.position)||!short(p.injury)||!statuses.has(p.status)||seen.has(norm(p.player)))bad();
      seen.add(norm(p.player));
    }
  }
  return r;
}
export function reconcileOfficialInjuries(receipt,nflverse,{now=Date.now()}={}){
  try{validateOfficialInjuryReceipt(receipt);}catch{return {available:false,reason:'OFFICIAL_REPORT_INVALID'};}
  const age=now-Date.parse(receipt.observedAt);
  const reason=!Number.isFinite(now)||age<0?'OFFICIAL_OBSERVATION_IN_FUTURE':
    now>=Date.parse(receipt.kickoff)?'GAME_STARTED':age>=OFFICIAL_REVIEW_MAX_AGE_MS?'OFFICIAL_OBSERVATION_EXPIRED':null;
  const conflicts=[],unmatched=[];
  for(const team of [receipt.home,receipt.away])for(const p of receipt.reports[team]){
    const peers=nflverse?.season===receipt.season ? nflverse?.reports?.[`${team}:${receipt.week}`]?.flaggedPlayers||[] : [];
    const other=peers.find(x=>norm(x.player)===norm(p.player));
    if(other&&other.status!==p.status)conflicts.push({team,player:p.player,officialStatus:p.status,nflverseStatus:other.status});
    else if(!other&&p.status!=='NO_GAME_STATUS')unmatched.push({team,player:p.player,officialStatus:p.status,reason:'NOT_IN_RETAINED_NFLVERSE_FLAGGED_LIST'});
  }
  return {available:reason===null,reason,gameId:receipt.gameId,home:receipt.home,away:receipt.away,
    kickoff:receipt.kickoff,source:receipt.source,sourceUrl:receipt.sourceUrl,
    observedAt:receipt.observedAt,sourcePublishedAt:null,
    validUntil:new Date(Math.min(Date.parse(receipt.kickoff),Date.parse(receipt.observedAt)+OFFICIAL_REVIEW_MAX_AGE_MS)).toISOString(),
    freshnessBasis:'FETCH_OBSERVATION_ONLY',coverage:'INJURY_REPORT_NOT_GAME_DAY_INACTIVES',
    scheduleBasis:receipt.scheduleBasis,bodySha256:receipt.bodySha256,
    nflverseSourceUpdatedAt:nflverse?.sourceUpdatedAt||null,
    officialFlaggedPlayers:reason?[]:[receipt.home,receipt.away].flatMap(team=>receipt.reports[team].filter(p=>p.status!=='NO_GAME_STATUS').map(p=>({team,...p}))),
    conflicts:reason?[]:conflicts,unmatched:reason?[]:unmatched,
    starterVerified:false,probabilitiesAdjusted:false,
    caveat:'Observed official club webpage, not confirmed inactives or current availability. Fetch time is not publication time. Missing/no-status players are not assumed healthy. Conflicting sources remain separate; no model adjustment.'};
}
export function officialInjuryReviews(artifact,nflverse,{now=Date.now()}={}){
  if(!artifact||artifact.schema!==1||!Array.isArray(artifact.receipts)||artifact.receipts.length>64)return [];
  const latest=new Map(),ambiguous=new Set();
  for(const r of artifact.receipts){
    try{validateOfficialInjuryReceipt(r);}catch{continue;}
    if(Date.parse(r.observedAt)>now)continue;
    const prev=latest.get(r.gameId);
    if(prev&&r.observedAt===prev.observedAt&&JSON.stringify(r)!==JSON.stringify(prev)){ambiguous.add(r.gameId);continue;}
    if(!prev||r.observedAt>prev.observedAt){latest.set(r.gameId,r);ambiguous.delete(r.gameId);}
  }
  return [...latest.values()].map(r=>ambiguous.has(r.gameId)?{available:false,reason:'OFFICIAL_RECEIPT_CONFLICT',gameId:r.gameId,home:r.home,away:r.away}:reconcileOfficialInjuries(r,nflverse,{now}));
}
