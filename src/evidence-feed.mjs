/**
 * Reads ONLY the derived, public BETQ forecast summary from the fixed GitHub
 * raw content URL; no arbitrary URL input and no third-party odds API credits.
 * This avoids requiring a Render redeploy on every evidence journal commit.
 */
import {OUTCOME_SCORING_POLICY} from './settlement-qualification.mjs';
import {readBoundedText} from './integrity.mjs';
const FIXED_SUMMARY_URL =
  'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/evidence/summary.json';

const count=n=>Number.isInteger(n)&&n>=0;
const brier=n=>Number.isFinite(n)&&n>=0&&n<=1;
export function isValidEvidenceSummary(s) {
  if(!s||s.schema!==1||!Number.isInteger(s.season)||s.season<2020||s.season>2100||
    s.outcomeScoringPolicy!==OUTCOME_SCORING_POLICY||s.sourceIndependenceVerified!==false||
    s.minimumScoredSample!==30||s.researchOnly!==true||s.noWagering!==true||
    s.realizedROI!==null||s.verifiedCLV!==null||s.marketBeatingEdgeEstablished!==false)return false;
  const keys=['prospectiveGames','settledGames','pairedMarketGames','pairedChallengerSettled',
    'sourceCorroboratedSettledGames','sourceUncorroboratedSettledGames',
    'sourceCorroboratedMarketGames','sourceCorroboratedChallengerGames'];
  if(keys.some(key=>!count(s[key])))return false;
  const n=s.sourceCorroboratedSettledGames,m=s.sourceCorroboratedMarketGames,
    c=s.sourceCorroboratedChallengerGames;
  if(s.settledGames>s.prospectiveGames||n+s.sourceUncorroboratedSettledGames!==s.settledGames||
    s.pairedMarketGames>s.settledGames||s.pairedChallengerSettled>s.settledGames||
    m>n||m>s.pairedMarketGames||c>n||c>s.pairedChallengerSettled||
    s.status!==(n>=30?'FORWARD_SAMPLE_AVAILABLE':'COLLECTING_FORWARD_EVIDENCE'))return false;
  if(s.forwardMetrics!=null&&(n<30||s.forwardMetrics.n!==n||!brier(s.forwardMetrics.brier)))return false;
  if(s.marketComparison!=null&&(m<30||s.marketComparison.n!==m))return false;
  if(s.challengerForwardComparison!=null&&(c<30||s.challengerForwardComparison.n!==c))return false;
  // Old summaries cannot smuggle a per-result score around the aggregate gate.
  if(!Array.isArray(s.recentResults)||s.recentResults.length>10||s.recentResults.length>s.settledGames)return false;
  if(s.recentResults.some(r=>!r||typeof r.sourceCorroborated!=='boolean'||
    (r.sourceCorroborated?!brier(r.brier):r.brier!==null)))return false;
  return s.recentResults.filter(r=>r.sourceCorroborated).length<=n;
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
