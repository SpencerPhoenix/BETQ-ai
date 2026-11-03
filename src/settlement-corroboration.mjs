/**
 * Research-only independent final-score corroboration.
 *
 * nflverse supplies the recorded schedule and score. A separate publisher's
 * explicit final-status response must corroborate teams, UTC kickoff window,
 * season and BOTH scores before this module returns an attestation.
 *
 * ESPN's public Site API is UNOFFICIAL and not guaranteed to stay available;
 * unavailability never converts a provisional score into a verified final.
 * No odds, wagering, bookmaker identity or private pricing is stored.
 */
import {createHash} from 'node:crypto';

export const FREE_SCOREBOARD_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const MAX_DATES=4,MAX_JSON_CHARS=2_500_000;
const MAX_KICK_DIFFERENCE_MS=6*3600000;
const names=Object.freeze({WSH:'WAS',JAC:'JAX',LAR:'LA',STL:'LA',OAK:'LV',SD:'LAC'});
const canonical=value=>{
  if(typeof value!=='string'||!/^[A-Za-z]{2,3}$/.test(value))return null;
  const upper=value.toUpperCase();
  return names[upper]??upper;
};
const score=x=>typeof x==='string'&&/^\d{1,3}$/.test(x)&&Number(x)<=100?Number(x):null;
const iso=n=>new Date(n).toISOString();
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const dateKey=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)
  ?day.replaceAll('-',''):null;
const eventFinal=e=>{
  const a=e?.status?.type,b=e?.competitions?.[0]?.status?.type;
  return [a,b].some(x=>x?.completed===true&&x?.name==='STATUS_FINAL') &&
    ![a,b].some(x=>x&&(x.completed===false||x.name&&x.name!=='STATUS_FINAL'));
};
function verifiedEvent(candidate,game,event,rawHash,observedAt){
  if(!event||!game||event.season?.year!==game.season||
     !/^\d{6,20}$/.test(String(event.id||''))||!eventFinal(event))return null;
  const scheduled=Date.parse(event.date);
  if(!Number.isFinite(scheduled)||Math.abs(scheduled-game.kickoff)>MAX_KICK_DIFFERENCE_MS)
    return null;
  const comps=event.competitions;
  if(!Array.isArray(comps)||comps.length!==1)return null;
  const competitors=comps[0]?.competitors;
  if(!Array.isArray(competitors)||competitors.length!==2)return null;
  const home=competitors.find(x=>x.homeAway==='home');
  const away=competitors.find(x=>x.homeAway==='away');
  if(!home||!away||
     canonical(home.team?.abbreviation)!==game.home||
     canonical(away.team?.abbreviation)!==game.away)return null;
  if(score(home.score)!==candidate.homeScore||score(away.score)!==candidate.awayScore)
    return null;
  return {
    status:'CROSS_SOURCE_FINAL',
    corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
    eventId:String(event.id),
    observedAt,sourceSha256:rawHash,
    officialLeagueCertification:false
  };
}

/**
 * Validate a single pre-fetched scoreboard without network access.
 * Ambiguous multiple matches are rejected, not selected by array order.
 */
export function matchFinalFromScoreboard(candidate,game,payload,{observedAt,sourceSha256}={}){
  if(!candidate||!game||!payload||!Array.isArray(payload.events)||
     payload.events.length>100||typeof sourceSha256!=='string'||
     !/^[a-f0-9]{64}$/.test(sourceSha256)||
     !Number.isFinite(Date.parse(observedAt)))return null;
  const matched=payload.events.map(e=>
    verifiedEvent(candidate,game,e,sourceSha256,observedAt)).filter(Boolean);
  return matched.length===1?matched[0]:null;
}

/**
 * Only one fixed public read-only scoreboard endpoint per distinct local
 * gameday. The scoreboard provider is an unsupported secondary source;
 * outages leave games unattested. No retries or paid provider requests.
 */
export async function corroborateFinals(journal,candidates,{
  fetchImpl=globalThis.fetch,clock=Date.now
}={}){
  if(!journal||!Array.isArray(journal.snapshots)||!Array.isArray(candidates)||
     typeof fetchImpl!=='function'||typeof clock!=='function')
    throw Error('INVALID_CORROBORATION_INPUT');
  const games=new Map();
  for(const s of journal.snapshots){
    const game={season:s.season,home:canonical(s.home),away:canonical(s.away),
      kickoff:Date.parse(s.commenceTime),day:s.gameDate};
    const previous=games.get(s.gameId);
    if(previous&&(previous.season!==game.season||previous.home!==game.home||
      previous.away!==game.away||previous.kickoff!==game.kickoff||
      previous.day!==game.day))throw Error('CORROBORATOR_TRACKED_GAME_CONFLICT');
    games.set(s.gameId,game);
  }
  const dates=[...new Set(candidates.map(c=>dateKey(c.gameDate)).filter(Boolean))].sort();
  const checkedDates=dates.slice(0,MAX_DATES);
  const attestations={};
  const unavailable=[];
  let received=0;
  for(const day of checkedDates){
    const url=FREE_SCOREBOARD_BASE+'?dates='+day;
    try{
      const response=await fetchImpl(url,{
        method:'GET',headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(12000)
      });
      if(!response?.ok)throw Error('SECOND_SOURCE_HTTP_UNAVAILABLE');
      const raw=await response.text();
      if(typeof raw!=='string'||raw.length>MAX_JSON_CHARS)
        throw Error('SECOND_SOURCE_INVALID_SIZE');
      const payload=JSON.parse(raw);
      if(!payload||!Array.isArray(payload.events))throw Error('SECOND_SOURCE_INVALID_SCHEMA');
      const sourceSha256=digest(raw),observedAt=iso(clock());
      received++;
      for(const candidate of candidates.filter(c=>dateKey(c.gameDate)===day)){
        const match=matchFinalFromScoreboard(candidate,games.get(candidate.gameId),
          payload,{observedAt,sourceSha256});
        if(match)attestations[candidate.gameId]=match;
      }
    }catch{
      unavailable.push(day); // no claim of completed status; no untrusted provider details
    }
  }
  return {
    attestations,eligibleCandidates:candidates.length,
    confirmed:Object.keys(attestations).length,
    unconfirmed:candidates.length-Object.keys(attestations).length,
    checkedDates,unavailableDates:unavailable,
    deferredDates:dates.slice(MAX_DATES),source:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
    paidOddsCalls:0
  };
}
