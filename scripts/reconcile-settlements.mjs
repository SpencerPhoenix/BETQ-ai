#!/usr/bin/env node
/** Dedicated free nflverse result-only execution path. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {parseCsv} from '../src/nfl-elo.mjs';
import {createHash} from 'node:crypto';
import {corroborateFinals} from '../src/settlement-corroboration.mjs';
import {validateJournal,summarizeEvidence} from '../src/evidence.mjs';
import {fetchNflverseScheduleCsv,selectFinalizedResults,reconcileSettlements,nflSeasonAt} from '../src/settlement-only.mjs';

const args=process.argv.slice(2);
if (args.some(a=>a!=='--dry-run')) throw Error('SUPPORTED_OPTION_ONLY_--dry-run');
const dryRun=args.includes('--dry-run');
const now=Date.now();
const season=nflSeasonAt(now);
const journalPath='data/evidence/nfl-'+season+'.json';
const summaryPath='data/evidence/summary.json';

// Validate existing local evidence before any network access.
const original=validateJournal(JSON.parse(await readFile(journalPath,'utf8')));
const scheduleCsv=await fetchNflverseScheduleCsv();
const rows=parseCsv(scheduleCsv);
// This is the local collector's time of receipt, NOT the provider's publication time.
const sourceObservedAt=new Date().toISOString();
const sourceSha256=createHash('sha256').update(scheduleCsv).digest('hex');
const candidates=selectFinalizedResults(original,rows,{now});
const confirmation=await corroborateFinals(original,candidates);
const result=reconcileSettlements(original,rows,{
  now:Date.now(),attestations:confirmation.attestations,
  communitySourceSha256:sourceSha256,communitySourceObservedAt:sourceObservedAt
});
validateJournal(result.journal);
const report={season,source:'NFLVERSE_SCHEDULES_CC_BY_4_0',
  appendedSettlementRevisions:result.appended,finalScoreCandidates:result.sourceFinalScoreCandidates,
  trackedGames:new Set(original.snapshots.map(s=>s.gameId)).size,
  originalSnapshots:original.snapshots.length,
  resultingSettledGames:new Set(result.journal.settlements.map(s=>s.gameId)).size,
  independentlyConfirmed:confirmation.confirmed,
  awaitingIndependentFinal:result.uncorroboratedCandidates,
  finalStatusUnavailableDates:confirmation.unavailableDates,
  scheduleSourceSha256:sourceSha256,
  scheduleSourceObservedAt:sourceObservedAt,
  dryRun,paidOddsRequests:0};
console.log(JSON.stringify(report,null,2));
if (!result.appended || dryRun){
  console.log('No evidence files modified.');
  process.exit(0);
}
const summary=summarizeEvidence(result.journal,now);
// The GitHub workflow commits these files only after all checks pass.
// Temporary local writes plus rename prevent a partial JSON file on crash.
const suffix='.settle-tmp-'+process.pid;
await writeFile(journalPath+suffix,JSON.stringify(result.journal,null,2)+'\n','utf8');
await writeFile(summaryPath+suffix,JSON.stringify(summary,null,2)+'\n','utf8');
await rename(journalPath+suffix,journalPath);
await rename(summaryPath+suffix,summaryPath);
console.log('Appended independently matched settlements; original forecasts unchanged.');
