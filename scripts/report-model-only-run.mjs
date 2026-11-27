#!/usr/bin/env node
/** Run only after publication: degraded status must not prevent preserving evidence. */
import {readFile,appendFile} from 'node:fs/promises';
import {validateModelLedger} from '../src/scheduled-model-ledger.mjs';
import {modelOnlyRunStatus} from '../src/model-only-health.mjs';
const [path,...extra]=process.argv.slice(2),runKey=`${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT}`;
if(!path||extra.length||!/^\d+\.\d+$/.test(runKey))throw Error('Expected LEDGER_PATH and workflow run identity');
const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>8000000)throw Error('LEDGER_SIZE_LIMIT');
const status=modelOnlyRunStatus(validateModelLedger(JSON.parse(text)),runKey);
console.log(JSON.stringify(status));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Model-only evidence run\n\n- Forecast capture: **${status.capture.status}**\n- Postgame grading: **${status.grading.status}**\n\n\`\`\`json\n${JSON.stringify(status,null,2)}\n\`\`\`\n\nA heartbeat is not a forecast. Capture counts do not establish predictive advantage.\n`);
if(status.grading.status==='DEGRADED')console.warn('::warning title=Postgame grading degraded::'+status.grading.reasons.join(', '));
if(status.capture.status==='DEGRADED'){console.error('::error title=Forecast capture degraded::'+status.capture.reasons.join(', '));process.exitCode=1;}
