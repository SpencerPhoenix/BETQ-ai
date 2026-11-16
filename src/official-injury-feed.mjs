/** Single-club pilot. On-request, bounded, cached public HTML; no paid API or credentials. */
import {readBoundedText} from './integrity.mjs';
import {OFFICIAL_INJURY_URL,createOfficialInjuryReceipt,validateOfficialInjuryReceipt} from './official-injury-review.mjs';
export function createOfficialInjuryFeed({fallbackArtifact=null,fetchImpl=globalThis.fetch,clock=Date.now,ttlMs=300000}={}){
  let receipts=[];
  if(fallbackArtifact?.schema===1&&Array.isArray(fallbackArtifact.receipts)&&fallbackArtifact.receipts.length<=64){
    receipts=fallbackArtifact.receipts.filter(r=>{try{validateOfficialInjuryReceipt(r);return true;}catch{return false;}}).map(r=>structuredClone(r));
  }
  let expires=0,pending=null,lastAttemptAt=null,lastSuccessAt=null,lastError=null;
  const status=()=>({scope:'CHARGERS_OFFICIAL_PAGE_PILOT',refresh:'ON_REQUEST_CACHED',lastAttemptAt,lastSuccessAt,lastError,
    sourceUrl:OFFICIAL_INJURY_URL,providerCreditsUsed:0,durablyArchived:false});
  const result=()=>({artifact:{schema:1,receipts:structuredClone(receipts)},status:status()});
  async function get(){
    if(typeof fetchImpl!=='function'||clock()<expires)return result();
    if(pending){await pending;return result();}
    const now=clock();
    const candidates=receipts.filter(r=>Date.parse(r.observedAt)<=now&&Date.parse(r.kickoff)>now&&Date.parse(r.kickoff)-now<=7*86400000)
      .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)||Date.parse(b.observedAt)-Date.parse(a.observedAt));
    const target=candidates[0];
    if(!target){lastError='NO_SUPPORTED_FUTURE_FIXTURE';return result();}
    pending=(async()=>{
      lastAttemptAt=new Date(clock()).toISOString();
      try{
        const response=await fetchImpl(OFFICIAL_INJURY_URL,{method:'GET',redirect:'error',credentials:'omit',
          headers:{Accept:'text/html'},signal:AbortSignal.timeout(6000)});
        if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw Error('OFFICIAL_SOURCE_UNAVAILABLE');
        const html=await readBoundedText(response,1000000);
        const r=createOfficialInjuryReceipt(html,{gameId:target.gameId,season:target.season,week:target.week,home:target.home,away:target.away,kickoff:target.kickoff,observedAt:new Date(clock()).toISOString()});
        // New observations are contextual only. No persistence, evidence grading or model mutation.
        receipts=[...receipts.filter(x=>x.gameId!==r.gameId),r];lastSuccessAt=r.observedAt;lastError=null;
      }catch{lastError='OFFICIAL_REFRESH_FAILED_USING_RETAINED_OBSERVATION';}
      finally{expires=clock()+Math.max(60000,Number.isFinite(ttlMs)?ttlMs:300000);}
    })();
    try{await pending;}finally{pending=null;}
    return result();
  }
  return {get,status};
}
