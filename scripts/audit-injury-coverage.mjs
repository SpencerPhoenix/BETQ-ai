#!/usr/bin/env node
import {readFile,mkdir,writeFile,appendFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditInjuryCoverage} from '../src/injury-coverage-audit.mjs';
const path='data/nfl_injuries.json';
if((await stat(path)).size>1500000)throw Error('INJURY_ARTIFACT_SIZE_LIMIT');
const raw=await readFile(path,'utf8');
const report={...auditInjuryCoverage(JSON.parse(raw)),artifactSha256:createHash('sha256').update(raw).digest('hex')};
await mkdir('audit-output',{recursive:true});
await writeFile('audit-output/injury-coverage.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(process.env.GITHUB_STEP_SUMMARY){
 const lines=['## Injury coverage audit',`Source file vintage: ${report.sourceUpdatedAt}. Source usable: ${report.sourceAvailable}.`,
  `Date-window games with both team-week records: ${report.gamesWithBothRecords}/${report.candidateGameCount}; both usable: ${report.gamesWithBothUsableRecords}/${report.candidateGameCount}.`,
  ...report.weeks.map(w=>`Week ${w.week}: ${w.recordedTeamCount}/32 league teams have records; missing candidate teams: ${w.missingCandidateTeams.join(', ')||'none'}.`),
  `Status: ${report.status}. ${report.caveat}`];
 await appendFile(process.env.GITHUB_STEP_SUMMARY,lines.join('\n\n')+'\n');
}
