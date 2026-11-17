/** Source-load-stamped depth chart context. Never a starter confirmation or model feature. */
import {readBoundedText} from './integrity.mjs';
import {NFL_TEAMS} from './nfl-elo.mjs';
const teams=new Set(Object.values(NFL_TEAMS));
export const DEPTH_URL='https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/nfl_depth_context.json';
const iso=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
export function validateDepthContext(a,now=Date.now()){
 if(!Number.isFinite(now)||!a||Object.keys(a).some(k=>!['schema','season','source','sourceUrl','sourceLoadAt','collectedAt','sourceSha256','teams'].includes(k))||a.schema!==1||a.source!=='NFLVERSE_DEPTH_CHARTS'||!Number.isInteger(a.season)||a.season<2025||a.season>2100||
 a.sourceUrl!==`https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_${a.season}.csv.gz`||
 !iso(a.sourceLoadAt)||!iso(a.collectedAt)||Date.parse(a.sourceLoadAt)>Date.parse(a.collectedAt)||Date.parse(a.collectedAt)>now||
 !/^[a-f0-9]{64}$/.test(a.sourceSha256)||!a.teams||Object.keys(a.teams).length!==32)throw Error('INVALID_DEPTH_CONTEXT');
 for(const [t,p] of Object.entries(a.teams))if(!teams.has(t)||!p||Object.keys(p).some(k=>!['player','playerId'].includes(k))||typeof p.player!=='string'||!p.player.trim()||p.player.length>100||/[\x00-\x1f]/.test(p.player)||!/^\d{1,12}$/.test(p.playerId))throw Error('INVALID_DEPTH_CONTEXT');
 return a;
}
export function depthContextForGame(a,gameId,fixture,now=Date.now()){
 const base={available:false,starterVerified:false,probabilitiesAdjusted:false,reason:'DEPTH_CONTEXT_UNAVAILABLE',teams:[]};
 try{validateDepthContext(a,now);}catch{return base;}
 const m=/^(\d{4})_\d{2}_([A-Z]+)_([A-Z]+)$/.exec(gameId||'');
 if(!m||Number(m[1])!==a.season||!teams.has(m[2])||!teams.has(m[3])||m[2]===m[3]||(NFL_TEAMS[fixture?.away]||fixture?.away)!==m[2]||(NFL_TEAMS[fixture?.home]||fixture?.home)!==m[3]||!iso(fixture?.kickoff))return {...base,reason:'MATCHUP_IDENTITY_UNVERIFIED'};
 const validUntil=new Date(Math.min(Date.parse(a.sourceLoadAt)+86400000,Date.parse(fixture.kickoff))).toISOString();
 const metadata={sourceUrl:a.sourceUrl,sourceLoadAt:a.sourceLoadAt,collectedAt:a.collectedAt,sourceSha256:a.sourceSha256,validUntil,
 caveat:'nflverse / CC-BY-4.0. Source-load time is not announcement time. Listed QB1 is not a confirmed starter, injury clearance, or probability adjustment.'};
 if(now>=Date.parse(validUntil))return {...base,...metadata,reason:'DEPTH_CONTEXT_STALE_OR_GAME_STARTED'};
 return {...base,...metadata,available:true,reason:null,teams:[m[2],m[3]].map(team=>({team,player:a.teams[team].player,playerId:a.teams[team].playerId}))};
}
export function createDepthContextFeed({artifact=null,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 let retained=null,expires=0,pending=null;
 try{retained=structuredClone(validateDepthContext(artifact,clock()));}catch{}
 return {async get(){
  if(clock()<expires)return retained;
  if(pending)return pending;
  pending=(async()=>{try{
   if(typeof fetchImpl==='function'){
    const r=await fetchImpl(DEPTH_URL,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(6000)});
    if(!r.ok)throw Error('UNAVAILABLE');
    const a=validateDepthContext(JSON.parse(await readBoundedText(r,20000)),clock());
    if(!retained||Date.parse(a.sourceLoadAt)>=Date.parse(retained.sourceLoadAt))retained=a;
   }
  }catch{/* Retained observations still expire at read time. */}finally{expires=clock()+300000;pending=null;}
  return retained;})();
  return pending;
 }};
}
