/** Dedicated one-file evidence branch; never publishes application code or main. */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {validateModelLedger,assertLedgerAppend} from '../src/scheduled-model-ledger.mjs';
import {readBoundedText} from '../src/integrity.mjs';
export const REPOSITORY='SpencerPhoenix/BETQ-ai';
export const BRANCH='evidence/model-only-scheduled';
const LIMIT=8*1024*1024,SHA=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error(code);};
const checkpointPath=path=>path+'.publication-checkpoint.json';
export function assertWorkflowIdentity(env){
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||
   !['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||
   !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT||''))fail('PUBLICATION_WORKFLOW_SCOPE_INVALID');
}
export function githubClient({token=null,fetchImpl=fetch}={}){
 return async(path,{method='GET',body,raw=false,allow404=false}={})=>{
  if(!path.startsWith('/')||path.includes('..'))fail('PUBLICATION_API_PATH_INVALID');
  const response=await fetchImpl('https://api.github.com/repos/'+REPOSITORY+path,{
   method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{
    Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28','User-Agent':'BETQ-model-only-ledger',
    ...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(allow404&&response.status===404)return {data:null,date:null};
  if(!response.ok)fail('PUBLICATION_GITHUB_HTTP_'+response.status);
  const text=await readBoundedText(response,raw?LIMIT:LIMIT*2);
  const date=Date.parse(response.headers.get('date'));
  return {data:raw?text:JSON.parse(text),date:Number.isFinite(date)?new Date(date).toISOString():null};
 };
}
async function readHead(api){
 const {data}=await api('/git/ref/heads/'+BRANCH,{allow404:true});
 if(data===null)return null;
 if(data.ref!=='refs/heads/'+BRANCH||data.object?.type!=='commit'||!SHA.test(data.object.sha))fail('PUBLICATION_REF_INVALID');
 return data.object.sha;
}
async function readLedger(api,sha){
 if(!SHA.test(sha))fail('PUBLICATION_COMMIT_INVALID');
 const commit=(await api('/git/commits/'+sha)).data;
 if(!SHA.test(commit.tree?.sha))fail('PUBLICATION_TREE_INVALID');
 const tree=(await api('/git/trees/'+commit.tree.sha)).data;
 if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length!==1||tree.tree[0].path!=='ledger.json'||tree.tree[0].type!=='blob'||tree.tree[0].mode!=='100644')fail('PUBLICATION_BRANCH_NOT_LEDGER_ONLY');
 const readback=await api('/git/blobs/'+tree.tree[0].sha);
 const blob=readback.data;
 if(blob.encoding!=='base64'||!Number.isSafeInteger(blob.size)||blob.size<0||blob.size>LIMIT||typeof blob.content!=='string')fail('PUBLICATION_BLOB_READBACK_INVALID');
 const encoded=blob.content.replace(/\s/g,'');
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('PUBLICATION_BLOB_READBACK_INVALID');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.length!==blob.size||bytes.toString('base64')!==encoded)fail('PUBLICATION_BLOB_READBACK_INVALID');
 const content=bytes.toString('utf8');if(!Buffer.from(content,'utf8').equals(bytes))fail('PUBLICATION_BLOB_READBACK_INVALID');
 validateModelLedger(JSON.parse(content));return {data:content,date:readback.date};
}
export async function prepareLedger(path,{api=githubClient()}={}){
 await mkdir(dirname(path),{recursive:true});
 try{await stat(path);fail('PUBLICATION_LOCAL_LEDGER_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const sha=await readHead(api);
 if(sha)await writeFile(path,(await readLedger(api,sha)).data,{flag:'wx'});
 await writeFile(checkpointPath(path),JSON.stringify({repository:REPOSITORY,branch:BRANCH,sha}));
 return sha;
}
export async function publishLedger(path,{api,mode,confirm}={}){
 if(!['reserve','final'].includes(mode)||typeof api!=='function')fail('PUBLICATION_MODE_INVALID');
 const state=JSON.parse(await readFile(checkpointPath(path),'utf8'));
 if(state.repository!==REPOSITORY||state.branch!==BRANCH||!(state.sha===null||SHA.test(state.sha)))fail('PUBLICATION_CHECKPOINT_INVALID');
 let expected=state.sha;
 async function persist(){
  const content=await readFile(path,'utf8');if(Buffer.byteLength(content)>LIMIT)fail('PUBLICATION_LEDGER_TOO_LARGE');const candidate=validateModelLedger(JSON.parse(content));
  const contentSha256=createHash('sha256').update(content).digest('hex');
  const current=await readHead(api);if(current!==expected)fail('PUBLICATION_BRANCH_MOVED');
  if(current){const before=await readLedger(api,current);assertLedgerAppend(JSON.parse(before.data),candidate);if(before.data===content)return {sha:current,date:before.date,contentSha256};}
  const blob=(await api('/git/blobs',{method:'POST',body:{content,encoding:'utf-8'}})).data;
  if(!SHA.test(blob.sha))fail('PUBLICATION_BLOB_INVALID');
  const tree=(await api('/git/trees',{method:'POST',body:{tree:[{path:'ledger.json',mode:'100644',type:'blob',sha:blob.sha}]}})).data;
  if(!SHA.test(tree.sha))fail('PUBLICATION_TREE_INVALID');
  const commit=(await api('/git/commits',{method:'POST',body:{message:'Append model-only scheduled evidence',tree:tree.sha,parents:expected?[expected]:[]}})).data;
  if(!SHA.test(commit.sha))fail('PUBLICATION_COMMIT_INVALID');
  if(expected)await api('/git/refs/heads/'+BRANCH,{method:'PATCH',body:{sha:commit.sha,force:false}});
  else await api('/git/refs',{method:'POST',body:{ref:'refs/heads/'+BRANCH,sha:commit.sha}});
  // Verify the committed bytes via authenticated GitHub response, not commit author dates.
  const actual=await readLedger(api,commit.sha);
  if(actual.data!==content||!actual.date||await readHead(api)!==commit.sha)fail('PUBLICATION_READBACK_MISMATCH');
  expected=commit.sha;
  await writeFile(checkpointPath(path),JSON.stringify({...state,sha:expected}));
  return {sha:expected,date:actual.date,contentSha256};
 }
 const first=await persist();if(!first.date)fail('PUBLICATION_SERVER_DATE_MISSING');
 if(mode==='final'){
  if(typeof confirm!=='function')fail('PUBLICATION_CONFIRMATION_MISSING');
  await confirm(path,first.sha,first.date);
  const second=await persist();
  return {captureCommit:first.sha,custodyCommit:second.sha,serverObservedAt:first.date};
 }
 await writeFile(checkpointPath(path),JSON.stringify({...state,sha:first.sha,reservationContentSha256:first.contentSha256,reservationServerDate:first.date}));
 return {reservationCommit:first.sha,serverObservedAt:first.date};
}
async function main(){
 assertWorkflowIdentity(process.env);
 const [mode,input,...extra]=process.argv.slice(2);if(extra.length||!input||!['prepare','reserve','final'].includes(mode))fail('PUBLICATION_ARGUMENTS_INVALID');
 const path=resolve(input);
 if(mode==='prepare')return console.log(JSON.stringify({prepared:true,priorCommit:await prepareLedger(path)}));
 if(!process.env.GITHUB_TOKEN)fail('PUBLICATION_TOKEN_MISSING');
 const api=githubClient({token:process.env.GITHUB_TOKEN});
 const confirm=async(path,sha,date)=>{
  // Only the publisher receives credentials. Confirmation code never inherits them.
  const env={...process.env};delete env.GITHUB_TOKEN;
  const result=spawnSync(process.execPath,['scripts/confirm-model-only-publication.mjs',path,sha,date],{env,stdio:'inherit'});
  if(result.error||result.status!==0)fail('PUBLICATION_CONFIRMATION_FAILED');
 };
 console.log(JSON.stringify(await publishLedger(path,{api,mode,confirm})));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(/^PUBLICATION_[A-Z0-9_]+$/.test(error.message)?error.message:'PUBLICATION_FAILED');process.exitCode=1;});
