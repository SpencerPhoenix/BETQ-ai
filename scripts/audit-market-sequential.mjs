#!/usr/bin/env node
/**
 * No-cost market-relative forward evidence audit.
 * Computes derived proper scores and conditional likelihood diagnostics ONLY
 * on immutable, source-verified pregame observations from BETQ's public journal.
 * Does not require odds-provider API calls or historic reconstructed prices.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {calculateSequentialEvidence} from '../src/market-sequential.mjs';

const p='data/evidence/nfl-2026.json';
const contents=await readFile(p,'utf8');
if(contents.length>3_000_000)throw Error('Oversized prospective source');
const digest=createHash('sha256').update(contents).digest('hex');
const report=calculateSequentialEvidence(JSON.parse(contents));
if(report.schema!==1||report.version!=='betq-market-sequential-v1'||
   report.bettingAuthorized!==false||report.verifiedCLV!==null||
   report.verifiedROI!==null||report.marketBeatingEdgeEstablished===true||
   report.modelPromoted!==false||report.sequentialNullProvenCorrect!==false||
   (report.eligibleSettledNonTieGames<30&&
     (report.properScores!==null||
      report.candidateEvidence.fixedMixtureEvidence!==null)))
  throw Error('Unsafe sequential evidence source or performance publication');

const artifact={
  version:'betq-market-sequential-audit-v1',
  source:'BETQ_PROSPECTIVE_DERIVED_JOURNAL',
  sourceSha256:digest,
  report,
  privateRawBookmakerQuotesIncluded:false,
  verifiedBookmakerFills:false,
  profitabilityVerified:false
};
await mkdir('audit-output',{recursive:true});
await writeFile('audit-output/market-sequential.json',JSON.stringify(artifact,null,2)+'\n');
console.log('FORWARD MARKET EVIDENCE: '+report.eligibleSettledNonTieGames+
  ' first-source-paired finalized games; '+report.gamesNeededForDescriptiveScore+
  ' additional games needed for a reportable research score');
console.log('LIKELIHOOD EVIDENCE: '+(report.candidateEvidence.fixedMixtureEvidence===null?
  'WITHHELD_UNDER_30':report.candidateEvidence.fixedMixtureEvidence));
console.log('MODEL PROMOTION: FALSE; VERIFIED ENTRY/CLV/ROI: UNAVAILABLE');
