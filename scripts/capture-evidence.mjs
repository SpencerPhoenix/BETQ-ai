#!/usr/bin/env node
/**
 * BETQ.ai prospective research evidence collector.
 * Uses the authenticated operator BETQ refresh endpoint and public nflverse schedules.
 * No API keys are embedded. At most one live NFL moneyline request per run.
 * Commits derived model and consensus probabilities ONLY, never raw odds.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {readBoundedText} from '../src/integrity.mjs';
import {compareModelHealth,assertSlateModelDelivery} from '../src/model-delivery.mjs';
import {compatibleEvidenceHealth,validMarketCaptureContract,MARKET_CAPTURE_CONTRACT} from '../src/evidence-compat.mjs';
import {readScheduleSourceBytes,prepareScheduleReconciliation} from '../src/schedule-source-receipt.mjs';
import {
  emptyJournal, validateJournal, observationsFromSlate,
  prepareCaptureAdmission, updateJournal
} from '../src/evidence.mjs';
import {recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';
import {summarizeWrittenMarketCapture} from '../src/market-capture-diagnostics.mjs';

const SCHEDULES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
import { operatorRequest } from './operator-auth.mjs';
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
  const response=await fetch(SCHEDULES_URL,{signal:AbortSignal.timeout(30000),
    headers:{Accept:'text/csv,text/plain'}});
  if(!response.ok)throw Error('nflverse schedules unavailable HTTP '+response.status);
  const bytes=new Uint8Array(await response.arrayBuffer());
  return readScheduleSourceBytes(bytes,new Date(Date.now()).toISOString());
}
async function getSlate() {
  if (process.env.BETQ_CAPTURE_SKIP_REASON) throw Error('PRODUCTION_PREFLIGHT_UNAVAILABLE');
  const {endpoint,options}=operatorRequest('/api/slate');
  const expectedArtifact=JSON.parse(await readFile('data/nfl_elo.json','utf8'));
  // Public metadata only: never send the operator credential or paid intent to health.
  const healthResponse=await fetch(new URL('/api/health',endpoint.origin),{method:'GET',credentials:'omit',cache:'no-store',
    redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  if(!healthResponse.ok)throw Error('MODEL_HEALTH_UNAVAILABLE');
  const health=JSON.parse(await readBoundedText(healthResponse,32000));
  const runtime=compatibleEvidenceHealth(health),modelMatch=compareModelHealth(expectedArtifact,health,Date.now());
  if(!runtime.compatible)throw Error('MODEL_RUNTIME_CONTRACT_INCOMPATIBLE');
  if(health.captureReadiness?.ready!==true)throw Error('MODEL_CAPTURE_PREREQUISITES_UNAVAILABLE');
  if(!modelMatch.compatible)throw Error(modelMatch.reason);
  options.headers['x-betq-expected-model-sha256']=modelMatch.identity.artifactCanonicalSha256;
  options.headers['x-betq-expected-market-policy']=MARKET_CAPTURE_CONTRACT.policy;
  options.headers['x-betq-expected-market-contract']=MARKET_CAPTURE_CONTRACT.contractId;
  endpoint.searchParams.set('mode','live');
  endpoint.searchParams.set('sport','americanfootball_nfl');
  endpoint.searchParams.set('market','h2h');
  const response=await fetch(endpoint,options);
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Live slate unavailable HTTP '+response.status+
    ' '+String(result?.error?.code||'UNKNOWN'));
  if(result?.demo!==false||result?.source!=='THE_ODDS_API_V4')throw Error('Untrusted slate source');
  // A deployment can change between preflight and the sole paid response. Reject, never retry or relabel.
  assertSlateModelDelivery(result,expectedArtifact,Date.now());
  if(!validMarketCaptureContract(result.marketCaptureContract))throw Error('RUNTIME_MARKET_CAPTURE_CONTRACT_MISMATCH');
  return result;
}

const original=validateJournal(await loadJson(journalPath,emptyJournal(season)));
// Refuse non-schedule identity corruption before requesting any fresh source.
// A known schedule-only conflict remains retained and is excluded from admission.
prepareCaptureAdmission(original,[],Date.now());
const {rows:schedule,sourceReceipt}=await getCsv();
let captures=[],skipped=[],captureStatus='SUCCESS',derivedMarketDiagnostics=null;
try {
  const slate=await getSlate();
  // Capture at the time of actual receipt, not before possible Render cold-start latency.
  const derived=observationsFromSlate(slate,schedule,Date.now(),season);
  captures=derived.accepted;
  skipped=derived.skipped;
  derivedMarketDiagnostics=derived.marketDiagnostics;
  if (!captures.length) captureStatus='STARVED: NO_ELIGIBLE_FRESH_CAPTURES';
} catch(err) {
  // On quota exhaustion, still reconcile final results from nflverse. No retry
  // storm or additional API credits are consumed by the collector.
  captureStatus='SKIPPED: '+err.message;
  console.log('Market forecast capture unavailable; continuing results reconciliation:',err.message);
}
// Source retrieval and cold starts can take longer than the allowed clock skew.
// Validate newly received captures against the actual reconciliation time.
const reconciledAt=Date.now();
const captureAdmission=prepareCaptureAdmission(original,captures,reconciledAt);
captures=captureAdmission.accepted;
if(captureAdmission.diagnostics.quarantinedCaptures)
  captureStatus=captures.length?'PARTIAL: CAPTURE_IDENTITY_CONFLICT':'QUARANTINED: CAPTURE_IDENTITY_CONFLICT';
const firstReconciliation=prepareScheduleReconciliation(original,schedule,reconciledAt,{sourceReceipt});
const newlySettled=firstReconciliation.results;
const result=updateJournal(original,captures,newlySettled,reconciledAt);
const finalReconciliation=prepareScheduleReconciliation(result.journal,schedule,reconciledAt,{sourceReceipt});
const updatedResults=finalReconciliation.results;
const combined=updateJournal(result.journal,[],updatedResults,reconciledAt);
const updated=combined.journal;
const added=result.added+combined.added;
const settled=result.settlementRevisions+combined.settlementRevisions;
const summary=recomputeJournalEvidence(updated,reconciledAt);
const changed=added>0||settled>0;
const marketCapture=summarizeWrittenMarketCapture(original,captures,updated);
console.log(JSON.stringify({
  season,captureStatus,eligible:captures.length,skipped:skipped.length+captureAdmission.skipped.length,
  scheduleConflictSkips:skipped.filter(s=>s.reason==='SCHEDULE_RECONCILIATION_REQUIRED').length,
  captureAdmission:captureAdmission.diagnostics,
  derivedMarketDiagnostics,marketCapture,
  appended:added,newResultsOrCorrections:settled,
  cumulativeSnapshots:updated.snapshots.length,projectedSnapshots:summary.totalSnapshots,prospectiveGames:summary.prospectiveGames,
  retainedScheduleQuarantine:summary.quarantine,
  finalized:summary.settledGames,paired:summary.pairedMarketGames,
  resultReconciliation:finalReconciliation.diagnostics,
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
