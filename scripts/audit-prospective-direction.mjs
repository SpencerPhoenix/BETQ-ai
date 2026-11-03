#!/usr/bin/env node
/**
 * Prospective source-derived evidence audit.
 * No provider API calls, no reconstructed pregame prices, no profit claims.
 * Operates ONLY on the existing public BETQ derived NFL journal.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {summarizeProspectiveDirection} from '../src/prospective-direction.mjs';

const filepath='data/evidence/nfl-2026.json';
const text=await readFile(filepath,'utf8');
if(text.length>3_000_000)throw Error('Forward journal exceeds bounded audit size');
const journal=JSON.parse(text);
const summary=summarizeProspectiveDirection(journal);
const sha=createHash('sha256').update(text).digest('hex');
if(summary.schema!==1||summary.season!==2026||
   summary.marketBeatingEdgeEstablished!==false||
   summary.modelPromoted!==false||summary.bettingAuthorized!==false||
   summary.realMoneyROI!==null||summary.verifiedCLV!==null||
   summary.candidateMarketMovements>summary.gamesWithEligiblePairedObservations||
   summary.gamesWithEligiblePairedObservations>summary.gamesWithSnapshots)
  throw Error('Forward journal source trust or quantitative audit failed');
const research={
  generatedAt:new Date().toISOString(),
  journalSha256:sha,
  journalSnapshots:journal.snapshots.length,
  quoteProvenance:'DERIVED_MULTI_BOOK_NO_VIG_NOT_OFFER',
  sourceScope:'PROSPECTIVE_2026_ONLY',
  report:summary,
  realBettingProfitabilityEstablished:false,
  validationSource:'PRIVATE_QUOTES_NOT_AVAILABLE'
};
await mkdir('audit-output',{recursive:true});
await writeFile('audit-output/prospective-direction.json',JSON.stringify(research,null,2)+'\n','utf8');
console.log('BETQ source SHA256: '+sha);
console.log('FROZEN PRE-KICKOFF SNAPSHOTS: '+journal.snapshots.length);
console.log('UNIQUE TRACKED GAMES: '+summary.gamesWithSnapshots);
console.log('TIMESTAMP-PASSING PAIRED GAMES: '+summary.gamesWithEligiblePairedObservations);
console.log('QUALIFYING 0.5+ PP MOVES ON 3+ PP FIRST MODEL DISAGREEMENT: '+summary.candidateMarketMovements);
console.log('DIRECTION MATCHES / MISSES: '+summary.qualifyingDirectionMatches+'/'+summary.qualifyingDirectionMisses);
console.log('DESCRIPTIVE HIT RATE: '+(summary.directionMatchPercent===null?'WITHHELD_UNDER_30':summary.directionMatchPercent+'%'));
console.log('MODEL BEATS MARKET: UNVERIFIED; BOOKMAKER ENTRY/CLV/ROI: UNAVAILABLE');
