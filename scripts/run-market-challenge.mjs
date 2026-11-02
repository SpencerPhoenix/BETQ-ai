#!/usr/bin/env node
/**
 * Offline nested-calibration challenge to BETQ's independent Elo baseline.
 * Historical closing prices are a research reference, NEVER actual entries.
 * No external paid sportsbook API credits.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {indexedHistoricalClosing,replaySeason} from '../src/historical-replay.mjs';
import {analyzeMarketChallenge} from '../src/market-challenge.mjs';

const URL='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const EXISTING='data/replay/nfl_2022_2025.json';
const TARGET='data/market-challenge/summary.json';
const current=JSON.parse(await readFile(EXISTING,'utf8'));
if(current.version!=='nfl-replay-v2'||!Array.isArray(current.years)||current.years.length!==4)
  throw Error('Frozen full-season base replay missing or incorrect version');
const response=await fetch(URL,{signal:AbortSignal.timeout(40000)});
if(!response.ok)throw Error('nflverse schedules source unavailable: '+response.status);
const raw=await response.text();
if(raw.length>12000000)throw Error('nflverse CSV too large');
const sha=createHash('sha256').update(raw).digest('hex');
if(current.sourceSha256!==sha)throw Error('Source schedules version differs from frozen replay; refresh replay first');
const rows=parseCsv(raw),games=cleanGames(rows,{today:new Date().toISOString().slice(0,10)});
const prices=indexedHistoricalClosing(rows);
const baseline=[2020,2021].map(season=>replaySeason(games,prices,season,{
  thresholds:[0,0.03,0.05],exampleCount:0
}));
const report=analyzeMarketChallenge([...baseline,...current.years],prices);
report.generatedAt=new Date().toISOString();
report.scheduleSourceSha256=sha;
report.forecastSourceVersion=current.version;
report.mainTakeaway='Do not optimize hit rate at the expense of pricing. Reject unvalidated independent edge and use the market as the calibration floor.';
await mkdir('data/market-challenge',{recursive:true});
await writeFile(TARGET,JSON.stringify(report,null,2)+'\n','utf8');
for(const y of report.years){
  const fav=y.favoriteScenarios.find(x=>x.ruleId==='MARKET_FAVORITE_65');
  console.log('CHALLENGE '+y.season+
    ' EloBrier='+y.originalElo.brier+
    ' MarketBrier='+y.closingMarket.brier+
    ' BlendBrier='+y.conservativelyCalibrated.brier+
    ' Weight='+y.modelContributionWeight+
    ' Out-of-season BrierDelta='+y.blendVsMarketBrier+
    ' 65% favorite sample='+fav.graded+' W/L='+fav.wins+'/'+fav.losses+
    ' winnerRate='+fav.winRatePercent+'% ROI='+fav.hypotheticalClosingPriceROIPercent+'%'+
    ' priorGate='+y.training.acceptedIndependentContribution);
}
for(const [name,result] of Object.entries(report.pooledPolicy)){
  console.log('POOLED '+name+' '+result.graded+' graded '+result.wins+'-'+result.losses+
    ' hitRate='+result.winRatePercent+'% closing-priceROI='+result.hypotheticalClosingPriceROIPercent+'%');
}
console.log('Independent prediction edge: NOT ESTABLISHED. Verified CLV / ROI: UNAVAILABLE.');
