/**
 * Reads ONLY the derived, public BETQ forecast summary from the fixed GitHub
 * raw content URL; no arbitrary URL input and no third-party odds API credits.
 * This avoids requiring a Render redeploy on every evidence journal commit.
 */
import {readBoundedText} from './integrity.mjs';
const FIXED_SUMMARY_URL =
  'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/evidence/summary.json';

export function isValidEvidenceSummary(s) {
  return Boolean(s && s.schema===1 && Number.isInteger(s.season) &&
    s.season>=2020 && s.season<=2100 &&
    Number.isInteger(s.prospectiveGames) && s.prospectiveGames>=0 &&
    Number.isInteger(s.settledGames) && s.settledGames>=0 &&
    s.status && s.researchOnly===true && s.noWagering===true &&
    s.realizedROI===null && s.verifiedCLV===null &&
    s.marketBeatingEdgeEstablished===false &&
    s.settledGames<=s.prospectiveGames &&
    (s.sourceCorroboratedSettledGames==null ||
      (Number.isInteger(s.sourceCorroboratedSettledGames) &&
       s.sourceCorroboratedSettledGames>=0 &&
       s.sourceCorroboratedSettledGames<=s.settledGames)) &&
    (!s.forwardMetrics || ((s.sourceCorroboratedSettledGames??0)>=30 &&
      s.forwardMetrics.n===s.sourceCorroboratedSettledGames &&
      Number.isFinite(s.forwardMetrics.brier) && s.forwardMetrics.brier>=0 && s.forwardMetrics.brier<=1)) &&
    (!s.marketComparison || ((s.sourceCorroboratedSettledGames??0)>=30 &&
      s.marketComparison.n<=s.sourceCorroboratedSettledGames &&
      s.marketComparison.n<=s.pairedMarketGames &&
      s.marketComparison.n>=30)) &&
    (!s.challengerForwardComparison || (s.pairedChallengerSettled>=30 && s.challengerForwardComparison.n===s.pairedChallengerSettled &&
      s.pairedChallengerSettled<=s.settledGames))); 
}

export function createEvidenceFeed({
  fallback, fetchImpl=globalThis.fetch, clock=Date.now,
  ttlMs=300000, url=FIXED_SUMMARY_URL
}={}) {
  if(!isValidEvidenceSummary(fallback)) throw Error('Invalid fallback research evidence');
  let data=fallback,expires=0,pending=null,lastError=null,lastFetch=null;
  async function get() {
    if(clock()<expires)return data;
    if(pending)return pending;
    pending=(async()=>{
      try{
        const response=await fetchImpl(url,{
          headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)
        });
        if(!response.ok)throw Error('Upstream publication unavailable');
        const raw=await readBoundedText(response,150000);
        const payload=JSON.parse(raw);
        if(!isValidEvidenceSummary(payload))throw Error('Invalid summary schema / unsafe claims');
        data=payload;
        lastError=null;
      }catch{
        lastError='PUBLICATION_UNAVAILABLE_OR_INVALID';
      }finally{
        lastFetch=new Date(clock()).toISOString();
        expires=clock()+Math.max(60000,ttlMs);
        pending=null;
      }
      return data;
    })();
    return pending;
  }
  return {get,status:()=>({lastFetch,lastError,cacheSecondsRemaining:Math.max(0,Math.floor((expires-clock())/1000))})};
}
