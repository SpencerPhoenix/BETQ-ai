/** Read-only public summary. Never returns raw bookmaker prices, quota, stakes,
 * recommendations or a fresh slate. Saved observations remain useful after TTL. */
import {validateOddsSnapshot} from './odds-snapshot-store.mjs';
export function retainedOddsObservation(record,{accountId,market,now=Date.now()}={}){
  if(!['h2h','spreads','totals'].includes(market))throw Error('INVALID_MARKET');
  if(record===null)return {available:false,reason:'NO_SAVED_OBSERVATION',actionable:false};
  const saved=validateOddsSnapshot(record,{accountId,cacheId:`odds:americanfootball_nfl:${market}`,now});
  const ageMs=now-Date.parse(saved.receivedAt);
  return {available:true,source:'SAVED_PROVIDER_OBSERVATION',sport:'americanfootball_nfl',market,
    receivedAt:saved.receivedAt,ageSeconds:Math.floor(ageMs/1000),stale:ageMs>=300000,
    label:ageMs>=300000?'Saved data · out of date':'Saved data · not a live refresh',
    actionable:false,rankingAllowed:false,refreshAuthorized:false,
    events:saved.events.map(e=>({id:e.id,homeTeam:e.home_team,awayTeam:e.away_team,
      commenceTime:e.commence_time,scheduleVerified:false,bookmakerCount:e.bookmakers.length,
      latestQuoteAt:e.bookmakers.map(b=>b.markets[0].last_update??b.last_update).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)??null}))};
}
