/** Current artifact evaluation independent of paid odds. Not an injury-adjusted betting model. */
import {NFL_TEAMS,predictNflEvent} from './nfl-elo.mjs';
import {describeModelDelivery} from './model-delivery.mjs';
import {challengerResearchForEvent} from './nfl-efficiency.mjs';
import {officialWeeklyUrl,parseOfficialWeeklyPage} from './nfl-official-finality.mjs';
import {readBoundedText} from './integrity.mjs';
const names=Object.fromEntries(Object.entries(NFL_TEAMS).map(([name,code])=>[code,name]));
export function gameScope(gameId){
 const m=/^(20\d{2})_(0[1-9]|1[0-8])_([A-Z]{2,3})_([A-Z]{2,3})$/.exec(gameId||'');
 if(!m||!names[m[3]]||!names[m[4]]||m[3]===m[4])throw Error('INVALID_GAME_ID');
 return {season:Number(m[1]),week:Number(m[2])};
}
export function createOfficialGameFeed({fetchImpl=globalThis.fetch,clock=Date.now}={}){
 const cache=new Map();
 return {async get(gameId){
  const {season,week}=gameScope(gameId),now=clock();
  if(Math.abs(season-new Date(now).getUTCFullYear())>1)return {available:false,reason:'SEASON_OUTSIDE_CURRENT_SCOPE'};
  const key=season+':'+week;let entry=cache.get(key);
  if(entry&&now<entry.until)return entry.promise;
  if(cache.size>=8)cache.delete(cache.keys().next().value);
  const promise=(async()=>{
   if(typeof fetchImpl!=='function')return {available:false,reason:'OFFICIAL_SCHEDULE_UNAVAILABLE'};
   try{
    const sourceUrl=officialWeeklyUrl(season,week);
    const response=await fetchImpl(sourceUrl,{credentials:'omit',redirect:'error',headers:{Accept:'text/html'},signal:AbortSignal.timeout(8000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('SOURCE_HTTP');
    const html=await readBoundedText(response,8000000);
    const receipt=parseOfficialWeeklyPage(html,{season,week,sourceUrl,observedAt:new Date(clock()).toISOString()});
    return {available:true,receipt};
   }catch{return {available:false,reason:'OFFICIAL_SCHEDULE_UNAVAILABLE'};}
  })();
  entry={promise,until:now+300000};cache.set(key,entry);return promise;
 }};
}
export function evaluateOnDemandGame(gameId,{schedule,artifact,challengerArtifact,now=Date.now()}={}){
 gameScope(gameId);
 const base={schema:1,gameId,evaluatedAt:new Date(now).toISOString(),use:'RESEARCH_ONLY',
  market:{available:false,reason:'NO_QUOTE_REQUESTED',providerCreditsUsed:0},
  injuryAdjusted:false,weatherAdjusted:false,verifiedStarters:false,verifiedBettingEdge:false,
  durablyArchived:false,gradeBaselineChanged:false,spreadProbability:null,totalProbability:null};
 if(!schedule?.available)return {...base,available:false,reason:schedule?.reason||'OFFICIAL_SCHEDULE_UNAVAILABLE'};
 const r=schedule.receipt,observed=Date.parse(r?.observedAt);
 if(!Number.isFinite(observed)||observed>now||now-observed>=300000)return {...base,available:false,reason:'SCHEDULE_OBSERVATION_STALE'};
 const matches=r.games.filter(g=>g.gameId===gameId);
 if(matches.length!==1)return {...base,available:false,reason:'OFFICIAL_MATCHUP_NOT_FOUND'};
 const g=matches[0];
 const fixture={home:names[g.home],away:names[g.away],kickoff:g.kickoff,neutralSite:g.neutralSite,
  sourceUrl:r.sourceUrl,observedAt:r.observedAt,sourcePublishedAt:null,sourceBodySha256:r.sourceBodySha256};
 if(g.final||Date.parse(g.kickoff)<=now)return {...base,fixture,available:false,reason:'GAME_STARTED_OR_COMPLETED'};
 if(g.scheduleStatus!=='SCHEDULED'||g.summaryPhase!=='PREGAME')return {...base,fixture,available:false,reason:'OFFICIAL_GAME_NOT_CONFIRMED_PREGAME'};
 const validUntil=new Date(Math.min(observed+300000,Date.parse(g.kickoff))).toISOString();
 const identity=describeModelDelivery(artifact,now);
 if(!identity.available)return {...base,fixture,available:false,reason:identity.reason};
 const event={home_team:fixture.home,away_team:fixture.away,commence_time:g.kickoff,neutralSite:g.neutralSite};
 const baseline=predictNflEvent(event,artifact,now);
 const challenger=baseline.available?challengerResearchForEvent(event,baseline.homeWinProbability,challengerArtifact,now):{available:false,reason:'BASELINE_UNAVAILABLE'};
 return {...base,validUntil,available:baseline.available,reason:baseline.reason||null,fixture,baseline,challenger,modelIdentity:identity,
  limitations:['Outcome-only baseline: no quarterback, injury or weather adjustment.','No current odds or spread/total probabilities.','Newly evaluated response, not an archived forecast or proven betting edge.']};
}
