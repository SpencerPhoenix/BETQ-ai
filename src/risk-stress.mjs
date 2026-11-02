/**
 * BETQ risk stress v1: seeded week-group resampling of a retrospective,
 * losing historical betting-selection policy.
 *
 * This is NOT a forecast of actual bankruptcy, not a market execution
 * simulation, and does not establish realized ROI. Historical records use
 * unverified closing prices. Repeated week blocks partly preserve same-week
 * dependence but cannot capture changing teams, strategy drift or book limits.
 */
import {toDecimal} from './engine.mjs';
const round=(v,d=4)=>Number.isFinite(v)?Number(v.toFixed(d)):null;
const order=(a,b)=>a.date.localeCompare(b.date)||a.gameId.localeCompare(b.gameId);
const quantile=(a,p)=>{
  const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return lo===hi?a[lo]:a[lo]*(hi-i)+a[hi]*(i-lo);
};
function randomGenerator(seed){
  let state=(seed>>>0)||1;
  return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
}
export function historicalOutcomeBlocks(replay,{thresholdEVPercent=3}={}){
  if(!replay||!Array.isArray(replay.years)||
     ![0,3,5].includes(thresholdEVPercent))throw Error('Invalid retrospective sample policy');
  const blocks=new Map();
  let eligible=0,missing=0;
  for(const year of replay.years){
    for(const d of year.decisions||[]){
      if(!d.priceAvailable||!Number.isFinite(d.estimatedEV)||
         d.estimatedEV<thresholdEVPercent/100)continue;
      if(d.actual==='TIE'||!['home','away'].includes(d.actual)){
        missing++;continue;
      }
      const price=d.selectedOdds,decimal=toDecimal(price);
      if(!decimal||!Number.isFinite(decimal)||!['home','away'].includes(d.selectedSide)) {
        missing++;continue;
      }
      if(!Number.isInteger(year.season)||!Number.isInteger(d.week)||
         d.week<1||d.week>25)throw Error('Invalid historical block identity');
      const key=year.season+':'+d.week;
      if(!blocks.has(key))blocks.set(key,[]);
      blocks.get(key).push({
        gameId:d.gameId,date:d.date,season:year.season,week:d.week,
        netPerUnit:d.actual===d.selectedSide?decimal-1:-1
      });
      eligible++;
    }
  }
  const ordered=[...blocks].sort(([a],[b])=>a.localeCompare(b))
    .map(([id,rows])=>({id,rows:rows.sort(order)}));
  if(!ordered.length||!eligible)throw Error('No valid historical selections for stochastic scenario');
  return {
    blocks:ordered,eligible,ungraded:missing,
    seasons:[...new Set(replay.years.map(y=>y.season))].sort(),
    priceBasis:'HISTORICAL_CLOSING_REFERENCE_NOT_VERIFIED_AVAILABLE_PRICE',
    noVerifiedEntry:true
  };
}

/**
 * Resample entire season/week blocks rather than individual bets. Each
 * simulation has the SAME number of sampled week-blocks, but the number of
 * matches per week naturally varies.
 *
 * adverseWinFlipRate is a declared stress assumption: the given share of
 * historical wins is flipped to losses, NEVER an inferred true probability.
 */
export function simulateBankrollRisk(blockSet,{
  iterations=10000,seed=417203,
  startingBankroll=100,stakeFraction=0.01,
  practicalRuinFraction=0.5,
  adverseWinFlipRate=0
}={}){
  if(!blockSet||!Array.isArray(blockSet.blocks)||blockSet.blocks.length<4||
     !Number.isInteger(iterations)||iterations<50||iterations>20000||
     !Number.isInteger(seed)||!Number.isFinite(startingBankroll)||startingBankroll<=0||
     !Number.isFinite(stakeFraction)||stakeFraction<=0||stakeFraction>0.05||
     !Number.isFinite(practicalRuinFraction)||practicalRuinFraction<=0||practicalRuinFraction>=1||
     !Number.isFinite(adverseWinFlipRate)||adverseWinFlipRate<0||adverseWinFlipRate>0.2)
    throw Error('Invalid bounded risk scenario');
  const blocks=blockSet.blocks;
  const random=randomGenerator(seed);
  const results=[],drawdowns=[];
  let belowStart=0,breaches=0,largeDD=0,totalBets=0;
  for(let run=0;run<iterations;run++){
    let bankroll=startingBankroll,peak=startingBankroll,maxDD=0,breached=false;
    for(let w=0;w<blocks.length;w++){
      const selected=blocks[Math.floor(random()*blocks.length)];
      for(const record of selected.rows){
        const stake=bankroll*stakeFraction;
        let outcome=record.netPerUnit;
        if(outcome>0&&random()<adverseWinFlipRate)outcome=-1;
        bankroll+=stake*outcome;
        peak=Math.max(peak,bankroll);
        const dd=peak>0?1-bankroll/peak:0;
        maxDD=Math.max(maxDD,dd);
        if(bankroll<=startingBankroll*practicalRuinFraction)breached=true;
        totalBets++;
      }
    }
    results.push(100*(bankroll/startingBankroll-1));
    drawdowns.push(100*maxDD);
    if(bankroll<startingBankroll)belowStart++;
    if(breached)breaches++;
    if(maxDD>=0.5)largeDD++;
  }
  results.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);
  return {
    type:'CONDITIONAL_WEEK_BLOCK_BOOTSTRAP',
    version:'betq-risk-stress-1',iterations,seed,
    historicalWeeksResampled:blocks.length,
    historicalSelectionCount:blockSet.eligible,
    approximateBetsPerPath:round(totalBets/iterations,2),
    startingBankroll,stakeFraction,stakePercent:round(100*stakeFraction,2),
    practicalRuinThreshold:round(startingBankroll*practicalRuinFraction,2),
    practicalRuinDefinition:'TOUCH_STARTING_BANKROLL_THRESHOLD_AT_ANY_TIME',
    adverseWinFlipRate,
    endingBankrollReturnPercent:{
      p05:round(quantile(results,.05),2),
      median:round(quantile(results,.5),2),
      p95:round(quantile(results,.95),2)
    },
    pathMaxDrawdownPercent:{
      median:round(quantile(drawdowns,.5),2),
      p95:round(quantile(drawdowns,.95),2)
    },
    frequencyEndingBelowStartPercent:round(100*belowStart/iterations,2),
    frequencyCrossingPracticalRuinPercent:round(100*breaches/iterations,2),
    frequencyDrawdownOver50Percent:round(100*largeDD/iterations,2),
    exactRealWorldRiskOfRuin:null,verifiedHistoricalROI:null,verifiedCLV:null,
    providerPriceTimeVerified:false,bettingAuthorized:false,
    limitations:[
      'Conditional resampling of historical, closing-price-only hypothetical decisions.',
      'Historical win rates, odds and selection rules are assumed to remain informative; this is not established.',
      'Week-block resampling only approximates within-week dependence and ignores changing opponent strength or sportsbook restrictions.',
      'A 50% bankroll threshold is a practical stress trigger, not literal financial ruin.',
      'Adverse win flips are a stated hypothetical assumption, not measured probabilities.',
      'Paths are simulation outcomes under assumptions, never guaranteed future performance or actual account returns.'
    ]
  };
}
