/** Read only the already-published BETQ injury artifact, never a provider. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {NFL_TEAMS} from './nfl-elo.mjs';
import {readBoundedText,validDay} from './integrity.mjs';
import {injurySourceStatus,INJURY_MAX_AGE_MS} from './injuries.mjs';

export const PUBLIC_INJURY_ARTIFACT_URL=
  'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/nfl_injuries.json';
const teams=new Set(Object.values(NFL_TEAMS));
const utc=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)).toISOString()===s;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=100;
const short=(x,n)=>typeof x==='string'&&x.length>0&&x.length<=n&&!/[\u0000-\u001f]/.test(x);
const status=new Set(['OUT','DOUBTFUL','QUESTIONABLE','NOT_REPORTED']);
const keys=(x,allowed)=>Object.keys(x).every(k=>allowed.includes(k));
const seasonAt=n=>{const d=new Date(n);return d.getUTCFullYear()-(d.getUTCMonth()<2?1:0);};
const hash=x=>createHash('sha256').update(x).digest('hex');

export function validateInjuryArtifact(a,now=Date.now()){
  const bad=()=>{throw Error('INVALID_INJURY_ARTIFACT');};
  if(!object(a)||!keys(a,['schema','season','source','attribution','sourceUrl','sourceUpdatedAt','builtAt',
      'reportCount','ambiguousPlayerRecords','perPlayerTimestampsAvailable','reports','advisory','fixtures','validUntil'])||a.schema!==1||a.source!=='NFLVERSE_INJURIES'||
    !Number.isInteger(a.season)||a.season<2020||a.season>2100||!Number.isFinite(now)||a.season!==seasonAt(now)||
    a.sourceUrl!==`https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${a.season}.csv`||
    !utc(a.sourceUpdatedAt)||!utc(a.builtAt)||Date.parse(a.sourceUpdatedAt)>Date.parse(a.builtAt)||
    Date.parse(a.builtAt)>now||!utc(a.validUntil)||
    Date.parse(a.validUntil)!==Date.parse(a.sourceUpdatedAt)+INJURY_MAX_AGE_MS||
    typeof a.perPlayerTimestampsAvailable!=='boolean'||!object(a.reports)||
    Object.keys(a.reports).length!==a.reportCount||a.reportCount<1||a.reportCount>32*23||
    !Array.isArray(a.fixtures)||a.fixtures.length>100)bad();
  for(const [key,r] of Object.entries(a.reports)){
    if(!object(r)||!keys(r,['team','week','lastPlayerUpdate','individualTimestampAvailable','flaggedCount',
        'statusCounts','flaggedPlayers','reportedQBs','participationRecords'])||!teams.has(r.team)||!Number.isInteger(r.week)||r.week<1||r.week>23||
      key!==`${r.team}:${r.week}`||!utc(r.lastPlayerUpdate)||
      Date.parse(r.lastPlayerUpdate)>Date.parse(a.sourceUpdatedAt)||
      typeof r.individualTimestampAvailable!=='boolean'||
      (!r.individualTimestampAvailable&&r.lastPlayerUpdate!==a.sourceUpdatedAt)||
      (!a.perPlayerTimestampsAvailable&&r.individualTimestampAvailable)||
      !count(r.flaggedCount)||!object(r.statusCounts)||!keys(r.statusCounts,['out','doubtful','questionable'])||
      !['out','doubtful','questionable'].every(k=>count(r.statusCounts[k]))||
      r.flaggedCount!==r.statusCounts.out+r.statusCounts.doubtful+r.statusCounts.questionable)bad();
    if(r.participationRecords!==undefined){
      if(!Array.isArray(r.participationRecords)||r.participationRecords.length>100)bad();
      const seen=new Set();
      for(const p of r.participationRecords){
        if(!object(p)||!keys(p,['player','position','practiceParticipation','gameDesignation','inactiveStatus','practiceType','dateModified'])||
          !short(p.player,100)||!short(p.position,10)||seen.has(p.player)||
          !['DNP','LP','FP','NOT_REPORTED'].includes(p.practiceParticipation)||!status.has(p.gameDesignation)||
          p.inactiveStatus!=='NOT_VERIFIED'||p.practiceType!=='NOT_VERIFIED'||
          !(p.dateModified===null||(utc(p.dateModified)&&Date.parse(p.dateModified)<=Date.parse(a.sourceUpdatedAt)))||
          (!r.individualTimestampAvailable&&p.dateModified!==null))bad();
        const peers=[...(r.flaggedPlayers||[]),...(r.reportedQBs||[])].filter(x=>x.player===p.player);
        if(peers.some(x=>x.position!==p.position||x.status!==p.gameDesignation||x.dateModified!==p.dateModified))bad();
        seen.add(p.player);
      }
    }
    for(const field of ['flaggedPlayers','reportedQBs']){
      if(!Array.isArray(r[field])||r[field].length>100||
        (field==='flaggedPlayers'&&r[field].length!==r.flaggedCount&&r[field].length!==Math.min(8,r.flaggedCount)))bad();
      for(const player of r[field]){
        if(!object(player)||!keys(player,['player','position','status','injury','dateModified'])||!short(player.player,100)||!short(player.position,10)||!status.has(player.status)||
          (field==='flaggedPlayers'&&player.status==='NOT_REPORTED')||
          (field==='reportedQBs'&&player.position!=='QB')||
          !(player.injury===null||short(player.injury,200))||
          !(player.dateModified===null||(utc(player.dateModified)&&
            Date.parse(player.dateModified)<=Date.parse(a.sourceUpdatedAt)))||
          (!r.individualTimestampAvailable&&player.dateModified!==null))bad();
      }
    }
  }
  const ids=new Set();
  for(const f of a.fixtures){
    if(!object(f)||!keys(f,['gameId','week','gameDate','home','away'])||!teams.has(f.home)||!teams.has(f.away)||f.home===f.away||
      !Number.isInteger(f.week)||f.week<1||f.week>23||!validDay(f.gameDate)||seasonAt(Date.parse(f.gameDate+'T12:00:00Z'))!==a.season||
      f.gameId!==`${a.season}_${String(f.week).padStart(2,'0')}_${f.away}_${f.home}`||ids.has(f.gameId))bad();
    ids.add(f.gameId);
  }
  return a;
}

export function createInjuryReportFeed({fallbackArtifact=null,fetchImpl=globalThis.fetch,
  clock=Date.now,ttlMs=300000}={}){
  let artifact=null;
  try{artifact=structuredClone(validateInjuryArtifact(fallbackArtifact,clock()));}catch{/* Unusable bundles stay unavailable. */}
  let origin=artifact?'BUNDLED_ARTIFACT':'NO_RETAINED_ARTIFACT';
  let artifactSha256=artifact?hash(JSON.stringify(artifact)):null;
  let lastAttemptAt=null,lastSuccessfulFetchAt=null,lastError=null,httpStatus=null;
  let expires=0,pending=null;
  const metadata=()=>({source:origin,status:lastError?'REFRESH_FAILED_USING_RETAINED_ARTIFACT':origin,
    lastAttemptAt,lastSuccessfulFetchAt,lastError,httpStatus,artifactSha256,
    sourcePublicationTimeVerified:false});
  const statusNow=()=>({...injurySourceStatus(artifact,clock()),publication:metadata()});
  const result=()=>({artifact:structuredClone(artifact),status:statusNow()});
  async function get(){
    if(typeof fetchImpl!=='function'||clock()<expires)return result();
    if(pending){await pending;return result();}
    pending=(async()=>{
      lastAttemptAt=new Date(clock()).toISOString();httpStatus=null;
      try{
        const response=await fetchImpl(PUBLIC_INJURY_ARTIFACT_URL,{method:'GET',
          headers:{Accept:'application/json'},credentials:'omit',redirect:'error',
          signal:AbortSignal.timeout(10000)});
        httpStatus=response.status;
        if(!response.ok)throw Error('INJURY_ARTIFACT_UNAVAILABLE');
        const raw=await readBoundedText(response,1500000);
        const next=validateInjuryArtifact(JSON.parse(raw),clock());
        if(artifact&&(next.season<artifact.season||
          Date.parse(next.sourceUpdatedAt)<Date.parse(artifact.sourceUpdatedAt)||
          Date.parse(next.builtAt)<Date.parse(artifact.builtAt)||
          (next.sourceUpdatedAt===artifact.sourceUpdatedAt&&
            (next.season!==artifact.season||!isDeepStrictEqual(next.reports,artifact.reports)))))
          throw Error('INJURY_ARTIFACT_REGRESSION');
        artifact=next;artifactSha256=hash(raw);origin='PUBLIC_RETAINED_ARTIFACT';
        lastSuccessfulFetchAt=new Date(clock()).toISOString();lastError=null;
      }catch{
        lastError='PUBLIC_INJURY_ARTIFACT_UNAVAILABLE_OR_INVALID';
      }finally{expires=clock()+Math.max(60000,Number.isFinite(ttlMs)?ttlMs:300000);}
    })();
    try{await pending;}finally{pending=null;}
    return result();
  }
  return {get,status:statusNow};
}
