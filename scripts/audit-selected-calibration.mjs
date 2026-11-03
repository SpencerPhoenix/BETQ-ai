#!/usr/bin/env node
/** Fixed local input, stdout only: no provider, database, writes or app route. */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {summarizeSelectedCalibration} from '../src/selected-calibration.mjs';

if(process.argv.length!==2)throw Error('This offline report accepts no arguments');
const path=new URL('../data/evidence/nfl-2026.json',import.meta.url);
const bytes=await readFile(path);
if(bytes.length>3_000_000)throw Error('Oversized prospective journal');
const report=summarizeSelectedCalibration(JSON.parse(bytes.toString('utf8')));
if(report.bettingAuthorized!==false||report.modelPromoted!==false||
   report.calibrationEstablished!==false||report.independentProfitabilityProven!==false||
   report.verifiedROI!==null||report.verifiedCLV!==null||
   [report.overall,...report.bands].some(cohort=>cohort.n<30&&cohort.metrics!==null))
  throw Error('Unsafe calibration report');
console.log(JSON.stringify({sourceSha256:createHash('sha256').update(bytes).digest('hex'),
  privateRawBookmakerQuotesIncluded:false,report},null,2));
