#!/usr/bin/env node
/** Fixed local files versus checked-out HEAD, stdout only; no live/provider calls. */
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {emptyJournal} from '../src/evidence.mjs';
import {verifyAppendOnlyEvidence} from '../src/evidence-transition.mjs';

const args=process.argv.slice(2);
if(args.length>1||args.length===1&&args[0]!=='--settlement-only')
  throw Error('Only --settlement-only is supported');
const settlementOnly=args.includes('--settlement-only');
const matches=path=>/^data\/evidence\/nfl-\d{4}\.json$/.test(path);
const parse=text=>{
  if(Buffer.byteLength(text,'utf8')>3000000)throw Error('EVIDENCE_JOURNAL_TOO_LARGE');
  return JSON.parse(text);
};
const previousFiles=execFileSync('git',['ls-tree','-r','--name-only','HEAD','--','data/evidence/'],
  {encoding:'utf8',maxBuffer:1000000}).split('\n').filter(matches);
const currentFiles=(await readdir('data/evidence')).map(name=>'data/evidence/'+name).filter(matches);
if(!currentFiles.length)throw Error('NO_EVIDENCE_JOURNALS');
if(previousFiles.some(path=>!currentFiles.includes(path)))throw Error('TRACKED_EVIDENCE_JOURNAL_DELETED');
const reports=[];
for(const path of currentFiles.sort()){
  if(settlementOnly&&!previousFiles.includes(path))throw Error('SETTLEMENT_ONLY_NEW_JOURNAL_FORBIDDEN');
  const season=Number(path.match(/nfl-(\d{4})/)[1]);
  const current=parse(await readFile(path,'utf8'));
  if(current.season!==season)throw Error('EVIDENCE_FILENAME_SEASON_MISMATCH');
  const previous=previousFiles.includes(path)?parse(execFileSync('git',['show','HEAD:'+path],
    {encoding:'utf8',maxBuffer:3000000})):emptyJournal(season);
  reports.push({file:path,...verifyAppendOnlyEvidence(previous,current,{allowNewSnapshots:!settlementOnly})});
}
console.log(JSON.stringify({verified:true,baseline:'CHECKED_OUT_HEAD',
  mode:settlementOnly?'SETTLEMENT_ONLY':'CAPTURE',filesWritten:0,providerRequests:0,reports},null,2));
