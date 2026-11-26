// Opt-in, odds-free check. This script never runs the collector or modifies a ledger.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {describeModelOnlyRelease} from '../src/model-delivery.mjs';
import {inspectModelOnlyHealth} from '../src/model-only-health.mjs';
const commit=process.argv[2]??'';
const fromRepo=path=>readFile(new URL('../'+path,import.meta.url),'utf8').then(JSON.parse);
if(process.argv.length!==3||!/^[a-f0-9]{40}$/.test(commit)||
  execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim()!==commit)
 throw Error('EXACT_RELEASE_CHECKOUT_REQUIRED');
const [elo,challenger]=await Promise.all([fromRepo('data/nfl_elo.json'),fromRepo('data/nfl_efficiency.json')]);
const expectedRelease=describeModelOnlyRelease(commit,challenger);
if(!expectedRelease)throw Error('EXPECTED_RELEASE_IDENTITY_INVALID');
const result=await inspectModelOnlyHealth(elo,{expectedRelease});
console.log(JSON.stringify({checkedAt:new Date().toISOString(),expectedRelease,...result,paidRequests:0}));
if(!result.compatible)process.exitCode=1;
