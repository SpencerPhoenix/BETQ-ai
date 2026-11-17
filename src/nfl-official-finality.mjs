/** Offline interpretation of an observed NFL weekly page, not upstream independence. */
import {createHash} from 'node:crypto';
import {NFL_TEAMS} from './nfl-elo.mjs';
export const OFFICIAL_FINALITY_POLICY='NFL_OFFICIAL_WEEKLY_OBSERVATION_V1';
const fail=message=>{throw Error(message);};
const instant=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const day=s=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const hash=s=>createHash('sha256').update(s).digest('hex');
const score=s=>Number.isSafeInteger(s)&&s>=0&&s<=100;
export const officialWeeklyUrl=(season,week)=>{
  if(!Number.isInteger(season)||season<2020||season>2100||!Number.isInteger(week)||week<1||week>18)fail('INVALID_WEEK_SCOPE');
  return `https://www.nfl.com/scores/${season}/week-${week}`;
};
/** Parse only JSON from Next flight script strings; never execute source scripts. */
export function parseOfficialWeeklyPage(html,{season,week,observedAt,sourceUrl}={}){
  if(typeof html!=='string'||Buffer.byteLength(html)>8000000||!instant(observedAt)||sourceUrl!==officialWeeklyUrl(season,week))fail('INVALID_OFFICIAL_PAGE_CONTEXT');
  let flight='';
  for(const m of html.matchAll(/<script[^>]*>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)){
    let chunk;try{chunk=JSON.parse(m[1]);}catch{fail('INVALID_FLIGHT_JSON');}
    if(chunk[0]===1&&typeof chunk[1]==='string')flight+=chunk[1];
  }
  const matches=[];
  function walk(v,depth=0){
    if(depth>40)fail('OFFICIAL_JSON_DEPTH_LIMIT');
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v.queries))for(const q of v.queries){
      if(q?.queryKey?.[0]!=='useFetchFootballWeeklyGameDetails')continue;
      const scope=q.queryKey[1];
      if(String(scope?.season)!==String(season)||scope?.week!==week||scope?.seasonType!=='REG')fail('OFFICIAL_QUERY_SCOPE_MISMATCH');
      if(q.state?.status!=='success'||!Array.isArray(q.state?.data))fail('OFFICIAL_QUERY_UNAVAILABLE');
      matches.push(q.state.data);
    }
    for(const x of Object.values(v))walk(x,depth+1);
  }
  for(const line of flight.split('\n')){
    const m=/^[a-f0-9]+:(.*)$/.exec(line);if(!m||!['[','{'].includes(m[1][0]))continue;
    let v;try{v=JSON.parse(m[1]);}catch{continue;}walk(v);
  }
  if(matches.length!==1||matches[0].length<1||matches[0].length>16)fail('OFFICIAL_WEEK_QUERY_MISSING_OR_AMBIGUOUS');
  const seen=new Set(),providerIds=new Set(),games=[];
  for(const g of matches[0]){
    const home=NFL_TEAMS[g.homeTeam?.fullName],away=NFL_TEAMS[g.awayTeam?.fullName],s=g.summary;
    if(g.season!==season||g.week!==week||g.seasonType!=='REG'||!home||!away||home===away||
      !instant(g.time)||typeof g.neutralSite!=='boolean'||typeof g.id!=='string'||!g.id||providerIds.has(g.id))fail('OFFICIAL_GAME_IDENTITY_INVALID');
    const gameId=`${season}_${String(week).padStart(2,'0')}_${away}_${home}`;
    if(seen.has(gameId))fail('OFFICIAL_GAME_DUPLICATE');seen.add(gameId);providerIds.add(g.id);
    // The schedule entity's status stays SCHEDULED even after completion.
    // Require the separate summary's FINAL phase AND END_OF_GAME quarter.
    const final=s?.phase==='FINAL'&&s?.quarter==='END_OF_GAME';
    if(final&&!['SCHEDULED','FINAL'].includes(g.status))fail('OFFICIAL_SCHEDULE_STATUS_CONFLICT');
    if((s?.phase==='FINAL')!==(s?.quarter==='END_OF_GAME'))fail('OFFICIAL_FINAL_STATE_CONFLICT');
    let homeScore=null,awayScore=null;
    if(final){
      if(s.gameId!==g.id||s.homeTeam?.teamId!==g.homeTeam.id||s.awayTeam?.teamId!==g.awayTeam.id||
        !score(s.homeTeam?.score?.total)||!score(s.awayTeam?.score?.total)||Date.parse(g.time)>=Date.parse(observedAt))fail('OFFICIAL_FINAL_SCORE_INVALID');
      homeScore=s.homeTeam.score.total;awayScore=s.awayTeam.score.total;
    }
    games.push({gameId,providerGameId:g.id,season,week,home,away,kickoff:new Date(g.time).toISOString(),
      gameDate:day(g.time),neutralSite:g.neutralSite,scheduleStatus:g.status??null,summaryPhase:s?.phase??null,summaryState:s==null?'ABSENT':typeof s==='object'&&!Array.isArray(s)&&typeof s.phase==='string'?'PRESENT':'MALFORMED',final,homeScore,awayScore});
  }
  return {schema:1,policy:OFFICIAL_FINALITY_POLICY,sourceUrl,season,week,observedAt:new Date(observedAt).toISOString(),
    sourcePublishedAt:null,sourceBodySha256:hash(html),games,
    sourceUpstreamIndependenceVerified:false,sourceAuthenticityIndependentlyAttested:false,
    completeLeagueCoverageVerified:false,historicalAvailabilityProven:false,aggregateScoringEligible:false};
}
function validateReceipt(r){
  if(r?.schema!==1||r.policy!==OFFICIAL_FINALITY_POLICY||r.sourceUrl!==officialWeeklyUrl(r.season,r.week)||
    !instant(r.observedAt)||r.sourcePublishedAt!==null||!/^[a-f0-9]{64}$/.test(r.sourceBodySha256)||
    !Array.isArray(r.games)||r.games.length<1||r.games.length>16||
    ['sourceUpstreamIndependenceVerified','sourceAuthenticityIndependentlyAttested','completeLeagueCoverageVerified','historicalAvailabilityProven','aggregateScoringEligible'].some(k=>r[k]!==false))fail('INVALID_OFFICIAL_RECEIPT');
  const ids=new Set(),providers=new Set();
  for(const g of r.games){
    if(g.season!==r.season||g.week!==r.week||!Object.values(NFL_TEAMS).includes(g.home)||!Object.values(NFL_TEAMS).includes(g.away)||g.home===g.away||
      g.gameId!==`${r.season}_${String(r.week).padStart(2,'0')}_${g.away}_${g.home}`||ids.has(g.gameId)||
      typeof g.providerGameId!=='string'||!g.providerGameId||providers.has(g.providerGameId)||!instant(g.kickoff)||g.gameDate!==day(g.kickoff)||
      typeof g.final!=='boolean'||typeof g.neutralSite!=='boolean'||
      (g.final?(!score(g.homeScore)||!score(g.awayScore)||Date.parse(g.kickoff)>=Date.parse(r.observedAt)):(g.homeScore!==null||g.awayScore!==null)))fail('INVALID_OFFICIAL_RECEIPT_GAME');
    ids.add(g.gameId);providers.add(g.providerGameId);
  }
}
/** Scope must be explicit: never call a single observed week a whole-season audit. */
export function reconcileTrainingFinality(games,receipts,{season,weeks,asOf,maxObservationAgeMs=6*3600000}={}){
  if(!Array.isArray(games)||!Array.isArray(receipts)||!Array.isArray(weeks)||!weeks.length||weeks.length>18||new Set(weeks).size!==weeks.length||
    !instant(asOf)||!Number.isFinite(maxObservationAgeMs)||maxObservationAgeMs<0||maxObservationAgeMs>86400000)fail('INVALID_TRAINING_FINALITY_SCOPE');
  weeks.forEach(w=>officialWeeklyUrl(season,w));
  const now=Date.parse(asOf),issues=[],byWeek=new Map(),teams={};
  for(const r of receipts){validateReceipt(r);if(r.season!==season||!weeks.includes(r.week))continue;
    if(Date.parse(r.observedAt)>now||now-Date.parse(r.observedAt)>maxObservationAgeMs){issues.push({week:r.week,reason:'STALE_OR_FUTURE_OBSERVATION'});continue;}
    if(byWeek.has(r.week)){issues.push({week:r.week,reason:'AMBIGUOUS_WEEK_RECEIPTS'});continue;}byWeek.set(r.week,r);
  }
  const selected=games.filter(g=>g.season===season&&weeks.includes(g.week)),source=new Map();
  for(const g of selected){if(source.has(g.id))issues.push({gameId:g.id,reason:'DUPLICATE_TRAINING_GAME'});source.set(g.id,g);}
  const official=new Map();
  for(const w of weeks){const r=byWeek.get(w);if(!r){issues.push({week:w,reason:'MISSING_WEEK_RECEIPT'});continue;}
    for(const g of r.games){official.set(g.gameId,g);for(const team of [g.home,g.away]){
      teams[team]??={observedScheduled:0,observedFinal:0,matchedFinal:0};teams[team].observedScheduled++;if(g.final)teams[team].observedFinal++;
    }
    if(g.final&&!source.has(g.gameId))issues.push({gameId:g.gameId,reason:'OFFICIAL_FINAL_MISSING_FROM_TRAINING'});
    }
  }
  let matched=0;
  for(const g of selected){const o=official.get(g.id);
    const reason=!o?'TRAINING_GAME_MISSING_FROM_OFFICIAL_WEEK':!o.final?'TRAINING_GAME_NOT_OBSERVED_FINAL':
      o.home!==g.home||o.away!==g.away||o.gameDate!==g.date?'GAME_IDENTITY_CONFLICT':
      o.homeScore!==g.homeScore||o.awayScore!==g.awayScore?'FINAL_SCORE_CONFLICT':o.neutralSite!==g.neutral?'VENUE_CONFLICT':null;
    if(reason){issues.push({gameId:g.id,reason});continue;}matched++;for(const team of [g.home,g.away])teams[team].matchedFinal++;
  }
  return {policy:OFFICIAL_FINALITY_POLICY,scope:{season,weeks:[...weeks].sort((a,b)=>a-b)},asOf:new Date(now).toISOString(),
    available:issues.length===0&&matched>0,matchedFinalGames:matched,trainingGamesInScope:selected.length,
    trainingGamesOutsideScope:games.length-selected.length,maxObservationAgeMs,
    receiptIdentities:[...byWeek.values()].map(r=>({week:r.week,sourceUrl:r.sourceUrl,observedAt:r.observedAt,sourceBodySha256:r.sourceBodySha256})),teams,issues,
    sourceUpstreamIndependenceVerified:false,completeLeagueCoverageVerified:false,aggregateScoringEligible:false};
}
export function assertTrainingFinalityCoverage(games,receipts,options){
  const report=reconcileTrainingFinality(games,receipts,options);
  if(!report.available)fail('TRAINING_FINALITY_COVERAGE_BLOCKED:'+report.issues.map(x=>x.reason).join(','));
  return report;
}
/** Reject misspelled or duplicate gate flags instead of silently bypassing checks. */
export function trainingReceiptOptions(args,{otherFlags=[]}={}){
  const allowed=new Set(['--finality-receipts','--finality-weeks',...otherFlags]),values=new Map();
  if(!Array.isArray(args))fail('INVALID_TRAINING_ARGUMENTS');
  for(let i=0;i<args.length;i+=2){
    const flag=args[i],value=args[i+1];
    if(!allowed.has(flag)||values.has(flag)||typeof value!=='string'||!value||value.startsWith('--'))fail('UNKNOWN_DUPLICATE_OR_MISSING_TRAINING_ARGUMENT');
    values.set(flag,value);
  }
  if(values.has('--finality-receipts')!==values.has('--finality-weeks'))fail('FINALITY_RECEIPTS_AND_WEEKS_REQUIRED');
  if(!values.has('--finality-receipts'))return null;
  const weeks=values.get('--finality-weeks').split(',');
  if(weeks.some(w=>!/^([1-9]|1[0-8])$/.test(w))||new Set(weeks).size!==weeks.length)fail('INVALID_FINALITY_WEEKS');
  return {path:values.get('--finality-receipts'),weeks:weeks.map(Number)};
}
