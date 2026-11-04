/** Offline preflight. No credential access and no network. */
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JOURNAL_SHA256} from './run.mjs';
import {validateJournal} from './lib/evidence.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  const manifest=JSON.parse(await readFile(new URL('./reviewed-source.json',import.meta.url),'utf8'));
  if(manifest.sourceCommit!=='0ccfec250206c871151a2db5520b8fbc5ea5cd0b')throw Error('SOURCE');
  const names=(await readdir(new URL('./lib/',import.meta.url))).sort().map(x=>'lib/'+x);
  if(JSON.stringify(names)!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('FILES');
  for(const file of names){
    if(hash(await readFile(new URL('./'+file,import.meta.url)))!==manifest.files[file])throw Error('HASH');
  }
  const journal=await readFile(new URL('../../data/evidence/nfl-2026.json',import.meta.url));
  if(hash(journal)!==JOURNAL_SHA256)throw Error('JOURNAL_HASH');
  validateJournal(JSON.parse(journal));
  process.stdout.write('PASS: reviewed reader snapshot and pinned actual journal are intact.\n');
}catch{process.stderr.write('FAIL: offline integrity preflight.\n');process.exitCode=1;}
