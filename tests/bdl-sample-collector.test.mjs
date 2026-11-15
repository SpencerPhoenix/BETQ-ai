import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBdlOutcomeSample,BDL_PROVIDER_LIST_STATES} from '../src/bdl-sample-collector.mjs';
import {syntheticBdlOutcomeInput} from './fixtures/bdl-outcome-candidate.mjs';
const KEY='synthetic-secret-DO-NOT-LEAK';
const encode=x=>new TextEncoder().encode(typeof x==='string'?x:JSON.stringify(x));
function setup(){
 const input=syntheticBdlOutcomeInput(),event=JSON.parse(new TextDecoder().decode(input.bdlBytes)).data;
 let time=Date.parse(input.evaluatedAt);const calls=[];
 const responses=[()=>new Response(input.nflverseBytes),()=>new Response(JSON.stringify({data:[event],meta:{per_page:100,next_cursor:null}})),()=>new Response(input.bdlBytes)];
 const run=options=>collectBdlOutcomeSample({journal:input.journal,gameId:input.gameId,apiKey:KEY},{clock:()=>time,fetchImpl:async(url,opts)=>{calls.push({url,opts});return responses.shift()();},...options});
 return {input,event,calls,responses,run,setTime:n=>{time=n;}};
}
test('bounded synthetic success preserves exact bytes and remains nonqualifying',async()=>{
 const f=setup(),result=await f.run();assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.diagnostics.bdlRequests,2);assert.equal(result.diagnostics.publicRequests,1);
 assert.equal(result.privateBundle.ledger.entries.length,1);assert.equal(result.privateBundle.summary.scoringEligible,false);
 assert.equal(result.privateBundle.mappingList.sha256.length,64);assert.equal(result.privateBundle.mappingList.retrievedAt,f.input.evaluatedAt);
 assert.equal(result.privateBundle.ledger.archives.some(a=>a.bodyBase64===Buffer.from(f.input.bdlBytes).toString('base64')),true);
 assert.equal(JSON.stringify(result).includes(KEY),false);
 for(const {url,opts} of f.calls){assert.equal(url.includes(KEY),false);assert.equal(opts.credentials,'omit');
   assert.equal(opts.headers.Authorization,url.startsWith('https://api.balldontlie.io/')?KEY:undefined);}
 assert.equal(f.calls[1].opts.redirect,'error');
});
test('invalid inputs and too-early/future journal fail with zero requests',async()=>{
 for(const mutate of [f=>{f.input.gameId='bad';},f=>{f.input.journal=null;},f=>{f.setTime(Date.parse('2026-11-08T19:00:00.000Z'));},f=>{f.input.journal.snapshots[0].commenceTime='garbage';}]){
 const f=setup();mutate(f);const result=await f.run();assert.equal(result.ok,false);assert.equal(f.calls.length,0);}
});
test('invalid credential and dependencies make zero calls',async()=>{
 const f=setup();for(const apiKey of ['',KEY+'\n',null]){const r=await collectBdlOutcomeSample({...f.input,apiKey},{clock:()=>Date.parse(f.input.evaluatedAt),fetchImpl:()=>{throw Error('called');}});assert.equal(r.error,'INVALID_INPUT');}
 assert.equal((await f.run({timeoutMs:30001})).error,'INVALID_DEPENDENCIES');assert.equal(f.calls.length,0);
});
test('public-only redirects have bounded count and no auth',async()=>{
 const f=setup();f.responses.unshift(()=>new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/path?sig=PRIVATE'}}));
 const r=await f.run();assert.equal(r.ok,true);assert.equal(r.diagnostics.publicRequests,2);assert.equal(f.calls[1].opts.headers.Authorization,undefined);assert.equal(JSON.stringify(r).includes('PRIVATE&'),false);
});
test('public redirect disallowed destinations and loops do not reach BDL',async()=>{
 for(const target of ['https://attacker.test/a','http://github.com/a','https://user:pass@github.com/a','https://github.com:8443/a','https://github.com/a#fragment']){
 const f=setup();f.responses[0]=()=>new Response(null,{status:302,headers:{location:target}});assert.equal((await f.run()).error,'PUBLIC_REDIRECT_REJECTED');assert.equal(f.calls.length,1);}
 const f=setup();f.responses.splice(0,3,...Array.from({length:3},()=>()=>new Response(null,{status:302,headers:{location:'https://github.com/a'}})));
 assert.equal((await f.run()).error,'PUBLIC_REDIRECT_REJECTED');assert.equal(f.calls.length,3);
});
test('authenticated redirects are rejected without forwarding credentials',async()=>{
 const f=setup();f.responses[1]=()=>new Response(null,{status:302,headers:{location:'https://attacker.test'}});
 const r=await f.run();assert.equal(r.error,'PROVIDER_REDIRECT_REJECTED');assert.equal(f.calls.length,2);
});
test('non-200 error content and fetch exceptions never leak',async()=>{
 for(const response of [()=>new Response(KEY,{status:401}),()=>{throw Error(KEY); }]){
 const f=setup();f.responses[1]=response;const r=await f.run();assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes(KEY),false);assert.equal(f.calls.length,2);}
});
test('oversize, incomplete, empty and broken streams fail before BDL',async()=>{
 for(const response of [()=>new Response(new Uint8Array(4000001)),()=>new Response('abc',{headers:{'content-length':'4'}}),()=>new Response(''),()=>new Response('x',{headers:{'content-length':'4000001'}}),()=>new Response(new ReadableStream({start(c){c.enqueue(encode('x'));c.error(Error(KEY));}}))]){
 const f=setup();f.responses[0]=response;const r=await f.run();assert.equal(r.ok,false);assert.equal(f.calls.length,1);assert.equal(JSON.stringify(r).includes(KEY),false);}
});
test('body and fetch timeouts remain bounded, with no further calls',async()=>{
 for(const response of [()=>new Promise(()=>{}),()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});}}))]){
 const f=setup();f.responses[0]=response;const r=await f.run({timeoutMs:5});assert.equal(r.error,'SOURCE_TIMEOUT');assert.equal(f.calls.length,1);}
});
test('malformed, duplicate-key and paginated mapping lists rejected without detail call',async()=>{
 for(const body of ['{','{"data":[],"d\\u0061ta":[],"meta":{}}',JSON.stringify({data:[],meta:{next_cursor:1,per_page:100}}),JSON.stringify({data:Array(101).fill({id:1}),meta:{next_cursor:null,per_page:100}})]){
 const f=setup();f.responses[1]=()=>new Response(body);const r=await f.run();assert.equal(r.ok,false);assert.equal(f.calls.length,2);}
});
test('ambiguous mapping, native identity and kickoff mismatch rejected',async()=>{
 for(const change of [e=>{e.id=0;},e=>{e.date='2026-11-08T18:05:00.000Z';},e=>{e.home_team.abbreviation='BUF';},e=>{e.season=2025;}]){
 const f=setup();change(f.event);const r=await f.run();assert.equal(r.ok,false);assert.equal(f.calls.length,2);}
 const f=setup();f.responses[1]=()=>new Response(JSON.stringify({data:[f.event,f.event],meta:{per_page:100,next_cursor:null}}));assert.equal((await f.run()).error,'AMBIGUOUS_PROVIDER_MAPPING');
});
test('single response mismatch and duplicate keys fail closed',async()=>{
 for(const response of [e=>JSON.stringify({data:{...e,id:e.id+1}}),e=>JSON.stringify({data:{...e,home_team_score:99}}),e=>JSON.stringify({data:e,meta:{}}),e=>'{"data":'+JSON.stringify(e)+',"data":'+JSON.stringify(e)+'}']){
 const f=setup();f.responses[2]=()=>new Response(response(f.event));const r=await f.run();assert.equal(r.ok,false);assert.equal(f.calls.length,3);}
});
test('community score mismatch cannot create receipt',async()=>{
 const f=setup();f.responses[0]=()=>new Response(new TextDecoder().decode(f.input.nflverseBytes).replace(',27,17,',',26,17,'));
 const r=await f.run();assert.equal(r.error,'CANDIDATE_REJECTED');assert.equal(r.privateBundle,undefined);
});
test('timestamps taken after await; stale and backward clocks rejected',async()=>{
 const f=setup();const body=f.responses[2];f.responses[2]=()=>{f.setTime(Date.parse(f.input.evaluatedAt)+3600001);return body();};assert.equal((await f.run()).error,'SAMPLE_WINDOW_EXCEEDED');
 const g=setup();g.responses[0]=()=>{g.setTime(0);return new Response(g.input.nflverseBytes);};assert.equal((await g.run()).error,'INVALID_OBSERVATION_CLOCK');assert.equal(g.calls.length,1);
});
test('immutable kickoff quarantine and provider identity conflicts are zero-call failures',async()=>{
 for(const modify of [f=>f.input.journal.snapshots.push({...f.input.journal.snapshots[0],id:'conflict',commenceTime:'2026-11-08T18:05:00.000Z'}),f=>{delete f.input.journal.snapshots[0].providerEventId;},f=>{f.input.journal.snapshots[0].gameDate='2026-11-07';}]){
 const f=setup();modify(f);const original=JSON.stringify(f.input.journal);const r=await f.run();assert.equal(r.ok,false);assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.input.journal),original);}
});
test('oversized/deep provider JSON and key echoes cannot create private output',async()=>{
 for(const body of [new Uint8Array(262145),'{"data":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}',JSON.stringify({secret:KEY})]){
 const f=setup();f.responses[1]=()=>new Response(body);const r=await f.run();assert.equal(r.ok,false);assert.equal(r.privateBundle,undefined);assert.equal(f.calls.length,2);assert.equal(JSON.stringify(r).includes(KEY),false);}
});
test('timeout late resolution cannot advance requests or change returned counts',async()=>{
 const f=setup();let release;f.responses[0]=()=>new Promise(resolve=>{release=resolve;});
 const r=await f.run({timeoutMs:5});assert.equal(r.error,'SOURCE_TIMEOUT');release(new Response(f.input.nflverseBytes));
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.calls.length,1);assert.equal(r.diagnostics.publicRequests,1);assert.equal(r.diagnostics.bdlRequests,0);
});
test('public response after observation window cannot spend provider requests',async()=>{
 const f=setup();f.responses[0]=()=>{f.setTime(Date.parse(f.input.evaluatedAt)+3600001);return new Response(f.input.nflverseBytes);};
 const r=await f.run();assert.equal(r.error,'SAMPLE_WINDOW_EXCEEDED');assert.equal(f.calls.length,1);
});
test('source hash is over original exact mapping bytes and journal is captured before await',async()=>{
 const f=setup();const raw=' {"data":'+JSON.stringify([f.event])+',"meta":{"per_page":100,"next_cursor":null}}\n';
 f.responses[1]=()=>new Response(raw);const base=f.responses[0];f.responses[0]=()=>{f.input.journal.provenance.changedDuringFetch=true;return base();};
 const r=await f.run();assert.equal(r.ok,true);assert.equal(r.privateBundle.mappingList.base64,Buffer.from(raw).toString('base64'));
 assert.equal(r.privateBundle.journal.provenance.changedDuringFetch,undefined);
});
test('decoded gzip bytes are capped but not compared with encoded content length',async()=>{
 const f=setup();f.responses[0]=()=>new Response(f.input.nflverseBytes,{headers:{'content-encoding':'gzip','content-length':'24'}});
 const r=await f.run();assert.equal(r.ok,true);assert.equal(f.calls[0].opts.headers['Accept-Encoding'],'identity');
 const g=setup();g.responses[0]=()=>new Response(new Uint8Array(4000001),{headers:{'content-encoding':'gzip','content-length':'24'}});
 assert.equal((await g.run()).error,'SOURCE_TOO_LARGE');
});
test('optional cursor accepted only for a strictly short valid page',async()=>{
 for(const meta of [{per_page:100},{per_page:2},{per_page:1,next_cursor:null},{per_page:100,next_cursor:null}]){
  const f=setup();f.responses[1]=()=>new Response(JSON.stringify({data:[f.event],meta}));
  const r=await f.run();assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.calls.length,3);
  assert.equal(r.diagnostics.bdlRequests,2);assert.equal(r.diagnostics.providerListState,Object.hasOwn(meta,'next_cursor')?'COMPLETE_EXPLICIT_NULL':'COMPLETE_SHORT_PAGE_CURSOR_OMITTED');
 }
});
test('provider list enum separates invalid shapes, bounds, continuation and ambiguity',async()=>{
 const cases=[
  [null,'INVALID_SHAPE'],[[],'INVALID_SHAPE'],[{},'INVALID_SHAPE'],
  [{data:[],meta:null},'INVALID_SHAPE'],[{data:[],meta:[]},'INVALID_SHAPE'],
  [{data:{},meta:{per_page:100}},'INVALID_SHAPE'],
  ...[undefined,null,'100',0,-1,101,1.5,true].map(per_page=>[{data:[],meta:{per_page}},'INVALID_PAGE']),
  [{data:[{},{}],meta:{per_page:1,next_cursor:null}},'INVALID_PAGE'],
  [{data:Array(101).fill({}),meta:{per_page:100,next_cursor:null}},'INVALID_PAGE'],
  ...[0,1,'',false,{},[]].map(next_cursor=>[{data:[],meta:{per_page:100,next_cursor}},'CONTINUATION_PRESENT']),
  [{data:[{}],meta:{per_page:1}},'AMBIGUOUS_FULL_PAGE']
 ];
 for(const [payload,state] of cases){
  const f=setup();f.responses[1]=()=>new Response(JSON.stringify(payload));const r=await f.run();
  assert.equal(r.ok,false);assert.equal(r.error,'INCOMPLETE_PROVIDER_LIST');assert.equal(r.diagnostics.providerListState,state);
  assert.equal(f.calls.length,2);assert.equal(r.diagnostics.bdlRequests,1);assert.equal(r.privateBundle,undefined);
 }
});
test('complete empty pages still fail mapping, without another provider request',async()=>{
 for(const meta of [{per_page:100},{per_page:1,next_cursor:null}]){
  const f=setup();f.responses[1]=()=>new Response(JSON.stringify({data:[],meta}));const r=await f.run();
  assert.equal(r.error,'PROVIDER_MAPPING_MISMATCH');assert.match(r.diagnostics.providerListState,/^COMPLETE_/);assert.equal(f.calls.length,2);
 }
});
test('list diagnostic is allowlisted and never includes raw malformed payload values',async()=>{
 assert.equal(Object.isFrozen(BDL_PROVIDER_LIST_STATES),true);
 for(const [body,state] of [['{"private":"secret-raw-value",','INVALID_JSON'],['{"data":[],"data":[],"meta":{}}','INVALID_JSON'],[JSON.stringify({data:[],meta:{per_page:100,next_cursor:'secret-raw-value'}}),'CONTINUATION_PRESENT']]){
  const f=setup();f.responses[1]=()=>new Response(body);const r=await f.run();assert.equal(r.ok,false);
  assert.equal(r.diagnostics.providerListState,state);assert.equal(BDL_PROVIDER_LIST_STATES.includes(state),true);
  assert.equal(JSON.stringify(r).includes('secret-raw-value'),false);assert.equal(JSON.stringify(r).includes(KEY),false);
 }
 const f=setup();f.input.gameId='bad';const r=await f.run();assert.equal(r.diagnostics.providerListState,'NOT_OBSERVED');assert.equal(f.calls.length,0);
});
