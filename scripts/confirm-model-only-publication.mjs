#!/usr/bin/env node
import {readFile,writeFile,rename} from 'node:fs/promises';import {resolve} from 'node:path';
import {confirmModelPublication} from '../src/scheduled-model-ledger.mjs';
const [path,remoteCommit,serverDate,...extra]=process.argv.slice(2);if(!path||extra.length)throw Error('Expected ledger path remote commit and authenticated readback Date');
const text=await readFile(path,'utf8');if(text.length>8000000)throw Error('LEDGER_SIZE_LIMIT');
const ledger=confirmModelPublication(JSON.parse(text),{remoteCommit,serverDate});
await writeFile(resolve(path)+'.tmp',JSON.stringify(ledger,null,2)+'\n',{mode:0o600});await rename(resolve(path)+'.tmp',resolve(path));
console.log('Custody candidate appended only where remote readback preceded kickoff; publish and read back this ledger before reporting saved.');
