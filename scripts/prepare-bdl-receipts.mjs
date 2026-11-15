#!/usr/bin/env node
/** Explicit offline files only. Never fetches, reads credentials, or updates the research journal. */
import {open,mkdir,realpath,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {emptyBdlReceiptLedger,appendBdlReceipt,validateBdlReceiptLedger,
  summarizeBdlReceiptLedger,assertBdlReceiptLedgerExtension,bdlReceiptDigest} from '../src/bdl-receipt-ledger.mjs';

const LIMITS={manifest:16384,journal:5000000,bdl:262144,nflverse:4000000,ledger:20000000,report:5000000};
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const usage='Usage: node scripts/prepare-bdl-receipts.mjs --manifest LOCAL_JSON --output NEW_PRIVATE_DIRECTORY\n'+
  '       node scripts/prepare-bdl-receipts.mjs --verify EXISTING_PRIVATE_DIRECTORY [--previous-ledger LOCAL_JSON]\n'+
  'Offline only. No network, credentials, source acquisition, scoring, or production activation.\n';
function args(argv){
  if(argv.length===1&&argv[0]==='--help')return {help:true};
  const allowed=new Set(['--manifest','--output','--verify','--previous-ledger']),out={};
  for(let i=0;i<argv.length;i+=2){
    if(!allowed.has(argv[i])||Object.hasOwn(out,argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))fail('INVALID_ARGUMENTS');
    out[argv[i]]=argv[i+1];
  }
  if(out['--verify']){
    if(out['--manifest']||out['--output'])fail('INVALID_ARGUMENTS');
  }else if(!out['--manifest']||!out['--output']||out['--previous-ledger'])fail('INVALID_ARGUMENTS');
  return out;
}
function localPath(value,base=process.cwd()){
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u001f\u007f]/.test(value)||/^[a-z][a-z\d+.-]*:/i.test(value))fail('LOCAL_FILE_PATH_REQUIRED');
  return resolve(base,value);
}
async function bytes(path,limit){
  // Disallow symlink aliases and special files; never follow an input URL or FIFO.
  if(await realpath(path)!==path)fail('SYMLINK_INPUT_NOT_ALLOWED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size===0||stat.size>limit)fail('INVALID_INPUT_FILE_SIZE');
    const buffer=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<buffer.length){const read=await handle.read(buffer,offset,buffer.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    if(offset!==stat.size)fail('INPUT_FILE_CHANGED_DURING_READ');
    return buffer.subarray(0,offset);
  }finally{await handle.close();}
}
function json(raw){
  let text,value;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);value=JSON.parse(text);}catch{fail('INVALID_INPUT_JSON');}
  // JSON.parse silently accepts duplicate keys. Reject them, including escaped aliases.
  let at=0;
  const ws=()=>{while(at<text.length&&/\s/.test(text[at]))at++;};
  const string=()=>{const start=at++;while(at<text.length){const c=text[at++];if(c==='\\')at++;else if(c==='"')break;}return JSON.parse(text.slice(start,at));};
  const scan=depth=>{
    if(depth>40)fail('INPUT_JSON_DEPTH_LIMIT');ws();
    if(text[at]==='{'){
      at++;ws();const seen=new Set();if(text[at]==='}'){at++;return;}
      for(;;){ws();const key=string();if(seen.has(key))fail('DUPLICATE_INPUT_JSON_KEY');seen.add(key);ws();at++;scan(depth+1);ws();if(text[at++]==='}')return;}
    }
    if(text[at]==='['){at++;ws();if(text[at]===']'){at++;return;}for(;;){scan(depth+1);ws();if(text[at++]===']')return;}}
    if(text[at]==='"'){string();return;}
    while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;
  };
  scan(0);return value;
}
async function readJson(path,limit){return json(await bytes(path,limit));}
function validateManifest(m){
  const required=['schema','journalPath','bdlPath','nflversePath','gameId','expectedProviderGameId','bdlRetrievedAt','nflverseRetrievedAt'];
  if(!m||Object.getPrototypeOf(m)!==Object.prototype||m.schema!==1||required.some(k=>!Object.hasOwn(m,k))||
    Object.keys(m).some(k=>!required.includes(k)&&k!=='previousLedgerPath'))fail('INVALID_MANIFEST');
  return m;
}
function safeSummary(ledger,report,mode){
  return {mode,activation:'DISABLED',scoringEligible:false,qualifiedOutcomes:0,providerRequests:0,
    paidRequests:0,journalModified:false,evidenceRevisions:ledger.entries.length,
    ledgerSha256:bdlReceiptDigest(ledger),reportSha256:bdlReceiptDigest(report)};
}
function encodeOutput(value,limit){
  const encoded=JSON.stringify(value,null,2)+'\n';
  if(Buffer.byteLength(encoded)>limit)fail('OUTPUT_FILE_SIZE_LIMIT');
  return encoded;
}
async function writeExclusive(path,encoded){
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(encoded);await handle.sync();}finally{await handle.close();}
}
async function main(){
  const options=args(process.argv.slice(2));if(options.help){process.stdout.write(usage);return;}
  const now=Date.now();
  if(options['--verify']){
    const directory=localPath(options['--verify']);
    if(await realpath(directory)!==directory)fail('SYMLINK_INPUT_NOT_ALLOWED');
    const journal=await readJson(resolve(directory,'frozen-journal.json'),LIMITS.journal);
    const ledger=await readJson(resolve(directory,'ledger.json'),LIMITS.ledger);
    validateBdlReceiptLedger(ledger,journal,{now});
    if(options['--previous-ledger']){
      const previous=await readJson(localPath(options['--previous-ledger']),LIMITS.ledger);
      assertBdlReceiptLedgerExtension(previous,ledger,journal,{now});
    }
    const report=summarizeBdlReceiptLedger(ledger,journal,{now});
    // Stored report is a historical appraisal, not a new source observation.
    const stored=await readJson(resolve(directory,'report.json'),LIMITS.report);
    if(bdlReceiptDigest(stored)!==bdlReceiptDigest(report))fail('REPORT_REPLAY_MISMATCH');
    process.stdout.write(JSON.stringify(safeSummary(ledger,report,'VERIFIED_PRIVATE_OFFLINE_BUNDLE'))+'\n');return;
  }
  const manifestPath=localPath(options['--manifest']),manifest=validateManifest(await readJson(manifestPath,LIMITS.manifest));
  const base=dirname(manifestPath),journal=await readJson(localPath(manifest.journalPath,base),LIMITS.journal);
  const previous=manifest.previousLedgerPath===undefined?emptyBdlReceiptLedger(journal):
    await readJson(localPath(manifest.previousLedgerPath,base),LIMITS.ledger);
  const result=appendBdlReceipt(previous,journal,{gameId:manifest.gameId,expectedProviderGameId:manifest.expectedProviderGameId,
    bdlBytes:await bytes(localPath(manifest.bdlPath,base),LIMITS.bdl),
    nflverseBytes:await bytes(localPath(manifest.nflversePath,base),LIMITS.nflverse),
    bdlRetrievedAt:manifest.bdlRetrievedAt,nflverseRetrievedAt:manifest.nflverseRetrievedAt,
    recordedAt:new Date(now).toISOString()},{now});
  assertBdlReceiptLedgerExtension(previous,result.ledger,journal,{now});
  const report=summarizeBdlReceiptLedger(result.ledger,journal,{now});
  const journalOutput=encodeOutput(journal,LIMITS.journal),ledgerOutput=encodeOutput(result.ledger,LIMITS.ledger),
    reportOutput=encodeOutput(report,LIMITS.report);
  const requested=localPath(options['--output']),parent=await realpath(dirname(requested));
  if(parent!==dirname(requested))fail('SYMLINK_OUTPUT_PARENT_NOT_ALLOWED');
  const root=await realpath(fileURLToPath(new URL('../',import.meta.url))),rel=relative(root,requested);
  if(rel===''||(!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&rel!=='..'&&!isAbsolute(rel)))fail('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const output=resolve(parent,basename(requested));
  await mkdir(output,{mode:0o700}); // Exclusive directory: no overwrite, merge, or append-in-place.
  try{
    await writeExclusive(resolve(output,'frozen-journal.json'),journalOutput);
    await writeExclusive(resolve(output,'ledger.json'),ledgerOutput);
    await writeExclusive(resolve(output,'report.json'),reportOutput);
    const directory=await open(output,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
  }catch(error){await rm(output,{recursive:true,force:true});throw error;}
  process.stdout.write(JSON.stringify({...safeSummary(result.ledger,report,'PREPARED_PRIVATE_OFFLINE_BUNDLE'),added:result.added})+'\n');
}
main().catch(error=>{
  const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.code)?error.code:'OFFLINE_RECEIPT_PREPARATION_FAILED';
  process.stderr.write('BETQ_OFFLINE_RECEIPT_ERROR '+code+'\n');process.exitCode=1;
});
