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
import {fetchNflverseScheduleCsv,reconcileSettlements,nflSeasonAt} from '../src/settlement-only.mjs';
import {
  emptyJournal, validateJournal, observationsFromSlate,
  updateJournal, summarizeEvidence
} from '../src/evidence.mjs';

const API = process.env.BETQ_PRODUCTION_URL || 'https://betq-ai.onrender.com';
const now=Date.now();
const season=nflSeasonAt(now);
const journalPath='data/evidence/nfl-'+season+'.json';
const summaryPath='data/evidence/summary.json';

async function loadJson(path,fallback) {
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(err){if(err?.code==='ENOENT')return fallback;throw err;}
}
async function getCsv() {
  return parseCsv(await fetchNflverseScheduleCsv());
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
  // Capture at the time of actual receipt, not before possible Render cold-start latency.
  const derived=observationsFromSlate(slate,schedule,Date.now(),season);
  captures=derived.accepted;
  skipped=derived.skipped;
} catch(err) {
  // On quota exhaustion, still reconcile final results from nflverse. No retry
  // storm or additional API credits are consumed by the collector.
  captureStatus='SKIPPED: '+err.message;
  console.log('Market forecast capture unavailable; continuing results reconciliation:',err.message);
}
// The independent and odds-based collectors now use the SAME score-finality
// and revision logic. Append newly observed pregame forecasts first, then
// reconcile only source-matched results older than the fixed finality window.
const capturesOnly=updateJournal(original,captures,[],now);
const reconciled=reconcileSettlements(capturesOnly.journal,schedule,{now});
const updated=reconciled.journal;
const added=capturesOnly.added;
const settled=reconciled.appended;
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
