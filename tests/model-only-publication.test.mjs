import {createHash} from 'node:crypto';
import {emptyModelLedger,ledgerEvent} from '../src/scheduled-model-ledger.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {prepareLedger,publishLedger,githubClient,assertWorkflowIdentity,BRANCH} from '../scripts/publish-model-only-ledger.mjs';
const hash=n=>String(n).padStart(40,'0');
const valid=()=>emptyModelLedger(Date.parse('2026-11-17T00:00:00.000Z'));
function appendRun(ledger,runKey){ledgerEvent(ledger,'RUN',null,{runKey,failedWeeks:[]},Date.parse('2026-11-17T00:30:00.000Z'));return ledger;}
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
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'ledger-publisher-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'ledger.json');}
test('Reserve must publish verified onefile orphan ledger before final capture and custody updates',async t=>{
 const path=await fixture(t),m=mock();assert.equal(await prepareLedger(path,{api:m.api}),null);
 const ledger=appendRun(valid(),'123.1');await writeFile(path,JSON.stringify(ledger));
 const reserved=await publishLedger(path,{api:m.api,mode:'reserve'});assert.equal(reserved.reservationCommit,m.head);
 const proof=JSON.parse(await readFile(path+'.publication-checkpoint.json','utf8'));assert.equal(proof.reservationServerDate,'2026-11-17T01:00:00.000Z');assert.equal(proof.reservationContentSha256,createHash('sha256').update(await readFile(path)).digest('hex'));
 appendRun(ledger,'123.2');await writeFile(path,JSON.stringify(ledger));
 let confirms=0;const result=await publishLedger(path,{api:m.api,mode:'final',confirm:async(p,sha,date)=>{
  confirms++;assert.equal(sha,m.head);assert.equal(date,'2026-11-17T01:00:00.000Z');
  appendRun(ledger,'123.3');await writeFile(p,JSON.stringify(ledger));
 }});
 assert.equal(confirms,1);assert.notEqual(result.captureCommit,result.custodyCommit);assert.equal(result.custodyCommit,m.head);
 const second=await fixture(t);assert.equal(await prepareLedger(second,{api:m.api}),m.head);assert.equal(await readFile(second,'utf8'),await readFile(path,'utf8'));
 assert.equal(m.calls.filter(([,o])=>o.method==='POST'&&o.body?.ref).length,1);
});
test('Concurrent branch changes fail without writes or custody acknowledgment',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});await writeFile(path,JSON.stringify(valid()));m.head=hash(99);
 await assert.rejects(publishLedger(path,{api:m.api,mode:'final',confirm:()=>assert.fail('must not confirm')}),/PUBLICATION_BRANCH_MOVED/);
 assert.equal(m.calls.some(([,o])=>o.method==='POST'),false);
});
test('Readback mismatch never confirms or updates checkpoint',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});await writeFile(path,JSON.stringify(valid()));
 const changed=JSON.stringify(appendRun(valid(),'999.1'));
 const api=async(p,o)=>{const r=await m.api(p,o);return p.startsWith('/git/blobs/')?{...r,data:{encoding:'base64',size:Buffer.byteLength(changed),content:Buffer.from(changed).toString('base64')}}:r;};
 await assert.rejects(publishLedger(path,{api,mode:'final',confirm:()=>assert.fail('must not confirm')}),/PUBLICATION_READBACK_MISMATCH/);
 assert.equal(JSON.parse(await readFile(path+'.publication-checkpoint.json','utf8')).sha,null);
});
test('Fixed API host disallows redirects and credentials never appear in URL or errors',async()=>{
 let call;const api=githubClient({token:'private-test-token',fetchImpl:async(...args)=>{call=args;return new Response('denied',{status:403});}});
 await assert.rejects(api('/git/refs'),{message:'PUBLICATION_GITHUB_HTTP_403'});
 assert.equal(call[0],'https://api.github.com/repos/SpencerPhoenix/BETQ-ai/git/refs');assert.equal(call[1].redirect,'error');assert.equal(call[1].headers.Authorization,'Bearer private-test-token');
 await assert.rejects(api('/../secrets'),/PUBLICATION_API_PATH_INVALID/);
});
test('Publisher scope blocks forks, feature branches and unreviewed events',()=>{
 const env={GITHUB_REPOSITORY:'SpencerPhoenix/BETQ-ai',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
 assert.doesNotThrow(()=>assertWorkflowIdentity(env));
 for(const delta of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_REF:'refs/heads/feature'},{GITHUB_EVENT_NAME:'push'},{GITHUB_RUN_ATTEMPT:''}])assert.throws(()=>assertWorkflowIdentity({...env,...delta}),/PUBLICATION_WORKFLOW_SCOPE_INVALID/);
});


test('Publisher rejects invalid ledger and deletion of remote history before writes',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});await writeFile(path,'{}');
 await assert.rejects(publishLedger(path,{api:m.api,mode:'reserve'}),/MODEL_LEDGER_INVALID/);
 const ledger=appendRun(valid(),'123.1');await writeFile(path,JSON.stringify(ledger));await publishLedger(path,{api:m.api,mode:'reserve'});
 const writes=m.calls.filter(([,o])=>o.method==='POST').length;await writeFile(path,JSON.stringify(valid()));
 await assert.rejects(publishLedger(path,{api:m.api,mode:'reserve'}),/MODEL_LEDGER_HISTORY_CHANGED/);
 assert.equal(m.calls.filter(([,o])=>o.method==='POST').length,writes);
});

test('settlement can publish its phase after forecast publication, but not introduce a capture-stage run',async t=>{
 const path=await fixture(t),m=mock();await prepareLedger(path,{api:m.api});
 const ledger=appendRun(valid(),'123.1');await writeFile(path,JSON.stringify(ledger));
 await assert.rejects(publishLedger(path,{api:m.api,mode:'settle'}),/PUBLICATION_SETTLEMENT_BASE_MISSING/);
 await publishLedger(path,{api:m.api,mode:'reserve'});
 await publishLedger(path,{api:m.api,mode:'final',confirm:async()=>{}});
 const captureHead=m.head;
 const at=Date.parse('2026-11-17T00:31:00.000Z');
 ledgerEvent(ledger,'RUN',null,{runKey:'123.1',failedWeeks:[],phase:'SETTLEMENT'},at);
 await writeFile(path,JSON.stringify(ledger));
 const bad=appendRun(structuredClone(ledger),'123.2');await writeFile(path,JSON.stringify(bad));
 const writes=m.calls.filter(([,o])=>o.method==='POST').length;
 await assert.rejects(publishLedger(path,{api:m.api,mode:'settle'}),/PUBLICATION_SETTLEMENT_SCOPE_INVALID/);
 assert.equal(m.calls.filter(([,o])=>o.method==='POST').length,writes);
 await writeFile(path,JSON.stringify(ledger));
 const settles=await publishLedger(path,{api:m.api,mode:'settle',confirm:()=>assert.fail('settlement never creates custody')});
 assert.notEqual(settles.settlementCommit,captureHead);assert.equal(settles.settlementCommit,m.head);
});
