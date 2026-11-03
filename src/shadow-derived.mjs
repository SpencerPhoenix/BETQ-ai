/**
 * NO-COST source-derived forward market movement monitor.
 *
 * Reads only the EXISTING PUBLIC BETQ derived NFL forecast evidence journal,
 * never raw book odds or private shadow-store records. It adds NO Odds API
 * requests; the existing scheduled evidence workflow produces its inputs.
 *
 * Market movement alone says NOTHING about why books moved or whether a QB
 * story affected a wagerable price.
 */
import {readBoundedText} from './integrity.mjs';
import {validateJournal} from './evidence.mjs';
import {summarizeProspectiveDirection} from './prospective-direction.mjs';
import {calculateSequentialEvidence} from './market-sequential.mjs';

const FIXED_JOURNAL=
  'https://raw.githubusercontent.com/SpencerPhoenix/BETQ-ai/main/data/evidence/nfl-2026.json';
const round=(n,d=3)=>Number.isFinite(n)?Number(n.toFixed(d)):null;
const median=(arr)=>{
  const sorted=arr.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
};
const timestamp=x=>typeof x==='string'&&x.trim()?Date.parse(x):NaN;

export function summarizeDerivedForwardMarkets(journal){
  validateJournal(journal);
  const grouped=new Map();
  let priced=0;
  for(const item of journal.snapshots){
    if(!Number.isFinite(item.marketHomeProbability)||
      item.marketHomeProbability<=0||item.marketHomeProbability>=1||
      item.marketBasis!=='NO_VIG_MULTI_BOOK_MEDIAN'||
      item.researchOnly!==true||!item.gameId)continue;
    const seen=timestamp(item.capturedAt),kick=timestamp(item.commenceTime);
    if(!Number.isFinite(seen)||!Number.isFinite(kick)||seen>=kick)continue;
    priced++;
    if(!grouped.has(item.gameId))grouped.set(item.gameId,[]);
    grouped.get(item.gameId).push(item);
  }
  const movements=[];
  for(const [gameId,arr] of grouped){
    arr.sort((a,b)=>timestamp(a.capturedAt)-timestamp(b.capturedAt));
    const first=arr[0],latest=arr.at(-1);
    if(arr.length<2)continue;
    const span=timestamp(latest.capturedAt)-timestamp(first.capturedAt);
    if(span<600000)continue; // never turn repeated near-simultaneous polls into a move
    const delta=(latest.marketHomeProbability-first.marketHomeProbability)*100;
    movements.push({
      gameId,matchup:first.away+' @ '+first.home,
      firstObservedAt:first.capturedAt,lastObservedAt:latest.capturedAt,
      distinctSnapshots:arr.length,
      elapsedMinutes:round(span/60000,1),
      homeMarketProbabilityChangePoints:round(delta),
      absoluteChangePoints:round(Math.abs(delta)),
      originalMarketProbability:first.marketHomeProbability,
      latestMarketProbability:latest.marketHomeProbability,
      observedBookmakerAvailability:'UNKNOWN_NOT_ATTESTED',
      qbEventAssociation:'NOT_MEASURED'
    });
  }
  const sorted=[...movements].sort((a,b)=>b.absoluteChangePoints-a.absoluteChangePoints);
  return {
    schema:1,version:'betq-forward-market-observer-v1',
    available:priced>0,
    season:journal.season,
    source:'BETQ_PROSPECTIVE_DERIVED_ONLY',
    snapshotMarketAvailable:priced,
    pricedGames:grouped.size,
    gamesWithMultipleSeparatedSnapshots:movements.length,
    medianObservedAbsoluteMovementPoints:round(median(movements.map(x=>x.absoluteChangePoints))),
    largestObservedAbsoluteMovementPoints:round(sorted[0]?.absoluteChangePoints??null),
    preview:sorted.slice(0,6).map(x=>({
      gameId:x.gameId,matchup:x.matchup,
      elapsedMinutes:x.elapsedMinutes,
      observedChangePoints:x.homeMarketProbabilityChangePoints,
      firstObservedAt:x.firstObservedAt,lastObservedAt:x.lastObservedAt,
      qbEventAssociation:'NOT_MEASURED'
    })),
    qbNewsVerified:false,qbTimingLinked:false,
    prospectiveModelLeadDiagnostic:summarizeProspectiveDirection(journal),
    sequentialMarketEvidence:calculateSequentialEvidence(journal),
    oneBookQuotesAvailable:false,actualMarketOfferVerified:false,
    sourcePublicationTimeVerified:false,
    licensedRawBookmakerQuotesIncluded:false,
    verifiedCLV:null,realMoneyROI:null,wageringAuthorized:false,
    warning:'Observed changes in aggregated market probabilities are not QB-news latency, CLV, wagers or proven price inefficiency.'
  };
}
const unavailable=(reason)=>({
  schema:1,version:'betq-forward-market-observer-v1',
  available:false,reason,
  qbNewsVerified:false,qbTimingLinked:false,
  oneBookQuotesAvailable:false,licensedRawBookmakerQuotesIncluded:false,
  verifiedCLV:null,realMoneyROI:null,wageringAuthorized:false
});
export function createDerivedForwardMarketFeed({
  fetchImpl=globalThis.fetch,clock=Date.now,ttlMs=300000,
  fixedUrl=FIXED_JOURNAL
}={}){
  let cache=null,expires=0,inflight=null;
  return {
    async get(){
      const now=clock();
      if(cache&&now<expires)return cache;
      if(inflight)return inflight;
      inflight=(async()=>{
        try{
          const response=await fetchImpl(fixedUrl,{
            headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)
          });
          if(!response.ok)throw Error('SOURCE_NOT_READY');
          const raw=await readBoundedText(response,5000000);
          // Defense in depth: prohibit private raw provider odds in a public feed.
          if(/"(?:bookmakers|bookmakerKey|americanOdds|decimalOdds|apiKey|ODDS_API_KEY)"\s*:/.test(raw))
            throw Error('RAW_ODDS_IN_PUBLIC_EVIDENCE');
          const data=summarizeDerivedForwardMarkets(JSON.parse(raw));
          cache=data;expires=now+Math.max(15000,ttlMs);
          return data;
        }catch{
          cache=unavailable('DERIVED_JOURNAL_CURRENTLY_UNAVAILABLE');
          expires=now+60000;
          return cache;
        }finally{inflight=null;}
      })();
      return inflight;
    }
  };
}
