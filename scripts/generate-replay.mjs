#!/usr/bin/env node
/**
 * Reproducible season-by-season historical replay.
 * Public nflverse closing odds = conditional, retrospective reference only.
 * NO paid Odds API credits; no sportsbook execution or historical quote claims.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {buildSeasonReplay} from '../src/historical-replay.mjs';

const SOURCE='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const OUT='data/replay/nfl_2022_2025.json';
const SUMMARY='data/replay/summary.json';
async function getSource(){
  const response=await fetch(SOURCE,{signal:AbortSignal.timeout(40000)});
  if(!response.ok)throw Error('nflverse games CSV unavailable: HTTP '+response.status);
  const text=await response.text();
  if(text.length>12000000)throw Error('Games CSV too large');
  return text;
}
const downloaded=await getSource();
const rows=parseCsv(downloaded);
const completed=cleanGames(rows,{today:new Date().toISOString().slice(0,10)});
const replay=buildSeasonReplay(completed,rows,{seasons:[2022,2023,2024,2025],thresholds:[0,0.03,0.05],exampleCount:20});
if(replay.years.length!==4)throw Error('Incomplete test season replay');
if(replay.years.some(y=>y.nonTieGames<240||y.closingMoneylineCoverage.validGamesWithBothPrices<160))
  throw Error('Insufficient 2022–2025 real outcome/closing odds coverage');
const hash=createHash('sha256').update(downloaded).digest('hex');
const stored=await readFile(OUT,'utf8').then(JSON.parse).catch(()=>null);
if(stored?.sourceSha256===hash&&stored?.version===replay.version){
  console.log('No historical source changes, retaining previous artifact.');
  console.log(JSON.stringify(stored.years.map(y=>({season:y.season,
    accuracy:y.allGameForecast.accuracyPercent,priceCoverage:y.closingMoneylineCoverage.coveragePercent,
    plays:y.selectionRules.find(r=>r.thresholdEVPercent===3).graded})),null,2));
  process.exit(0);
}
replay.generatedAt=new Date().toISOString();
replay.sourceSha256=hash;
replay.researchWarnings=[
  'This 2025 historical data and existing BETQ model variants have been repeatedly inspected; these are exploratory reconstructions, not a pristine untouched model trial.',
  'Historical closing odds from nflverse are source-retrospective, not pregame timestamped bet fills.',
  'The rule uses those closing odds as a hypothetical decision-time price and cannot establish achievable ROI or CLV.',
  'Current feature challenger is not yet refitted separately for each prior test season; this artifact evaluates the season-fitted Elo baseline only.'
];
const summary={
  schema:1,version:replay.version,generatedAt:replay.generatedAt,
  source:replay.source,sourceSha256:hash,
  model:replay.years[0].model,
  defaultThresholdEVPercent:3,verifiedBettingROI:null,verifiedCLV:null,
  historicalReplayROIType:'HYPOTHETICAL_CLOSING_PRICE_ONLY',
  years:replay.years.map(y=>({
    season:y.season,
    tunedYears:y.fit.tunedYears,calibratedYears:y.fit.calibrationYears,
    params:y.fit.params,
    games:y.games,tiesExcluded:y.tiesExcluded,
    allGameForecast:y.allGameForecast,
    closingMoneylineCoverage:y.closingMoneylineCoverage,
    closingMarketBenchmark:y.closingMarketBenchmark,
    selectionRules:y.selectionRules.map(r=>({
      thresholdEVPercent:r.thresholdEVPercent,pricedCandidates:r.pricedCandidates,
      graded:r.graded,wins:r.wins,losses:r.losses,tiesExcluded:r.tiesExcluded,
      winRatePercent:r.winRatePercent,wilson95:r.wilson95,
      expectedSelectionWinRatePercent:r.expectedSelectionWinRatePercent,
      referenceMarketWinProbabilityPercent:r.referenceMarketWinProbabilityPercent,
      meanEstimatedEVPercent:r.meanEstimatedEVPercent,
      actualMinusForecastWinPoints:r.actualMinusForecastWinPoints,
      hypotheticalNetUnits:r.hypotheticalNetUnits,
      hypotheticalClosingPriceROI:r.hypotheticalClosingPriceROI,
      maxConsecutiveLosses:r.maxConsecutiveLosses,
      maximumUnitDrawdown:r.maximumUnitDrawdown
    }))
  })),
  aggregateByThreshold:Object.fromEntries(Object.entries(replay.aggregateByThreshold).map(([k,v])=>[k,{
    thresholdEVPercent:v.thresholdEVPercent,graded:v.graded,wins:v.wins,
    losses:v.losses,tiesExcluded:v.tiesExcluded,winRatePercent:v.winRatePercent,
    expectedSelectionWinRatePercent:v.expectedSelectionWinRatePercent,
    referenceMarketWinProbabilityPercent:v.referenceMarketWinProbabilityPercent,
    meanEstimatedEVPercent:v.meanEstimatedEVPercent,
    actualMinusForecastWinPoints:v.actualMinusForecastWinPoints,
    hypotheticalNetUnits:v.hypotheticalNetUnits,hypotheticalRiskedUnits:v.hypotheticalRiskedUnits,
    hypotheticalClosingPriceROI:v.hypotheticalClosingPriceROI,
    maxConsecutiveLosses:v.maxConsecutiveLosses,
    maximumUnitDrawdown:v.maximumUnitDrawdown
  }])),
  riskDisclosure:replay.researchWarnings
};
await mkdir(dirname(OUT),{recursive:true});
await writeFile(OUT,JSON.stringify(replay,null,2)+'\n','utf8');
await writeFile(SUMMARY,JSON.stringify(summary,null,2)+'\n','utf8');
for(const year of summary.years){
  const r=year.selectionRules.find(x=>x.thresholdEVPercent===3);
  console.log('YEAR '+year.season+' games '+year.allGameForecast.n+
    ' modelAcc '+year.allGameForecast.accuracyPercent+
    '% modelBrier '+year.allGameForecast.brier+
    ' marketBrier '+(year.closingMarketBenchmark?.brier??'NA')+
    ' priceCoverage '+year.closingMoneylineCoverage.coveragePercent+
    '% threshold3 plays '+r.graded+' W/L '+r.wins+'/'+r.losses+
    ' hypotheticalROI '+r.hypotheticalClosingPriceROI+'%');
}
const total=summary.aggregateByThreshold['3'];
console.log('TOTAL fixed 3% hypothetical closing-price selections '+total.graded+
  ' '+total.wins+'-'+total.losses+
  ' win% '+total.winRatePercent+' hypotheticalROI '+total.hypotheticalClosingPriceROI+'%');
console.log('VERIFIED REAL-MONEY ROI: UNAVAILABLE; VERIFIED CLV: UNAVAILABLE.');
