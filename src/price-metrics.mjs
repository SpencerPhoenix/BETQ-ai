/**
 * BETQ.ai ROI/CLV Mathematics & Trust Gates.
 *
 * Separate an illustrative price calculation from *verified* performance.
 * Do not reconstruct missing bookmaker fills, closing quotes or settlements.
 * A historical model win rate is NEVER a substitute for verified selections.
 */
import { toDecimal, impliedProbability, noVigPair } from './engine.mjs';

const round=(x,d=4)=>Number.isFinite(x)?Number(x.toFixed(d)):null;
const cents=(x)=>Math.round((x+Number.EPSILON)*100);
const finite=Number.isFinite;
const GRADED=new Set(['WIN','LOSS','PUSH','VOID']);
const MARKET=new Set(['h2h','spreads','totals']);
const PERIOD=new Set(['FULL_GAME','FIRST_HALF','SECOND_HALF','FIRST_QUARTER','SECOND_QUARTER','THIRD_QUARTER','FOURTH_QUARTER']);

export class PriceAuditError extends Error{
  constructor(code,message){super(message);this.code=code;}
}
const fail=(code,message)=>{throw new PriceAuditError(code,message);};

export function strictAmerican(price){
  if(!Number.isInteger(price)||price===0||Math.abs(price)<100||Math.abs(price)>50000)
    fail('INVALID_AMERICAN_ODDS','American odds must be an integer with absolute value 100–50,000.');
  const d=toDecimal(price);
  if(!finite(d)||d<=1)return fail('INVALID_AMERICAN_ODDS','Invalid American odds.');
  return d;
}
export function singleSettlement(stake,americanOdds,result){
  if(!finite(stake)||stake<=0||stake>1000000||cents(stake)/100!==stake)
    fail('INVALID_STAKE','Stake must be $0.01–$1,000,000, with at most two decimals.');
  const d=strictAmerican(americanOdds);
  if(!GRADED.has(result)&&result!=='OPEN')
    fail('INVALID_SETTLEMENT','Result must be WIN, LOSS, PUSH, VOID or OPEN.');
  if(result==='OPEN')return {result,stake,odds:americanOdds,risked:null,netProfit:null,grossReturn:null};
  // PUSH returns stake and enters the risked-stake denominator; VOID is excluded.
  const risked=result==='VOID'?0:cents(stake);
  const payout=result==='WIN'?cents(stake*d):
    result==='PUSH'||result==='VOID'?cents(stake):0;
  const profit=result==='VOID'?0:payout-cents(stake);
  return {
    result,stake,odds:americanOdds,risked:round(risked/100,2),
    netProfit:round(profit/100,2),grossReturn:round(payout/100,2)
  };
}

/**
 * IMPORTANT: This is price arithmetic, *not* verified CLV.
 * Must be labeled ILLUSTRATIVE unless independently timestamped quotes exist.
 */
export function illustrativePrice({
  entryAmerican,closingAmerican,closingOppositeAmerican=null,
  stake=100,result='OPEN'
}){
  const entryDecimal=strictAmerican(entryAmerican);
  const closingDecimal=strictAmerican(closingAmerican);
  const opposite=closingOppositeAmerican===null?null:strictAmerican(closingOppositeAmerican);
  const pEntry=impliedProbability(entryAmerican);
  const pClose=impliedProbability(closingAmerican);
  const rawCLVPercent=(entryDecimal/closingDecimal-1)*100;
  const output={
    type:'ILLUSTRATIVE_PRICE_MATH',verifiedCLV:false,verifiedROI:false,
    entryAmerican,closingAmerican,closingOppositeAmerican,
    entryDecimal:round(entryDecimal,6),closingDecimal:round(closingDecimal,6),
    rawCLVPercent:round(rawCLVPercent),
    impliedProbabilityMovePoints:round((pClose-pEntry)*100),
    noVigClosingProbability:null,noVigCLVPercent:null,
    closingOverroundPercent:null,
    settlement:singleSettlement(stake,entryAmerican,result),
    claim:'Hypothetical only. No verified entry, matched closing quote, or actual wager has been established.'
  };
  if(opposite!==null){
    const pair=noVigPair(closingAmerican,closingOppositeAmerican);
    if(!pair||!pair.every(finite))fail('INVALID_CLOSING_PAIR','Invalid two-way closing market.');
    output.noVigClosingProbability=round(pair[0],7);
    output.noVigCLVPercent=round((entryDecimal*pair[0]-1)*100);
    output.closingOverroundPercent=round((pClose+impliedProbability(closingOppositeAmerican)-1)*100);
  }
  return output;
}

function stringField(x,key,max=100){
  if(typeof x!=='string'||!x.trim()||x.length>max)
    fail('INVALID_CONTRACT','Contract field '+key+' missing or invalid.');
  return x.trim();
}
const same=(a,b,k)=>stringField(a[k],k)===stringField(b[k],k);
export function assertSameContract(entry,close){
  if(!entry||!close||typeof entry!=='object'||typeof close!=='object')
    fail('INVALID_CONTRACT','Entry and closing quotes are required.');
  for(const k of ['sport','eventId','market','selectionId','period']){
    if(!same(entry,close,k))
      fail('CONTRACT_MISMATCH','Contract mismatch: closing quote must match the same event, market, side and period.');
  }
  if(!MARKET.has(entry.market)||!PERIOD.has(entry.period))
    fail('INVALID_CONTRACT','Unsupported or unrecognized market/period.');
  if(entry.market!=='h2h'){
    if(!finite(entry.line)||!finite(close.line)||entry.line!==close.line)
      fail('LINE_MISMATCH','Spread/total line must be exactly identical.');
  }
  if(entry.market==='h2h'&&(entry.line!==undefined||close.line!==undefined)&&
     (entry.line!==null||close.line!==null||entry.line!==close.line))
    fail('LINE_MISMATCH','Moneyline must not have a spread or total line.');
  return true;
}

/**
 * Matched price movement. If a closing quote is outside the final 10 minutes,
 * label it NEAR_CLOSE_PROXY instead of calling it verified closing-line value.
 *
 * Source identities must be provided by a trusted ingestion pipeline, not
 * client-controlled checkboxes. This method still cannot authenticate sources.
 */
export function evaluateLockedPrice(entry,close,{
  maxClosingLeadMinutes=10,requireProvenance=true
}={}){
  assertSameContract(entry,close);
  const entryDecimal=strictAmerican(entry.americanOdds);
  const closingDecimal=strictAmerican(close.americanOdds);
  const tEntry=Date.parse(entry.capturedAt),tClose=Date.parse(close.capturedAt);
  const tKick=Date.parse(entry.kickoffAt),tCloseKick=Date.parse(close.kickoffAt);
  if(![tEntry,tClose,tKick,tCloseKick].every(finite)||
      tKick!==tCloseKick||tEntry>=tClose||tClose>=tKick||
      tEntry>=tKick||tClose-tEntry<1000)
    fail('TIMESTAMP_MISMATCH','Entry and close must be chronological and strictly pre-kickoff.');
  if(!finite(maxClosingLeadMinutes)||maxClosingLeadMinutes<0.1||
     maxClosingLeadMinutes>120)fail('INVALID_HORIZON','Invalid closing window.');
  const leadMinutes=(tKick-tClose)/60000;
  // A quote obtained well before kickoff is NOT a true closing quote.
  const nearClose=leadMinutes<=maxClosingLeadMinutes;
  const attested=entry.sourceAttested===true&&close.sourceAttested===true&&
     !!entry.sourceRecordId&&!!close.sourceRecordId&&
     entry.sourceRecordId!==close.sourceRecordId&&
     !!entry.sourceProvider&&!!close.sourceProvider;
  const verifiedClose=nearClose&&attested;
  let novig=null;
  if(close.oppositeAmerican!==undefined && close.oppositeAmerican!==null){
    strictAmerican(close.oppositeAmerican);
    const p=noVigPair(close.americanOdds,close.oppositeAmerican);
    novig=round((entryDecimal*p[0]-1)*100,4);
  }
  const result={
    state:verifiedClose?'ATTESTED_PRICE_PROXY':
      nearClose?'UNVERIFIED_CLOSE_PRICE':'NEAR_CLOSE_PROXY_NOT_TRUE_CLOSE',
    sameContract:true,
    sourceAttested:attested,
    priceMathAvailable:true,
    entryDecimal:round(entryDecimal,6),
    closeDecimal:round(closingDecimal,6),
    rawPriceMovementPercent:round((entryDecimal/closingDecimal-1)*100),
    impliedProbabilityMovePoints:round(
      (impliedProbability(close.americanOdds)-impliedProbability(entry.americanOdds))*100),
    noVigClosePriceMovementPercent:novig,
    closingLeadMinutes:round(leadMinutes,3),
    verifiedCLV:false,
    reason:verifiedClose?
      'Source-identified near-close price proxy only. Full official closing completeness remains unverified.':
      'Price comparison is not an independently verified market closing line.'
  };
  // No code path promotes to VERIFIED_CLV without a source-certified close.
  return result;
}

/** Audited summary strictly over settled records, never inferred from win rate. */
export function summarizeROI(records,{
  mode='PAPER_MANUAL',startingBankroll=null
}={}){
  if(!Array.isArray(records)||records.length>100000)
    fail('INVALID_RECORDS','Stake records must be a bounded array.');
  if(!['PAPER_MANUAL','VERIFIED_TRANSACTION'].includes(mode))
    fail('INVALID_MODE','Invalid ROI evidence mode.');
  if(startingBankroll!==null&&(!finite(startingBankroll)||startingBankroll<=0))
    fail('INVALID_BANKROLL','Initial bankroll must be a positive finite amount.');
  const seen=new Set(),tally={win:0,loss:0,push:0,void:0,open:0,unverified:0,invalid:0,duplicate:0};
  let net=0,stakeCents=0,returns=0;
  for(const r of records){
    if(!r||typeof r!=='object'){tally.invalid++;continue;}
    if(typeof r.id!=='string'||!r.id.trim()||r.id.length>200){tally.invalid++;continue;}
    if(seen.has(r.id)){tally.duplicate++;continue;}
    seen.add(r.id);
    if(r.status==='OPEN'){tally.open++;continue;}
    if(mode==='VERIFIED_TRANSACTION'&&
      !(r.executionVerified===true&&r.settlementVerified===true&&
        typeof r.executionReference==='string'&&r.executionReference.length>0&&
        typeof r.resultReference==='string'&&r.resultReference.length>0)){
      tally.unverified++;continue;
    }
    try{
      const result=singleSettlement(r.stake,r.odds,r.status);
      if(r.status==='VOID'){tally.void++;continue;}
      if(r.status==='PUSH')tally.push++;
      if(r.status==='WIN')tally.win++;
      if(r.status==='LOSS')tally.loss++;
      stakeCents+=cents(result.risked);
      net+=cents(result.netProfit);
      returns+=cents(result.grossReturn);
    }catch{tally.invalid++;}
  }
  const graded=tally.win+tally.loss+tally.push;
  return {
    mode,sourceTrust:mode==='VERIFIED_TRANSACTION'?'UNVALIDATED_ATTESTATIONS_ONLY':'MANUAL_PAPER',
    recordedWagerROIAvailable:mode==='PAPER_MANUAL'?false:graded>0,
    verifiedRealMoneyROI:false,
    roiPercent:stakeCents>0?round(100*net/stakeCents):null,
    profit:round(net/100,2),
    totalRisked:round(stakeCents/100,2),
    grossReturns:round(returns/100,2),graded,
    bankrollGrowthPercent:startingBankroll===null?null:round(100*net/(startingBankroll*100)),
    counts:tally,
    denominator:'All graded WIN, LOSS and PUSH stakes; VOID and OPEN excluded.',
    notes:'Unverified account/transaction records cannot establish audited real-money ROI.'
  };
}
