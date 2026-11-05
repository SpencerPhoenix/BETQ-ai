import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {approvedContext,runOneShot,sanitizedValidationDiagnostic,BASE_SHA,BRANCH,GAME_ID} from './run.mjs';
import {NFLVERSE_SCHEDULES_URL} from './lib/settlement-only.mjs';

const root=new URL('../../',import.meta.url);
const journalText=await readFile(new URL('data/evidence/nfl-2026.json',root),'utf8');
const at=Date.parse('2026-11-04T00:00:00.000Z'),key='mock-only-never-a-real-key';
const context=()=>({approved:'true',repositorySecretConfirmed:'true',repository:'SpencerPhoenix/BETQ-ai',
  event:'workflow_dispatch',ref:BRANCH,runAttempt:'1',expectedSha:'a'.repeat(40),actualSha:'a'.repeat(40),
  currentMainSha:BASE_SHA,expiresAt:new Date(at+600000).toISOString()});
const options=()=>({context:context(),apiKey:key,journalText,clock:()=>at});
// Fabricated score bytes used only in mocks, matched to the immutable real
// journal identity for compatibility testing. Never stored as source evidence.
const csv='game_id,season,game_type,gameday,away_team,home_team,away_score,home_score,location\n'+
  GAME_ID+',2026,REG,2026-11-01,PHI,WAS,17,21,Home\n';
const payload=()=>({data:[{id:990001,season:2026,postseason:false,date:'2026-11-02T01:20:00.000Z',
  updated_at:'2026-11-02T06:00:00.000Z',status:'Final',status_state:'final',
  home_team:{id:990002,abbreviation:'WAS'},visitor_team:{id:990003,abbreviation:'PHI'},
  home_team_score:21,visitor_team_score:17}],meta:{next_cursor:null,per_page:100}});
const json=p=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json'}});
const diagnosed=async response=>{
  let calls=0;
  const report=await runOneShot({...options(),fetchImpl:async url=>{
    calls++;if(url===NFLVERSE_SCHEDULES_URL)return new Response(csv);
    return typeof response==='function'?response():response;
  }});
  assert.equal(calls,2);assert.equal(report.providerRequests,1);assert.equal(report.retries,0);
  assert.equal(report.journalWrites,0);assert.equal(report.qualifiedOutcomes,0);assert.equal(report.matched,false);
  assert.equal(report.status,'INVALID_PROVIDER_RESPONSE');
  assert.ok(!JSON.stringify(report).includes(key));assert.ok(!JSON.stringify(report).includes('::'));
  return report.validationDiagnostic;
};

test('response header diagnostics are fixed codes, never header or exception values',async()=>{
  for(const [response,reason] of [
    [new Response(key,{headers:{'content-type':'text/plain'}}),'JSON_CONTENT_TYPE_REQUIRED'],
    [new Response('x',{headers:{'content-type':'application/json','content-length':'262145'}}),'DECLARED_BODY_TOO_LARGE'],
    [{status:200,headers:new Headers({'content-type':'application/json'})},'STREAM_REQUIRED'],
    [{status:200,headers:{get(){throw Error(key+'::error::injected');}}},'HEADER_READ_FAILED']
  ])assert.deepEqual(await diagnosed(response),{httpStatus:200,stage:'RESPONSE_HEADERS',reason});
});
test('response body diagnostics preserve byte/chunk limits and redact stream errors',async()=>{
  for(const [read,reason] of [
    [async()=>({done:false,value:new Uint8Array(262145)}),'ACTUAL_BODY_TOO_LARGE'],
    [async()=>({done:false,value:new Uint8Array()}),'INVALID_OR_EXCESSIVE_CHUNKS'],
    [async()=>{throw Object.assign(Error(key),{reason:'INVALID_JSON',code:'INVALID_JSON'});},'BODY_READ_FAILED']
  ]){
    const response={status:200,headers:new Headers({'content-type':'application/json'}),
      body:{getReader:()=>({read,cancel(){},releaseLock(){}})}};
    assert.deepEqual(await diagnosed(response),{httpStatus:200,stage:'RESPONSE_BODY',reason});
  }
});
test('malformed UTF-8 has its own bounded diagnostic',async()=>{
  assert.deepEqual(await diagnosed(new Response(new Uint8Array([0xc3,0x28]),
    {headers:{'content-type':'application/json'}})),
    {httpStatus:200,stage:'UTF8_DECODING',reason:'INVALID_UTF8'});
});
test('JSON and page validation distinguish ambiguous full pages and nonterminal cursors',async()=>{
  const cases=[
    [()=>new Response(key+'::error::injected',{headers:{'content-type':'application/json'}}),'INVALID_JSON'],
    [()=>json(null),'INVALID_PAGE_DATA'],[()=>json({data:{},meta:{next_cursor:null,per_page:100}}),'INVALID_PAGE_DATA'],
    [()=>{const p=payload();delete p.meta.next_cursor;p.meta.per_page=1;return json(p);},'AMBIGUOUS_FULL_PAGE'],
    [()=>{const p=payload();p.meta.next_cursor=1;return json(p);},'NONTERMINAL_CURSOR'],
    [()=>{const p=payload();p.meta.per_page='100';return json(p);},'INVALID_PAGE_SIZE'],
    [()=>{const p=payload();p.meta.per_page=0;return json(p);},'INVALID_PAGE_SIZE']
  ];
  for(const [response,reason] of cases)
    assert.deepEqual(await diagnosed(response),{httpStatus:200,stage:'SOURCE_VALIDATION',reason});
});
test('documented omitted cursor on a short page supports only a nonqualifying cross-check',async()=>{
  for(const perPage of [2,25,100]){
    const p=payload();delete p.meta.next_cursor;p.meta.per_page=perPage;let calls=0;
    const report=await runOneShot({...options(),fetchImpl:async url=>{
      calls++;return url===NFLVERSE_SCHEDULES_URL?new Response(csv):json(p);}});
    assert.equal(calls,2);assert.equal(report.providerRequests,1);assert.equal(report.retries,0);
    assert.equal(report.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');assert.equal(report.matched,true);
    assert.equal(report.homeScore,21);assert.equal(report.awayScore,17);
    assert.equal(report.qualifiesForExistingCorroborationGate,false);assert.equal(report.sourceIndependenceVerified,false);
    assert.equal(report.qualifiedOutcomes,0);assert.equal(report.journalWrites,0);
    assert.equal(report.validationDiagnostic,undefined);
  }
});
test('missing, null, primitive or array page metadata never counts as an omitted cursor',async()=>{
  for(const meta of [undefined,null,false,1,'bad',[]]){
    const p=payload();p.meta=meta;
    assert.deepEqual(await diagnosed(json(p)),{httpStatus:200,stage:'SOURCE_VALIDATION',reason:'INVALID_PAGE_METADATA'});
  }
});
test('omitted cursor still requires own bounded integer per_page and a bounded data array',async()=>{
  for(const perPage of [undefined,null,false,'100',0,-1,1.5,101]){
    const p=payload();p.meta={per_page:perPage};
    assert.deepEqual(await diagnosed(json(p)),{httpStatus:200,stage:'SOURCE_VALIDATION',reason:'INVALID_PAGE_SIZE'});
  }
  const p=payload();delete p.meta.next_cursor;p.meta.per_page=1;p.data.push({...p.data[0],id:990004});
  assert.equal((await diagnosed(json(p))).reason,'INVALID_PAGE_SIZE');
  p.data=Array.from({length:101},(_,i)=>({...p.data[0],id:i+1}));p.meta.per_page=100;
  assert.equal((await diagnosed(json(p))).reason,'INVALID_PAGE_DATA');
});
test('any present nonnull cursor remains rejected even on an empty or short page',async()=>{
  for(const cursor of [1,0,-1,1.5,'1','',false,true,{},[]])for(const empty of [false,true]){
    const p=payload();p.meta.next_cursor=cursor;if(empty)p.data=[];
    assert.deepEqual(await diagnosed(json(p)),{httpStatus:200,stage:'SOURCE_VALIDATION',reason:'NONTERMINAL_CURSOR'});
  }
});
test('empty short pages are no-match and full pages without a cursor are ambiguous',async()=>{
  const empty=payload();empty.data=[];delete empty.meta.next_cursor;
  const report=await runOneShot({...options(),fetchImpl:async url=>url===NFLVERSE_SCHEDULES_URL?new Response(csv):json(empty)});
  assert.equal(report.status,'NO_CROSS_CHECK_MATCH');assert.equal(report.matched,false);
  assert.equal(report.reason,'NO_PROVIDER_GAME_MATCH');assert.equal(report.qualifiedOutcomes,0);
  for(const size of [1,25,100]){
    const p=payload();p.meta={per_page:size};
    p.data=Array.from({length:size},(_,i)=>({...p.data[0],id:i+1,season:i===0?2026:2025}));
    assert.equal((await diagnosed(json(p))).reason,'AMBIGUOUS_FULL_PAGE');
  }
});
test('largest admitted omitted-cursor short page remains bounded and uses the untouched response',async()=>{
  const p=payload();delete p.meta.next_cursor;
  p.data=Array.from({length:99},(_,i)=>({...p.data[0],id:i+1,season:i===0?2026:2025}));
  const report=await runOneShot({...options(),fetchImpl:async url=>url===NFLVERSE_SCHEDULES_URL?new Response(csv):json(p)});
  assert.equal(report.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');assert.equal(report.providerRequests,1);
  assert.equal(report.qualifiedOutcomes,0);assert.equal(report.journalWrites,0);
});
test('explicit null retains prior full-page support but cannot bypass metadata validation',async()=>{
  const p=payload();p.meta.per_page=1;
  const report=await runOneShot({...options(),fetchImpl:async url=>url===NFLVERSE_SCHEDULES_URL?new Response(csv):json(p)});
  assert.equal(report.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');assert.equal(report.qualifiedOutcomes,0);
  p.meta.per_page=0;assert.equal((await diagnosed(json(p))).reason,'INVALID_PAGE_SIZE');
});
test('omitted cursor never bypasses identity, duplicate, kickoff, finality, score or update checks',async()=>{
  const cases=[
    [p=>{p.data[0].home_team.abbreviation='UNKNOWN';},'INVALID_PROVIDER_RESPONSE','INVALID_GAME_IDENTITY'],
    [p=>{p.data.push(structuredClone(p.data[0]));},'INVALID_PROVIDER_RESPONSE','DUPLICATE_GAME_ID'],
    [p=>{p.data[0].date='2026-11-02T02:20:00.000Z';},'NO_CROSS_CHECK_MATCH','KICKOFF_OR_RECEIPT_MISMATCH'],
    [p=>{p.data[0].postseason=true;},'NO_CROSS_CHECK_MATCH','SEASON_PHASE_MISMATCH'],
    [p=>{p.data[0].status_state='in_progress';},'NO_CROSS_CHECK_MATCH','EXPLICIT_CONSISTENT_FINAL_REQUIRED'],
    [p=>{p.data[0].home_team_score=22;},'NO_CROSS_CHECK_MATCH','FINAL_SCORE_MISMATCH'],
    [p=>{p.data[0].updated_at='2026-11-05T00:00:00.000Z';},'NO_CROSS_CHECK_MATCH','INVALID_PROVIDER_RECORD_TIME']
  ];
  for(const [change,status,reason] of cases){const p=payload();delete p.meta.next_cursor;change(p);let calls=0;
    const report=await runOneShot({...options(),fetchImpl:async url=>{calls++;return url===NFLVERSE_SCHEDULES_URL?new Response(csv):json(p);}});
    assert.equal(calls,2);assert.equal(report.providerRequests,1);assert.equal(report.retries,0);
    assert.equal(report.status,status);assert.equal(report.reason??report.validationDiagnostic?.reason,reason);
    assert.equal(report.matched,false);assert.equal(report.qualifiedOutcomes,0);assert.equal(report.journalWrites,0);
  }
});
test('provider identity diagnostics remain distinct and fail closed',async()=>{
  const cases=[
    [p=>{p.data[0].id='990001';},'INVALID_GAME_ID'],
    [p=>{p.data.push(structuredClone(p.data[0]));},'DUPLICATE_GAME_ID'],
    [p=>{p.data[0].home_team.abbreviation='UNKNOWN';},'INVALID_GAME_IDENTITY'],
    [p=>{const other=structuredClone(p.data[0]);other.id++;other.home_team.abbreviation='NYG';p.data.push(other);},'CONFLICTING_TEAM_IDENTITY']
  ];
  for(const [change,reason] of cases){const p=payload();change(p);
    assert.deepEqual(await diagnosed(json(p)),{httpStatus:200,stage:'SOURCE_VALIDATION',reason});}
});
test('diagnostic output allowlist drops unknown/mismatched fields and copies no extra data',()=>{
  const safe={httpStatus:200,stage:'SOURCE_VALIDATION',reason:'INVALID_JSON'};
  assert.deepEqual(sanitizedValidationDiagnostic({...safe,body:key,error:key,headers:{Authorization:key}}),safe);
  for(const value of [null,{}, {...safe,httpStatus:401},{...safe,stage:key},{...safe,reason:key},
    {...safe,stage:'toString'},{...safe,stage:'RESPONSE_BODY'},{...safe,reason:'INVALID_JSON\n::error::injected'}])
    assert.equal(sanitizedValidationDiagnostic(value),null);
});
test('non-200 responses never claim successful HTTP validation or emit body diagnostics',async()=>{
  for(const status of [401,403,429,500]){
    const report=await runOneShot({...options(),fetchImpl:async url=>url===NFLVERSE_SCHEDULES_URL?
      new Response(csv):new Response(key,{status})});
    assert.equal(report.providerRequests,1);assert.equal(report.validationDiagnostic,undefined);
    assert.ok(!JSON.stringify(report).includes(key));
  }
});

test('every missing or mismatched approval/context property prevents all requests',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('NO_NETWORK');};
  const changes=[{approved:'false'},{repositorySecretConfirmed:'false'},{repository:'other/repo'},
    {event:'push'},{ref:'refs/heads/main'},{runAttempt:'2'},{runnerDebug:'1'},
    {expectedSha:'not-a-sha'},{actualSha:'b'.repeat(40)},{currentMainSha:'b'.repeat(40)},
    {expiresAt:new Date(at).toISOString()},{expiresAt:new Date(at+16*60000).toISOString()},
    {expiresAt:'2026-11-04T00:10:00Z'}];
  for(const change of changes){
    const o=options();Object.assign(o.context,change);
    assert.equal((await runOneShot({...o,fetchImpl})).status,'NOT_APPROVED');
  }
  assert.equal((await runOneShot({fetchImpl})).status,'NOT_APPROVED');assert.equal(calls,0);
});
test('missing key, malformed key and changed real journal stop before all network',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('NO_NETWORK');};
  for(const [change,status] of [[{apiKey:''},'CREDENTIAL_REQUIRED'],[{apiKey:'bad\nkey'},'INVALID_CREDENTIAL_FORMAT'],
    [{journalText:journalText+' '},'INVALID_PINNED_INPUT']])
    assert.equal((await runOneShot({...options(),...change,fetchImpl})).status,status);
  assert.equal(calls,0);
});
test('real pinned journal is compatible and key goes solely to one fixed BALLDONTLIE request',async()=>{
  const seen=[];const before=journalText;
  const report=await runOneShot({...options(),fetchImpl:async(url,init)=>{
    seen.push(url);
    if(url===NFLVERSE_SCHEDULES_URL){assert.deepEqual(init.headers,{Accept:'text/csv'});
      assert.equal(init.redirect,'manual');return new Response(csv);}
    const u=new URL(url);assert.equal(u.origin,'https://api.balldontlie.io');assert.equal(u.pathname,'/nfl/v1/games');
    assert.equal(init.headers.Authorization,key);assert.equal(init.redirect,'error');
    assert.deepEqual(u.searchParams.getAll('dates[]'),['2026-11-01','2026-11-02']);
    return json(payload());
  }});
  assert.equal(seen.length,2);assert.equal(report.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');
  assert.equal(report.publicScheduleRequests,1);assert.equal(report.providerRequests,1);
  assert.equal(report.homeScore,21);assert.equal(report.awayScore,17);assert.equal(report.journalWrites,0);
  assert.equal(report.qualifiedOutcomes,0);assert.equal(report.sourceIndependenceVerified,false);
  assert.equal(report.publicationAuthorized,false);assert.equal(journalText,before);
  assert.ok(!JSON.stringify(report).includes(key));assert.ok(!JSON.stringify(report).includes('updated_at'));
});
test('one public GitHub asset redirect is allowed without sending any credential',async()=>{
  const asset='https://release-assets.githubusercontent.com/test/signed.csv?test=public';let calls=0;
  const report=await runOneShot({...options(),fetchImpl:async(url,init)=>{
    calls++;
    if(url===NFLVERSE_SCHEDULES_URL){assert.ok(!init.headers.Authorization);
      return new Response(null,{status:302,headers:{location:asset}});}
    if(url===asset){assert.deepEqual(init.headers,{Accept:'text/csv'});return new Response(csv);}
    assert.equal(init.headers.Authorization,key);return json(payload());
  }});
  assert.equal(report.providerRequests,1);assert.equal(report.publicScheduleRequests,2);assert.equal(calls,3);
});
test('unexpected public redirects, redirect chains and unexpected origin fail before key use',async()=>{
  for(const location of ['https://attacker.example/','http://release-assets.githubusercontent.com/x',
    'https://user:pass@release-assets.githubusercontent.com/x','https://release-assets.githubusercontent.com:444/x']){
    let calls=0;const report=await runOneShot({...options(),fetchImpl:async(url,init)=>{
      calls++;assert.ok(!init.headers.Authorization);return new Response(null,{status:302,headers:{location}});}});
    assert.equal(calls,1);assert.equal(report.providerRequests,0);assert.equal(report.status,'PUBLIC_SOURCE_UNAVAILABLE');
  }
  let calls=0;const report=await runOneShot({...options(),fetchImpl:async()=>{calls++;
    return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/x'}});}});
  assert.equal(calls,2);assert.equal(report.providerRequests,0);
  const origin=await runOneShot({...options(),fetchImpl:async()=>({status:200,redirected:true})});
  assert.equal(origin.status,'PUBLIC_SOURCE_UNAVAILABLE');
});
test('public-source HTTP, size, UTF-8, CSV and stream failures spend no provider request',async()=>{
  const cases=[new Response(key,{status:500}),new Response('x',{headers:{'content-length':'12000001'}}),
    new Response(new Uint8Array([0xc3,0x28])),new Response('not a schedule'),
    {status:200,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array()}),cancel(){},releaseLock(){}})}}];
  for(const response of cases){let calls=0;const report=await runOneShot({...options(),fetchImpl:async()=>{calls++;return response;}});
    assert.equal(calls,1);assert.equal(report.providerRequests,0);assert.ok(!JSON.stringify(report).includes(key));}
});
test('expired approval and backwards clock after public source prevent credential transmission',async()=>{
  for(const second of [at-1,at+700000]){let clocks=0,calls=0;
    const report=await runOneShot({...options(),clock:()=>clocks++?second:at,fetchImpl:async()=>{calls++;return new Response(csv);}});
    assert.equal(report.status,'APPROVAL_EXPIRED');assert.equal(report.providerRequests,0);assert.equal(calls,1);}
});
test('provider failures, body injection and kickoff changes are sanitized and never retried',async()=>{
  for(const mode of ['401','429','body','throw','kickoff']){let calls=0;
    const report=await runOneShot({...options(),fetchImpl:async(url)=>{
      calls++;if(url===NFLVERSE_SCHEDULES_URL)return new Response(csv);
      if(mode==='throw')throw Error(key+'::error::injected');
      if(mode==='body')return new Response(key+'::error::injected',{headers:{'content-type':'application/json'}});
      if(mode==='kickoff'){const p=payload();p.data[0].date='2026-11-02T02:20:00.000Z';return json(p);}
      return new Response(key,{status:Number(mode)});
    }});
    assert.equal(calls,2);assert.equal(report.providerRequests,1);assert.equal(report.retries,0);
    assert.equal(report.qualifiedOutcomes,0);assert.ok(!JSON.stringify(report).includes(key));
    assert.ok(!JSON.stringify(report).includes('::'));assert.equal(report.matched,false);
    if(mode==='kickoff')assert.equal(report.reason,'KICKOFF_OR_RECEIPT_MISMATCH');
  }
});
test('offline integrity verifier checks the reviewed snapshot and actual main journal',()=>{
  const out=spawnSync(process.execPath,['scripts/one-shot-balldontlie/verify.mjs'],{cwd:fileURLToPath(root),encoding:'utf8'});
  assert.equal(out.status,0,out.stderr);assert.match(out.stdout,/PASS/);
});
test('CLI is denied by default, accepts no arguments and never echoes environment key',()=>{
  for(const args of [[],['--run']]){
    const out=spawnSync(process.execPath,['scripts/one-shot-balldontlie/run.mjs',...args],
      {cwd:fileURLToPath(root),encoding:'utf8',env:{PATH:process.env.PATH,BDL_ONE_SHOT_API_KEY:key}});
    assert.equal(out.status,1);assert.ok(!out.stdout.includes(key));assert.ok(!out.stderr.includes(key));
    assert.equal(JSON.parse(out.stdout).providerRequests,0);
  }
});
test('workflow is manual-only, least privilege, secret scoped solely to final read and no artifacts',async()=>{
  const workflow=await readFile(new URL('.github/workflows/live-probe.yml',root),'utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n\s*(?:push|pull_request|schedule|workflow_run):/);
  assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/github\.run_attempt == 1/);assert.match(workflow,/github\.ref == 'refs\/heads\/fix\/one-shot-pagination-20261105'/);
  assert.equal((workflow.match(/secrets\./g)??[]).length,1);assert.match(workflow,/secrets\.BALLDONTLIE_API_KEY/);
  assert.doesNotMatch(workflow,/secrets\[|upload-artifact|npm (?:ci|install)|git push|api\/slate|mode=live|contents: write/);
  assert.equal((workflow.match(/default: false/g)??[]).length,2);
  assert.match(workflow,/ref: \$\{\{ github.sha \}\}/);assert.ok(workflow.indexOf('npm test')<workflow.indexOf('secrets.BALLDONTLIE_API_KEY'));
  for(const line of workflow.split('\n').filter(l=>l.includes('uses:')))
    assert.match(line,/@[a-f0-9]{40} /);
});
test('entrypoint has no write/log facilities and vendor hashes identify exact reviewed files',async()=>{
  const code=await readFile(new URL('./run.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/console\.|writeFile|appendFile|createWriteStream|process\.env\.[A-Z_]*(?:ODDS|TOKEN)/);
  const manifest=JSON.parse(await readFile(new URL('./reviewed-source.json',import.meta.url),'utf8'));
  assert.equal(manifest.sourceCommit,'0ccfec250206c871151a2db5520b8fbc5ea5cd0b');
  assert.equal(Object.keys(manifest.files).length,7);
  assert.deepEqual(Object.keys(manifest.localModifications).sort(),
    ['lib/balldontlie-crosscheck.mjs','lib/balldontlie-live-reader.mjs']);
  for(const [file,origin] of Object.entries(manifest.localModifications)){
    assert.match(origin.sourceSha256,/^[a-f0-9]{64}$/);assert.notEqual(origin.sourceSha256,manifest.files[file]);
    assert.equal(origin.purpose,file==='lib/balldontlie-crosscheck.mjs'?
      'Allowlisted diagnostics and documented omitted cursor on validated short pages':
      'Allowlisted validation diagnostics only; acceptance rules unchanged');
  }
});
