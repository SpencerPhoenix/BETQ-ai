#!/usr/bin/env node
/** Explicit manual sample only. Raw sources remain in memory until encrypted for the named recipient. */
import {open,mkdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,basename,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {collectBdlOutcomeSample,BDL_PROVIDER_LIST_STATES} from '../src/bdl-sample-collector.mjs';
import {validateBdlRecipientPublicKey,encryptBdlPrivateBundle} from '../src/bdl-private-envelope.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const JOURNAL=resolve(ROOT,'data/evidence/nfl-2026.json');
const LIMITS={publicKey:16384,journal:5000000,envelope:23000000,summary:8192};
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const ERRORS=new Set(['INVALID_ARGUMENTS','LOCAL_FILE_PATH_REQUIRED','SYMLINK_INPUT_NOT_ALLOWED','INVALID_INPUT_FILE_SIZE',
  'INPUT_FILE_CHANGED_DURING_READ','INVALID_INPUT_JSON','SYMLINK_OUTPUT_PARENT_NOT_ALLOWED','OUTPUT_MUST_BE_OUTSIDE_REPOSITORY',
  'OUTPUT_EXISTS','OUTPUT_WRITE_FAILED','OUTPUT_FILE_SIZE_LIMIT','API_KEY_REQUIRED','INVALID_API_KEY','INVALID_RECIPIENT_PUBLIC_KEY',
  'RECIPIENT_RSA_3072_TO_8192_REQUIRED','PRIVATE_BUNDLE_SIZE_LIMIT','PRIVATE_BUNDLE_ENCRYPTION_FAILED','INVALID_DEPENDENCIES',
  'INVALID_OBSERVATION_CLOCK','INVALID_INPUT','INVALID_FROZEN_IDENTITY','SOURCE_CHUNK_LIMIT','CREDENTIAL_ECHO_REJECTED','INVALID_FROZEN_JOURNAL','MISSING_OR_QUARANTINED_TARGET','FINALITY_DELAY_NOT_REACHED',
  'UNSUPPORTED_CROSS_DATE_TARGET','PUBLIC_REDIRECT_REJECTED','SOURCE_TIMEOUT','UNEXPECTED_REDIRECT','PROVIDER_REDIRECT_REJECTED',
  'PROVIDER_HTTP_ERROR','PUBLIC_HTTP_ERROR','SOURCE_TOO_LARGE','SOURCE_BODY_REQUIRED','SOURCE_READ_FAILED','INCOMPLETE_SOURCE',
  'INVALID_PROVIDER_JSON','PROVIDER_JSON_DEPTH_LIMIT','DUPLICATE_PROVIDER_JSON_KEY','INCOMPLETE_PROVIDER_LIST',
  'AMBIGUOUS_PROVIDER_MAPPING','PROVIDER_MAPPING_MISMATCH','INVALID_SINGLE_RESPONSE','PROVIDER_LIST_DETAIL_MISMATCH',
  'SAMPLE_WINDOW_EXCEEDED','CANDIDATE_REJECTED','RECEIPT_VALIDATION_FAILED','SAMPLE_FAILED']);
function args(argv){
  if(argv.length===1&&argv[0]==='--help')return {help:true};
  const allowed=['--game-id','--recipient-public-key','--output'],out={};
  if(argv.length!==6)fail('INVALID_ARGUMENTS');
  for(let i=0;i<argv.length;i+=2){
    if(!allowed.includes(argv[i])||Object.hasOwn(out,argv[i])||typeof argv[i+1]!=='string'||!argv[i+1]||argv[i+1].startsWith('--'))fail('INVALID_ARGUMENTS');
    out[argv[i]]=argv[i+1];
  }
  if(!/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/.test(out['--game-id']))fail('INVALID_ARGUMENTS');return out;
}
function localPath(value){
  if(typeof value!=='string'||!value||value.length>4096||/[\u0000-\u001f\u007f]/.test(value)||/^[a-z][a-z\d+.-]*:/i.test(value))fail('LOCAL_FILE_PATH_REQUIRED');return resolve(value);
}
async function bytes(path,limit){
  if(await realpath(path)!==path)fail('SYMLINK_INPUT_NOT_ALLOWED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size===0||stat.size>limit)fail('INVALID_INPUT_FILE_SIZE');
    const result=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<result.length){const read=await handle.read(result,offset,result.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    if(offset!==stat.size)fail('INPUT_FILE_CHANGED_DURING_READ');return result.subarray(0,offset);
  }finally{await handle.close();}
}
function json(raw){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('INVALID_INPUT_JSON');}
}
function encoded(value,limit){const data=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(data)>limit)fail('OUTPUT_FILE_SIZE_LIMIT');return data;}
async function write(path,value){
  const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
}
const count=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max?value:0;
function summary({ok=false,error='SAMPLE_FAILED',diagnostics={},recipientKeySha256=null,encryptedArtifactSha256=null,encryptedArtifactStored=ok}={}){
  return {schema:1,status:ok?'ENCRYPTED_NONQUALIFYING_SAMPLE':'SAMPLE_FAILED',manualOnly:true,
    error:ok?null:ERRORS.has(error)?error:'SAMPLE_FAILED',bdlRequests:count(diagnostics.bdlRequests,2),
    publicRequests:count(diagnostics.publicRequests,3),
    providerListState:BDL_PROVIDER_LIST_STATES.includes(diagnostics.providerListState)?diagnostics.providerListState:'NOT_OBSERVED',
    scoringEligible:false,qualifiedOutcomes:0,
    sourceIndependenceVerified:false,sourceAuthenticityVerified:false,journalModified:false,plaintextStored:false,
    encryptedArtifactStored,recipientKeySha256,encryptedArtifactSha256};
}
/** Trusted injected dependencies exist for offline tests; normal invocation uses the manual process environment. */
export async function runBdlSampleCli(argv,{env=process.env,fetchImpl=globalThis.fetch,clock=Date.now,
  stdout=text=>process.stdout.write(text),stderr=text=>process.stderr.write(text)}={}){
  let directory=null,recipientKeySha256=null,diagnostics={},finalSummary,apiKey=null,encryptedArtifactSha256=null,encryptedArtifactStored=false;
  try{
    const options=args(argv);
    if(options.help){stdout('Usage: node scripts/collect-bdl-sample.mjs --game-id GAME_ID --recipient-public-key PUBLIC_PEM --output NEW_PRIVATE_DIRECTORY\n'+
      'Manual only. Uses BALLDONTLIE_API_KEY from the environment. Stores encrypted sources and a sanitized summary; never qualifies scoring.\n');return 0;}
    const requested=localPath(options['--output']),parent=await realpath(dirname(requested));
    if(parent!==dirname(requested))fail('SYMLINK_OUTPUT_PARENT_NOT_ALLOWED');
    const root=await realpath(ROOT),rel=relative(root,requested);
    if(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))fail('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
    const output=resolve(parent,basename(requested));
    try{await mkdir(output,{mode:0o700});}catch(error){if(error?.code==='EEXIST')fail('OUTPUT_EXISTS');throw error;}
    directory=output;
    const rawPublicKey=await bytes(localPath(options['--recipient-public-key']),LIMITS.publicKey);
    let publicKeyPem;try{publicKeyPem=new TextDecoder('utf-8',{fatal:true}).decode(rawPublicKey);}catch{fail('INVALID_RECIPIENT_PUBLIC_KEY');}
    recipientKeySha256=validateBdlRecipientPublicKey(publicKeyPem).recipientKeySha256;
    apiKey=env?.BALLDONTLIE_API_KEY;
    if(apiKey==null||apiKey==='')fail('API_KEY_REQUIRED');
    if(typeof apiKey!=='string'||!/^[\x21-\x7e]{1,512}$/.test(apiKey))fail('INVALID_API_KEY');
    const journal=json(await bytes(JOURNAL,LIMITS.journal));
    const result=await collectBdlOutcomeSample({journal,gameId:options['--game-id'],apiKey},{fetchImpl,clock});
    diagnostics=result.diagnostics??{};
    if(!result.ok)fail(ERRORS.has(result.error)?result.error:'SAMPLE_FAILED');
    const envelope=encryptBdlPrivateBundle(result.privateBundle,publicKeyPem);
    const encrypted=encoded(envelope,LIMITS.envelope);
    encryptedArtifactSha256=createHash('sha256').update(encrypted).digest('hex');
    await write(resolve(directory,'envelope.json'),encrypted);encryptedArtifactStored=true;
    finalSummary=summary({ok:true,diagnostics,recipientKeySha256,encryptedArtifactSha256});
  }catch(error){finalSummary=summary({error:error?.code,diagnostics,recipientKeySha256,encryptedArtifactSha256:encryptedArtifactStored?encryptedArtifactSha256:null,encryptedArtifactStored});}
  finally{apiKey=null;}
  if(directory){
    try{
      await write(resolve(directory,'summary.json'),encoded(finalSummary,LIMITS.summary));
      const handle=await open(directory,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}
    }catch{finalSummary=summary({error:'OUTPUT_WRITE_FAILED',diagnostics,recipientKeySha256,encryptedArtifactSha256:encryptedArtifactStored?encryptedArtifactSha256:null,encryptedArtifactStored});}
  }
  stdout(JSON.stringify(finalSummary)+'\n');
  if(finalSummary.status==='SAMPLE_FAILED'){stderr('BETQ_MANUAL_SAMPLE_ERROR '+finalSummary.error+'\n');return 1;}return 0;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runBdlSampleCli(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(()=>{
    process.stderr.write('BETQ_MANUAL_SAMPLE_ERROR SAMPLE_FAILED\n');process.exitCode=1;
  });
}
