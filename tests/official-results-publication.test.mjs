// Synthetic offline publication transport; never production evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {emptyOfficialResultLedger} from '../src/official-result-ledger.mjs';
import {prepareLedger,publishLedger,githubClient,assertWorkflowIdentity,BRANCH} from '../scripts/publish-official-results.mjs';
const hash=n=>String(n).padStart(40,'0');
function mock(){
 let head=null,n=1;const blobs=new Map(),trees=new Map(),commits=new Map(),calls=[];
 const api=async(path,opts={})=>{calls.push([path,opts]);const {method='GET',body}=opts;let data;
  if(path==='/git/ref/heads/'+BRANCH)data=head?{ref:'refs/heads/'+BRANCH,object:{type:'commit',sha:head}}:null;
  else if(path==='/git/blobs'&&method==='POST'){const sha=hash(n++);blobs.set(sha,body.content);data={sha};}
  else if(path==='/git/trees'&&method==='POST'){assert.equal(body.tree.length,1);assert.equal(body.tree[0].path,'ledger.json');assert.equal(Object.hasOwn(body,'base_tree'),false);const sha=hash(n++);trees.set(sha,body.tree);data={sha};}
  else if(path==='/git/commits'&&method==='POST'){const sha=hash(n++);assert.deepEqual(body.parents,head?[head]:[]);commits.set(sha,{tree:{sha:body.tree},parents:body.parents});data={sha};}
  else if(path==='/git/refs'&&method==='POST'){assert.equal(head,null);assert.equal(body.ref,'refs/heads/'+BRANCH);head=body.sha;data={};}
  else if(path==='/git/refs/heads/'+BRANCH&&method==='PATCH'){assert.equal(body.force,false);assert.deepEqual(commits.get(body.sha).parents,[head]);head=body.sha;data={};}
  else if(path.startsWith('/git/commits/'))data=commits.get(path.slice('/git/commits/'.length));
  else if(path.startsWith('/git/trees/'))data={tree:trees.get(path.slice('/git/trees/'.length)),truncated:false};
  else if(path.startsWith('/git/blobs/')){const content=blobs.get(path.slice('/git/blobs/'.length));data={encoding:'base64',size:Buffer.byteLength(content),content:Buffer.from(content).toString('base64')};}
  else throw Error('Unexpected '+path);
  return {data,date:'2026-11-17T01:00:00.000Z'};
 };return {api,calls,get head(){return head;},set head(x){head=x;}};
}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'official-publisher-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'ledger.json');}
test('Dedicated orphan branch stores exactly one validated ledger and no-op does not republish',async t=>{
 const path=await fixture(t),m=mock();assert.equal(await prepareLedger(path,{api:m.api}),null);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),emptyOfficialResultLedger());
 const r=await publishLedger(path,{api:m.api});assert.equal(r.commit,m.head);assert.ok(r.contentSha256);
 const writes=m.calls.filter(([,o])=>o.method==='POST').length;assert.equal((await publishLedger(path,{api:m.api})).commit,m.head);assert.equal(m.calls.filter(([,o])=>o.method==='POST').length,writes);
 const second=await fixture(t);assert.equal(await prepareLedger(second,{api:m.api}),m.head);assert.equal(await readFile(second,'utf8'),await readFile(path,'utf8'));
});
test('Concurrent ref movement fails before publication writes',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});m.head=hash(99);
 await assert.rejects(publishLedger(path,{api:m.api}),/PUBLICATION_BRANCH_MOVED/);assert.equal(m.calls.some(([,o])=>o.method==='POST'),false);
});
test('Invalid ledger never becomes published and invalid onefile tree is rejected',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});await writeFile(path,'{}');await assert.rejects(publishLedger(path,{api:m.api}),/OFFICIAL_LEDGER/);
 await writeFile(path,JSON.stringify(emptyOfficialResultLedger()));await publishLedger(path,{api:m.api});const other=await fixture(t);
 const api=async(p,o)=>{const r=await m.api(p,o);if(p.startsWith('/git/trees/'))r.data.tree.push({path:'app.js',type:'blob',mode:'100644'});return r;};
 await assert.rejects(prepareLedger(other,{api}),/PUBLICATION_BRANCH_NOT_LEDGER_ONLY/);
});
test('Exact-byte readback mismatch never advances local publication checkpoint',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});const different=JSON.stringify(emptyOfficialResultLedger());
 const api=async(p,o)=>{const r=await m.api(p,o);if(p.startsWith('/git/blobs/'))r.data={encoding:'base64',size:Buffer.byteLength(different),content:Buffer.from(different).toString('base64')};return r;};
 await assert.rejects(publishLedger(path,{api}),/PUBLICATION_READBACK_MISMATCH/);assert.equal(JSON.parse(await readFile(path+'.publication-checkpoint.json','utf8')).sha,null);
});
test('Publisher fixed GitHub host scopes token and denies unsafe workflow identities',async()=>{
 let call;const api=githubClient({token:'synthetic-private-token',fetchImpl:async(...args)=>{call=args;return new Response('secret echo should not escape',{status:403});}});
 await assert.rejects(api('/git/refs'),{message:'PUBLICATION_GITHUB_HTTP_403'});assert.equal(call[0],'https://api.github.com/repos/SpencerPhoenix/BETQ-ai/git/refs');assert.equal(call[1].redirect,'error');assert.equal(call[1].headers.Authorization,'Bearer synthetic-private-token');
 await assert.rejects(api('/../secrets'),/PUBLICATION_API_PATH_INVALID/);
 const env={GITHUB_REPOSITORY:'SpencerPhoenix/BETQ-ai',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};assert.doesNotThrow(()=>assertWorkflowIdentity(env));
 for(const patch of [{GITHUB_REPOSITORY:'foreign/repo'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'push'}])assert.throws(()=>assertWorkflowIdentity({...env,...patch}));
});
