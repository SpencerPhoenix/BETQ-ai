#!/usr/bin/env node
/** Audit only checked-out derived evidence. No transport, credentials or journal writes. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {validatePublicJournal,recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';

const path='data/evidence/nfl-2026.json';
const bytes=await readFile(path);
if(bytes.byteLength>5_000_000)throw Error('OVERSIZED_RETAINED_JOURNAL');
const journal=validatePublicJournal(JSON.parse(bytes.toString('utf8')));
const now=Date.now(),grades=gradeRetainedGames(journal,{now});
if(!grades.available)throw Error('INVALID_RETAINED_GRADING_EVIDENCE');
const summary=recomputeJournalEvidence(journal,now);
const reasonCounts={};
for(const game of grades.games)for(const reason of game.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
const report={schema:1,version:'betq-retained-game-audit-v1',
  source:{path,sha256:createHash('sha256').update(bytes).digest('hex')},
  generatedAt:new Date(now).toISOString(),
  status:grades.coverage.gradedGames===0?'NO_QUALIFIED_GAME_GRADES':'DESCRIPTIVE_GRADES_AVAILABLE',
  independentOutcomeVerificationPerformed:false,providerRequests:0,paidOddsRequests:0,
  journalModified:false,collectorHealthVerified:false,reasonCounts,summary,grades};
await mkdir('audit-output',{recursive:true});
await writeFile('audit-output/retained-game-grades.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,source:report.source,coverage:grades.coverage,reasonCounts},null,2));
