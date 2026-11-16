/**
 * Contract-based evidence collector compatibility.
 * Release 0.4.x is no longer a meaningful requirement; inspect source
 * features so the scheduled forecast journal survives newer BETQ releases.
 *
 * This check must only use /api/health and must not invoke /api/slate.
 */
import {MARKET_FRESHNESS_POLICY,QUOTE_MAX_AGE_MS} from './evidence-integrity.mjs';
import {MARKET_BOOK_IDENTITY_POLICY} from './market-consensus.mjs';

// Static producer capability, never evidence of a configured credential/budget,
// a fresh live cache, historical qualification, or a successful collection run.
export const MARKET_CAPTURE_CONTRACT_ID=MARKET_FRESHNESS_POLICY+'+'+MARKET_BOOK_IDENTITY_POLICY;
export const MARKET_CAPTURE_CONTRACT=Object.freeze({
  schema:1,
  contractId:MARKET_CAPTURE_CONTRACT_ID,
  policy:MARKET_FRESHNESS_POLICY,
  marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',
  bookmakerIdentityPolicy:MARKET_BOOK_IDENTITY_POLICY,
  absoluteOldestQuoteTimeRequired:true,
  absoluteNewestQuoteTimeRequired:true,
  originalSourceReceiptRequired:true,
  minimumDistinctBooks:3,
  maximumQuoteAgeMs:QUOTE_MAX_AGE_MS,
  capturedAtRevalidationRequired:true,
  historicalBackfillAllowed:false,
  scope:'PRODUCER_CAPABILITY_ONLY'
});
export const describeMarketCaptureContract=()=>({...MARKET_CAPTURE_CONTRACT});
export const validMarketCaptureContract=contract=>Boolean(contract&&typeof contract==='object'&&!Array.isArray(contract)&&
  Object.entries(MARKET_CAPTURE_CONTRACT).every(([key,value])=>contract[key]===value));

export function compatibleEvidenceHealth(j){
  if(!j||typeof j!=='object'||j.status!=='ok'||j.app!=='BETQ.ai')
    return {compatible:false,reason:'NOT_BETQ_HEALTH'};
  if(typeof j.version!=='string'||!/^\d+\.\d+\.\d+$/.test(j.version))
    return {compatible:false,reason:'INVALID_VERSION_METADATA'};
  if(j.odds?.configured!==true)
    return {compatible:false,reason:'LIVE_ODDS_SOURCE_NOT_CONFIGURED'};
  if(j.nflModel?.available!==true)
    return {compatible:false,reason:'NO_NFL_MODEL_SOURCE'};
  if(!j.forwardEvidence||typeof j.forwardEvidence.status!=='string')
    return {compatible:false,reason:'NO_FORWARD_EVIDENCE_CONTRACT'};
  if(j.forwardEvidence.prospectiveGames!=null&&
     (!Number.isInteger(j.forwardEvidence.prospectiveGames)||
      j.forwardEvidence.prospectiveGames<0))
    return {compatible:false,reason:'INVALID_FORWARD_EVIDENCE_COUNT'};
  const contract=j.marketCaptureContract;
  if(contract==null)return {compatible:false,reason:'MARKET_CAPTURE_CONTRACT_MISSING'};
  if(!validMarketCaptureContract(contract))
    return {compatible:false,reason:'MARKET_CAPTURE_CONTRACT_MISMATCH'};
  return {
    compatible:true,reason:'EXPECTED_SOURCE_CONTRACT_AVAILABLE',
    app:j.app,version:j.version,
    sourceConfigured:true,noOddsCreditsUsedByThisCheck:true
  };
}
