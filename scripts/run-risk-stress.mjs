#!/usr/bin/env node
/**
 * Reproducible, hypothetical bankroll stress using source-verified *outcome
 * labels* but unverified historically executable closing prices. No live
 * sportsbook calls and no model-promotion authority.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {historicalOutcomeBlocks,simulateBankrollRisk} from '../src/risk-stress.mjs';

const src='data/replay/nfl_2022_2025.json';
const full=JSON.parse(await readFile(src,'utf8'));
if(full.version!=='nfl-replay-v2'||full.verifiedROI!==false||
   full.verifiedCLV!==false||full.years.length!==4)
  throw Error('Unsafe historical source version or success claim');
const hash=createHash('sha256').update(
  JSON.stringify(full.years.map(y=>({season:y.season,decisions:y.decisions})))
).digest('hex');
const output='data/risk/summary.json';
const existing=await readFile(output,'utf8').then(JSON.parse).catch(()=>null);
if(existing?.sourceSha256===hash&&existing?.version==='betq-risk-research-v1'){
  console.log('Historical outcomes unchanged; existing conditional stress retained');
  console.log(JSON.stringify(existing.scenarios.map(x=>({
    case:x.label,median:x.result.endingBankrollReturnPercent.median,
    practicalRuinFrequency:x.result.frequencyCrossingPracticalRuinPercent
  })),null,2));
  process.exit(0);
}
const data=historicalOutcomeBlocks(full,{thresholdEVPercent:3});
if(data.eligible<600||data.blocks.length<50)throw Error('Insufficient completed outcomes for grouped stress');
const cases=[
  {label:'BASELINE_CONDITIONAL_RESAMPLE_1_PERCENT_RISK',stakeFraction:.01,adverseWinFlipRate:0,seed:440391},
  {label:'ADVERSE_2_PERCENT_WINS_FLIPPED',stakeFraction:.01,adverseWinFlipRate:.02,seed:440391},
  {label:'HALF_STAKE_CONDITIONAL_RESAMPLE',stakeFraction:.005,adverseWinFlipRate:0,seed:440391}
];
const scenarios=cases.map(x=>({
  label:x.label,
  result:simulateBankrollRisk(data,{
    iterations:10000,startingBankroll:100,
    practicalRuinFraction:.5,
    stakeFraction:x.stakeFraction,
    adverseWinFlipRate:x.adverseWinFlipRate,seed:x.seed
  })
}));
const artifact={
  schema:1,version:'betq-risk-research-v1',generatedAt:new Date().toISOString(),
  sourceSha256:hash,sourceVersion:full.version,
  marketDataSource:'NFLVERSE_HISTORICAL_CLOSING_REFERENCE',
  statement:'Hypothetical bankroll stress. NOT verified future ruin probability or an actual portfolio.',
  model:'ORIGINAL_FROZEN_ELO_3PCT_EV_GATE',
  historicalSeasonRange:[2022,2025],
  historicalEligibleDecisions:data.eligible,historicalWeekBlocks:data.blocks.length,
  historicalPriceTimeVerified:false,verifiedROI:null,verifiedCLV:null,
  bettingAuthorized:false,scenarioAssumptions:{
    sample:'Resample complete NFL season-week groups with replacement.',
    pathsPerScenario:10000,
    initialBankrollUnits:100,
    practicalRuin:'Balance touches 50 units (half starting bankroll) at any time',
    stakeSizing:'Fraction of current bankroll per historical hypothetical selection; no leverage',
    source:'Historical closing odds, not actual bet execution',
    adverseCase:'Declared 2% independent per-winning-selection conversion to a loss, not an observed real-world probability'
  },
  scenarios
};
await mkdir('data/risk',{recursive:true});
await writeFile(output,JSON.stringify(artifact,null,2)+'\n','utf8');
for(const s of scenarios){
  console.log('SCENARIO '+s.label+
    ' medianReturn='+s.result.endingBankrollReturnPercent.median+
    '% P05='+s.result.endingBankrollReturnPercent.p05+
    '% probabilityDown50='+s.result.frequencyCrossingPracticalRuinPercent+
    '% medianMaxDrawdown='+s.result.pathMaxDrawdownPercent.median+'%');
}
console.log('Realized ROI: UNAVAILABLE. Verified CLV: UNAVAILABLE. Risk of ruin: ASSUMPTION-CONDITIONAL ONLY.');
