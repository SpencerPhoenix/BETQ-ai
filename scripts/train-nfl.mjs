#!/usr/bin/env node
/**
 * Builds an independent NFL Elo research baseline using nflverse game RESULTS.
 * No sportsbook odds, API credentials or proprietary injury data are used.
 * Tuning: 2018-2022; calibration: 2023-2024; untouched test: 2025.
 * Ratings are then advanced across already completed 2026 games only.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { parseCsv, fitNflElo, MODEL_VERSION } from '../src/nfl-elo.mjs';

import { assertTrainingFinalityCoverage, trainingReceiptOptions } from '../src/nfl-official-finality.mjs';
import { selectTrainingGames, TRAINING_INPUT_POLICY } from '../src/training-input-safety.mjs';

const URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const args = process.argv.slice(2);
const input = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
const target = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'data/nfl_elo.json';
if (args.includes('--input') && !input) throw new Error('--input requires an existing CSV file');
if (args.includes('--output') && !target) throw new Error('--output requires a path');

async function source() {
  if (input) return await readFile(input,'utf8');
  const response = await fetch(URL, { signal: AbortSignal.timeout(25000), headers: { Accept:'text/plain' } });
  if (!response.ok) throw new Error('nflverse schedule source unavailable: HTTP '+response.status);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > 12000000) throw new Error('NFL schedule source too large');
  return await response.text();
}
const receiptOptions=trainingReceiptOptions(args,{otherFlags:['--input','--output']});
const raw = await source();
if (raw.length > 12000000) throw new Error('NFL source too large');
const {games,report:trainingInputSafety} = selectTrainingGames(parseCsv(raw));
const finalityCoverage=receiptOptions?assertTrainingFinalityCoverage(games,JSON.parse(await readFile(receiptOptions.path,'utf8')),
  {season:trainingInputSafety.latestSeason,weeks:receiptOptions.weeks,asOf:trainingInputSafety.asOf}):null;
const checksum = createHash('sha256').update(games.map(g =>
  [g.id,g.date,g.home,g.away,g.homeScore,g.awayScore,g.neutral].join('|')).join('\n')).digest('hex');
const existing = await readFile(target,'utf8').then(JSON.parse).catch(()=>null);
if (!finalityCoverage && existing?.trainingInputSafety?.policy===TRAINING_INPUT_POLICY && existing?.version===MODEL_VERSION && existing?.completedGamesSha256===checksum && existing?.source?.url===URL) {
  console.log('No completed results changed; existing model remains unchanged');
  console.log(JSON.stringify({ready:existing.readyForResearch,holdout:existing.holdout,generatedAt:existing.generatedAt}));
  process.exit(0);
}
const fit = fitNflElo(games);
const artifact = {
  schema:1, version:MODEL_VERSION, type:'PREGAME_NFL_ELO_BASELINE',
  source:{
    project:'nflverse/nflverse-data',description:'NFL schedule release maintained by Lee Sharpe, published by nflverse',
    url:URL,license:'CC BY 4.0',extractedUTC:new Date().toISOString()
  },
  generatedAt:new Date().toISOString(),
  completedGamesSha256:checksum,
  trainingInputSafety,
  finalityCoverage,
  lastGameDate:fit.lastGameDate,
  seasons:fit.seasons,
  completedGames:fit.gamesCount,
  completed2026:fit.currentSeasonGames,
  trainingProtocol:{
    'parameterTuning':'2018–2022 games (prior games only)',
    'calibration':'2023–2024 games (after hyperparameter selection)',
    'untouchedTest':'2025 games (not used for hyperparameters or calibration)',
    'liveRatings':'Delayed scored schedule rows through lastGameDate; see trainingInputSafety for unverified finality',
    'leakageControl':'Chronological pregame ratings, season-to-season mean regression'
  },
  params:fit.params,
  tuning:fit.tuning,calibration:fit.calibration,holdout:fit.holdout,
  readyForResearch:fit.readyForResearch,
  limitations:[
    'Elo-only historical outcome model; no starters, injuries, weather, play-by-play EPA or current lineup updates',
    'Research-only; a 2025 holdout does not establish real-money profitability or a wagering advantage',
    'A season-end rating is not a same-day injury- or roster-aware projection',
    'Team relocation aliases do not resolve all historical franchise and stadium changes',
    'Market outcomes, spreads and totals do not share this moneyline-only model'
  ],
  ratings:fit.ratings
};
if (!fit.readyForResearch) {
  console.log('WARNING: baseline did not beat the 50/50 Brier reference in both validation and holdout. No model probabilities will be served.');
}
await mkdir(dirname(resolve(target)),{recursive:true});
await writeFile(target, JSON.stringify(artifact,null,2)+'\n', 'utf8');
console.log(JSON.stringify({
  version:artifact.version, source:artifact.source.project, sourceGames:fit.gamesCount,
  lastGameDate:fit.lastGameDate,completed2026:fit.currentSeasonGames,
  tuning:fit.tuning,calibration:fit.calibration,holdout:fit.holdout,
  readyForResearch:fit.readyForResearch
},null,2));
