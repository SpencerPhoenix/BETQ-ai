#!/usr/bin/env node
/** Offline only: an observed weekly receipt cannot certify an earlier training run. */
import {readFile} from 'node:fs/promises';
import {parseCsv} from '../src/nfl-elo.mjs';
import {selectTrainingGames} from '../src/training-input-safety.mjs';
import {reconcileTrainingFinality} from '../src/nfl-official-finality.mjs';
const [schedulePath,receiptPath,seasonText,weeksText,asOf,...extra]=process.argv.slice(2);
if(extra.length||!schedulePath||!receiptPath||!seasonText||!weeksText||!asOf)throw Error('Usage: schedule.csv receipts.json season weeksCSV explicitAsOfUTC');
const receipts=JSON.parse(await readFile(receiptPath,'utf8'));
const {games}=selectTrainingGames(parseCsv(await readFile(schedulePath,'utf8')),{asOf});
const report=reconcileTrainingFinality(games,receipts,{season:Number(seasonText),weeks:weeksText.split(',').map(Number),asOf});
console.log(JSON.stringify(report,null,2));if(!report.available)process.exitCode=1;
