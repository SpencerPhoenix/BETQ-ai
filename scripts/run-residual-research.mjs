#!/usr/bin/env node
/**
 * Pre-registered source-fingerprinted research run. The protocol is committed
 * independently BEFORE this executable is run on real NFL scores.
 *
 * NO paid Odds API usage and NO production model promotion.
 */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {indexedHistoricalClosing,replaySeason} from '../src/historical-replay.mjs';
import {
  evaluateResidualResearch,RESIDUAL_RESEARCH_VERSION,PRE_REGISTERED
} from '../src/residual-research.mjs';

const SOURCE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const TARGET='data/residual-research/summary.json';
const response=await fetch(SOURCE,{signal:AbortSignal.timeout(40000)});
if(!response.ok)throw Error('nflverse schedules source unavailable HTTP '+response.status);
const text=await response.text();
if(text.length>12000000)throw Error('Historical source exceeds size limit');
const sha=createHash('sha256').update(text).digest('hex');
const existing=await readFile(TARGET,'utf8').then(JSON.parse).catch(()=>null);
if(existing?.sourceSha256===sha&&existing?.version===RESIDUAL_RESEARCH_VERSION&&
  existing?.zeroEdgeSyntheticNull?.iterations===PRE_REGISTERED.nullWorlds){
  console.log('Source and preregistered experiment unchanged; keeping original report.');
  console.log(JSON.stringify({
    modelPromoted:existing.modelPromoted,
    pooled:existing.pooled,
    nullSimulation:existing.zeroEdgeSyntheticNull
  },null,2));
  process.exit(0);
}
const rows=parseCsv(text);
const games=cleanGames(rows,{today:new Date().toISOString().slice(0,10)});
const prices=indexedHistoricalClosing(rows);
const replayYears=[];
for(let season=2020;season<=2025;season++){
  const replay=replaySeason(games,prices,season,{
    thresholds:[.03],exampleCount:0
  });
  if(replay.closingMarketBenchmark?.n<200)throw Error('Incomplete market/outcome source '+season);
  replayYears.push(replay);
  console.log('PREPARED '+season+' '+replay.nonTieGames+' non-ties, '+
    replay.closingMarketBenchmark.n+' paired closing-price games');
}
const result=evaluateResidualResearch(replayYears,{
  nullIterations:PRE_REGISTERED.nullWorlds,
  nullSeed:PRE_REGISTERED.nullSeed,
  uncertaintyResamples:PRE_REGISTERED.uncertaintyResamples
});
result.generatedAt=new Date().toISOString();
result.sourceSha256=sha;
result.source={
  name:'nflverse / Lee Sharpe schedules',license:'CC BY 4.0',
  url:SOURCE,
  usage:'2020–2025 completed games and retrospective untimestamped closing moneylines'
};
result.protocolCommit='c6069bb7f309be3861f8f733dc8dbfd690bfea2d';
result.automaticModelPromotionAllowed=false;
result.wageringAuthorized=false;
await mkdir('data/residual-research',{recursive:true});
await writeFile(TARGET,JSON.stringify(result,null,2)+'\n','utf8');
for(const year of result.perSeason){
  const bins=year.disagreementAudit.bins;
  const top=bins[9],bottom=bins[0];
  console.log('YEAR '+year.season+
    ' marketBrier '+year.closingMarket.brier+
    ' calibratedMarketBrier '+year.calibratedMarket.brier+
    ' residualBrier '+year.incrementalResidual.brier+
    ' residualCoef '+year.coefficients.residualModel.modelResidualWeight+
    ' BrierDelta '+year.calibratedMarketMinusResidualBrier+
    ' LogLossDelta '+year.calibratedMarketMinusResidualLogLoss+
    ' topDisagreementCount '+top.n+
    ' topModelOverconfidencePP '+top.modelOverconfidencePoints+
    ' firstBinModelOverconfidencePP '+bottom.modelOverconfidencePoints);
}
console.log('POOLED MARKET-CALIBRATED BRIER '+result.pooled.calibratedMarket.brier+
  ' RESIDUAL BRIER '+result.pooled.incrementalResidual.brier+
  ' DELTA '+result.pooled.improvementBrier);
console.log('POOLED WEEK-CI: '+JSON.stringify(result.pooled.pairedWeek95));
console.log('NULL FALSE APPROVALS: '+result.zeroEdgeSyntheticNull.falseApprovalCount+
  ' / '+result.zeroEdgeSyntheticNull.iterations+
  ' ('+result.zeroEdgeSyntheticNull.estimatedFalseApprovalRatePercent+'%)');
console.log('RESEARCH EVIDENCE FLAG: '+result.historicalIncrementalInformationFlag);
console.log('PRODUCTION MODEL PROMOTION: NO; REAL BETTING AUTHORIZED: NO; VERIFIED ROI/CLV: NONE');
