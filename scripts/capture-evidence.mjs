#!/usr/bin/env node
/**
 * BETQ.ai prospective research evidence collector.
 * Uses the public read-only BETQ endpoint and public nflverse schedules.
 * No API keys are embedded. At most one live NFL moneyline request per run.
 * Commits derived model and consensus probabilities ONLY, never raw odds.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseCsv } from '../src/nfl-elo.mjs';
import {
  emptyJournal, validateJournal, observationsFromSlate,
  resultsFromSchedule, updateJournal, summarizeEvidence
} from '../src/evidence.mjs';

const URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const API = process.env.BETQ_PRODUCTION_URL || 'https://betq-ai.onrender.com';
const now=Date.now();
const date=new Date(now);
const season=date.getUTCMonth()<2?date.getUTCFullYear()-1:date.getUTCFullYear();
const journalPath='data/evidence/nfl-'+season+'.json';
const summaryPath='data/evidence/summary.json';

async function loadJson(path,fallback) {
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(err){if(err?.code==='ENOENT')return fallback;throw err;}
}
async function getCsv() {
  const response=await fetch(URL,{signal:AbortSignal.timeout(30000),
    headers:{Accept:'text/csv,text/plain'}});
  if(!response.ok)throw Error('nflverse schedules unavailable HTTP '+response.status);
  const text=await response.text();
  if(text.length>12000000)throw Error('Schedules source too large');
  return parseCsv(text);
}
async function getSlate() {
  const endpoint=new URL('/api/slate',API);
  endpoint.searchParams.set('mode','live');
  endpoint.searchParams.set('sport','americanfootball_nfl');
  endpoint.searchParams.set('market','h2h');
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(100000),
    headers:{Accept:'application/json'}});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Live slate unavailable HTTP '+response.status+
    ' '+String(result?.error?.code||'UNKNOWN'));
  if(result?.demo!==false||result?.source!=='THE_ODDS_API_V4')throw Error('Untrusted slate source');
  return result;
}

const original=validateJournal(await loadJson(journalPath,emptyJournal(season)));
const schedule=await getCsv();
let captures=[],skipped=[],captureStatus='SUCCESS';
try {
  const slate=await getSlate();
  const derived=observationsFromSlate(slate,schedule,now,season);
  captures=derived.accepted;
  skipped=derived.skipped;
} catch(err) {
  // On quota exhaustion, still reconcile final results from nflverse. No retry
  // storm or additional API credits are consumed by the collector.
  captureStatus='SKIPPED: '+err.message;
  console.log('Market forecast capture unavailable; continuing results reconciliation:',err.message);
}
const newlySettled=resultsFromSchedule(original,schedule,now);
const result=updateJournal(original,captures,newlySettled,now);
const updatedResults=resultsFromSchedule(result.journal,schedule,now);
const combined=updateJournal(result.journal,[],updatedResults,now);
const updated=combined.journal;
const added=result.added+combined.added;
const settled=result.settlementRevisions+combined.settlementRevisions;
const summary=summarizeEvidence(updated,now);
const changed=added>0||settled>0;
console.log(JSON.stringify({
  season,captureStatus,eligible:captures.length,skipped:skipped.length,
  appended:added,newResultsOrCorrections:settled,
  cumulativeSnapshots:summary.totalSnapshots,prospectiveGames:summary.prospectiveGames,
  finalized:summary.settledGames,paired:summary.pairedMarketGames,
  status:summary.status,metricsPublished:summary.forwardMetrics!==null
},null,2));
if(!changed&&original.snapshots.length!==0) {
  console.log('No new evidence; leaving journal and summary unchanged.');
  process.exit(0);
}
await mkdir(dirname(journalPath),{recursive:true});
await writeFile(journalPath,JSON.stringify(updated,null,2)+'\n','utf8');
await writeFile(summaryPath,JSON.stringify(summary,null,2)+'\n','utf8');
console.log('Saved ONLY derived and prospectively captured research evidence.');
