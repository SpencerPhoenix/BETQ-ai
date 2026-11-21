#!/usr/bin/env node
/** Read local regular files only; report to stdout without modifying inputs. */
import {open} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {auditDescriptiveGrades} from '../src/descriptive-grade-audit.mjs';

const usage='Usage: node scripts/audit-descriptive-grades.mjs [--journal PATH] [--official-ledger PATH]';
const bundled=fileURLToPath(new URL('../data/evidence/nfl-2026.json',import.meta.url));
async function readInput(path,limit){
 if(!path||path.startsWith('-')||/^[a-z][\w+.-]*:\/\//i.test(path))throw Error('INVALID_LOCAL_INPUT_PATH');
 const fd=await open(path,fsConstants.O_RDONLY|fsConstants.O_NONBLOCK);
 try{
  const info=await fd.stat();
  if(!info.isFile()||info.size>limit)throw Error('NONREGULAR_OR_OVERSIZED_INPUT');
  // Read at most limit + 1 bytes even if a file grows after the initial stat.
  const bytes=Buffer.alloc(info.size+1);let n=0;
  while(n<bytes.length){
   const {bytesRead}=await fd.read(bytes,n,bytes.length-n,n);
   if(bytesRead===0)break;
   n+=bytesRead;
  }
  if(n!==info.size)throw Error('INPUT_CHANGED_DURING_READ');
  const body=bytes.subarray(0,n);
  return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)),sha256:createHash('sha256').update(body).digest('hex')};
 }finally{await fd.close();}
}
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){console.log(usage);}
else try{
 const inputs={};
 for(let i=0;i<args.length;i+=2){
  const flag=args[i];if(!['--journal','--official-ledger'].includes(flag)||Object.hasOwn(inputs,flag)||!args[i+1])throw Error('INVALID_ARGUMENTS');
  inputs[flag]=args[i+1];
 }
 const journal=await readInput(inputs['--journal']??bundled,5_000_000);
 const official=inputs['--official-ledger']===undefined?null:await readInput(inputs['--official-ledger'],8_000_000);
 if(official&&(!official.value||typeof official.value!=='object'||Array.isArray(official.value)))throw Error('INVALID_OFFICIAL_INPUT');
 const report=await auditDescriptiveGrades(journal.value,{officialLedger:official?.value??null});
 console.log(JSON.stringify({...report,sources:{journalSha256:journal.sha256,officialLedgerSha256:official?.sha256??null}},null,2));
}catch{
 console.error('Descriptive grades not available: invalid arguments or local evidence. '+usage);
 process.exitCode=1;
}
