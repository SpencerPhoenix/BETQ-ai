/** Offline preflight. No credential access and no network. */
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {JOURNAL_SHA256} from './run.mjs';
import {validateJournal} from './lib/evidence.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  const manifest=JSON.parse(await readFile(new URL('./reviewed-source.json',import.meta.url),'utf8'));
  if(manifest.sourceCommit!=='0ccfec250206c871151a2db5520b8fbc5ea5cd0b')throw Error('SOURCE');
  const originalHashes={
    'lib/balldontlie-crosscheck.mjs':'70a6985cb87407da976012944efbbc930613954ec476db017618fdb72d32f3ec',
    'lib/balldontlie-live-reader.mjs':'f7b55b7e58fee94d960505993f2cc1fd6a25eaccac1f2d48fb76a741a418d87f'
  };
  if(JSON.stringify(Object.keys(manifest.localModifications??{}).sort())!==
    JSON.stringify(Object.keys(originalHashes).sort()))throw Error('MODIFICATIONS');
  for(const [file,original] of Object.entries(originalHashes)){
    const purpose=file==='lib/balldontlie-crosscheck.mjs'?
      'Allowlisted diagnostics and documented omitted cursor on validated short pages':
      'Allowlisted validation diagnostics only; acceptance rules unchanged';
    if(manifest.localModifications[file].sourceSha256!==original||manifest.files[file]===original||
      manifest.localModifications[file].purpose!==purpose)
      throw Error('MODIFICATION_PROVENANCE');
  }
  const names=(await readdir(new URL('./lib/',import.meta.url))).sort().map(x=>'lib/'+x);
  if(JSON.stringify(names)!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('FILES');
  for(const file of names){
    if(hash(await readFile(new URL('./'+file,import.meta.url)))!==manifest.files[file])throw Error('HASH');
  }
  const journal=await readFile(new URL('../../data/evidence/nfl-2026.json',import.meta.url));
  if(hash(journal)!==JOURNAL_SHA256)throw Error('JOURNAL_HASH');
  validateJournal(JSON.parse(journal));
  process.stdout.write('PASS: hashed diagnostic reader, upstream provenance and pinned actual journal are intact.\n');
}catch{process.stderr.write('FAIL: offline integrity preflight.\n');process.exitCode=1;}
