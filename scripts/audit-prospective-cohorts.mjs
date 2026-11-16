#!/usr/bin/env node
/** Offline audit only: no provider calls, writes, or history mutation. */
import {readFileSync} from 'node:fs';
import {auditProspectiveCohorts} from '../src/prospective-cohorts.mjs';
const input=process.argv[2]??new URL('../data/evidence/nfl-2026.json',import.meta.url);
try{
 const report=auditProspectiveCohorts(JSON.parse(readFileSync(input,'utf8')));
 console.log(JSON.stringify(report,null,2));
 if(!report.available)process.exitCode=1;
}catch{console.error('Unable to audit input journal');process.exitCode=1;}
