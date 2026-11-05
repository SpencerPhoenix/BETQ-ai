import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readLiveBallDontLieFinal} from './lib/balldontlie-live-reader.mjs';
import {isAttestedFinal,isCorroboratedSettlement,selectFinalizedResults} from './lib/settlement-only.mjs';
import {parseCsv} from './lib/nfl-elo.mjs';

// These bytes and the token below are fabricated test inputs, never credentials
// or recorded API responses. Every enabled test supplies its own mock transport.
const template=JSON.parse(await readFile(new URL('./fixtures/synthetic-nfl-v1.json',import.meta.url),'utf8'));
const testKey='mock-only-not-a-real-credential';
const opts=()=>({enabled:true,apiKey:testKey,gameId:template.journal.snapshots[0].gameId,
  journal:structuredClone(template.journal),nflverseCsv:template.nflverseCsv,
  nflverseObservedAt:template.nflverseObservedAt,clock:()=>Date.parse(template.evaluatedAt)});
const jsonResponse=(text=template.balldontlieJson,options={})=>new Response(text,
  {status:200,headers:{'content-type':'application/json'},...options});
const changedResponse=change=>{const p=JSON.parse(template.balldontlieJson);change(p.data[0],p);return jsonResponse(JSON.stringify(p));};

test('default-off, missing/invalid key and invalid configuration stop before any request',async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error('MUST_NOT_FETCH');};
  assert.equal((await readLiveBallDontLieFinal({fetchImpl})).status,'DISABLED');
  assert.equal((await readLiveBallDontLieFinal({...opts(),apiKey:undefined,fetchImpl})).status,'CREDENTIAL_REQUIRED');
  for(const apiKey of ['\nsecret','secret token','x'.repeat(513)])
    assert.equal((await readLiveBallDontLieFinal({...opts(),apiKey,fetchImpl})).status,'INVALID_CREDENTIAL_FORMAT');
  for(const change of [{enabled:'true'},{timeoutMs:9},{timeoutMs:8001},{clock:null}])
    assert.equal((await readLiveBallDontLieFinal({...opts(),...change,fetchImpl})).status,'INVALID_CONFIGURATION');
  assert.equal(calls,0);
});
test('eligible input makes exactly one fixed GET with header-only key, no redirects and no pagination',async()=>{
  let calls=0;const input=opts(),before=JSON.stringify(input.journal);
  const result=await readLiveBallDontLieFinal({...input,fetchImpl:async(url,config)=>{
    calls++;const u=new URL(url);assert.equal(u.origin,'https://api.balldontlie.io');
    assert.equal(u.pathname,'/nfl/v1/games');assert.equal(u.searchParams.get('per_page'),'100');
    assert.deepEqual(u.searchParams.getAll('dates[]'),['2026-11-02','2026-11-03']);
    assert.deepEqual(u.searchParams.getAll('seasons[]'),['2026']);assert.deepEqual(u.searchParams.getAll('season_types[]'),['2']);
    assert.equal(config.method,'GET');assert.equal(config.redirect,'error');assert.equal(config.headers.Authorization,testKey);
    assert.equal(config.signal.aborted,false);assert.ok(!url.includes(testKey));return jsonResponse();
  }});
  assert.equal(calls,1);assert.equal(result.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');
  assert.equal(result.providerRequests,1);assert.equal(result.filesWritten,0);assert.equal(result.retries,0);
  assert.equal(result.crossCheckedGames,1);assert.equal(result.qualifiedOutcomes,0);
  assert.equal(result.crossChecks[0].sourceIndependenceVerified,false);
  assert.equal(result.crossChecks[0].qualifiesForExistingCorroborationGate,false);
  assert.equal(result.crossChecks[0].sourceReceipts.balldontlie.sha256,
    createHash('sha256').update(template.balldontlieJson).digest('hex'));
  assert.equal(JSON.stringify(input.journal),before);assert.ok(!JSON.stringify(result).includes(testKey));
});
test('untracked games, invalid frozen identity, stale primary receipts and malformed CSV make zero requests',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return jsonResponse();};
  const cases=[{gameId:'untracked'},{nflverseObservedAt:'2026-11-01T00:00:00.000Z'},
    {nflverseCsv:'not CSV'},{clock:()=>NaN}];
  const invalid=structuredClone(template.journal);invalid.snapshots[0].gameDate='2025-01-01';cases.push({journal:invalid});
  for(const change of cases)assert.equal((await readLiveBallDontLieFinal({...opts(),...change,fetchImpl})).status,'INVALID_LOCAL_INPUT');
  const duplicate=template.nflverseCsv+template.nflverseCsv.split('\n')[1]+'\n';
  assert.equal((await readLiveBallDontLieFinal({...opts(),nflverseCsv:duplicate,fetchImpl})).status,'INVALID_LOCAL_INPUT');
  assert.equal(calls,0);
});
test('a game without eligible delayed community scores does not spend a provider request',async()=>{
  let calls=0;const r=await readLiveBallDontLieFinal({...opts(),nflverseCsv:template.nflverseCsv.replace(',34,17,',',,,') ,
    fetchImpl:async()=>{calls++;return jsonResponse();}});
  assert.equal(r.status,'NO_ELIGIBLE_FINAL_CANDIDATE');assert.equal(calls,0);
});
test('kickoff mismatch is reported without rewriting the frozen input or qualifying any result',async()=>{
  const input=opts(),before=JSON.stringify(input.journal);
  const r=await readLiveBallDontLieFinal({...input,fetchImpl:async()=>changedResponse(e=>{e.date='2026-11-03T02:20:00.000Z';})});
  assert.equal(r.status,'NO_CROSS_CHECK_MATCH');assert.equal(r.crossCheckedGames,0);
  assert.equal(r.rejected[0].reason,'KICKOFF_OR_RECEIPT_MISMATCH');assert.equal(JSON.stringify(input.journal),before);
});
test('caller mutation while request is pending cannot change the frozen matching inputs',async()=>{
  const input=opts();const r=await readLiveBallDontLieFinal({...input,fetchImpl:async()=>{
    input.journal.snapshots[0].commenceTime='2026-11-03T02:20:00.000Z';
    return jsonResponse();
  }});
  assert.equal(r.crossCheckedGames,1);assert.equal(r.crossChecks[0].commenceTime,'2026-11-03T01:20:00.000Z');
});
test('wrong score, unknown identity, nonfinal state and partial pages never qualify or trigger more requests',async()=>{
  for(const change of [e=>{e.home_team_score=99;},e=>{e.home_team.abbreviation='NYG';},
    e=>{e.status_state='in_progress';},(e,p)=>{p.meta.next_cursor=123;}]){
    let calls=0;const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>{calls++;return changedResponse(change);}});
    assert.equal(calls,1);assert.equal(r.qualifiedOutcomes,0);assert.notEqual(r.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');
  }
});
test('HTTP failures have bounded generic status, no body reads, retries or secret-bearing details',async()=>{
  for(const [status,expected] of [[401,'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'],[403,'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'],
    [429,'RATE_LIMITED'],[500,'PROVIDER_UNAVAILABLE'],[302,'PROVIDER_UNAVAILABLE']]){
    let calls=0;const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>{calls++;
      return {status,get body(){throw Error(testKey);}};}});
    assert.equal(r.status,expected);assert.equal(calls,1);assert.ok(!JSON.stringify(r).includes(testKey));
  }
  const failed=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>{throw Error(testKey);}});
  assert.equal(failed.status,'REQUEST_FAILED');assert.ok(!JSON.stringify(failed).includes(testKey));
});
test('redirected or unexpected-origin responses are refused without reading their bodies',async()=>{
  for(const fields of [{redirected:true},{url:'https://other.example/games'}]){
    const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>({status:200,...fields,
      get body(){throw Error('MUST_NOT_READ');}})});assert.equal(r.status,'UNEXPECTED_RESPONSE_ORIGIN');
  }
});
test('actual streamed UTF-8 bytes are capped despite missing or lying Content-Length',async()=>{
  const oversized='🙂'.repeat(70000);
  for(const headers of [{'content-type':'application/json'},{'content-type':'application/json','content-length':'1'}]){
    const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>new Response(oversized,{headers})});
    assert.equal(r.status,'INVALID_PROVIDER_RESPONSE');
  }
  const claimed=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>jsonResponse('{}',
    {headers:{'content-type':'application/json','content-length':'9999999'}})});
  assert.equal(claimed.status,'INVALID_PROVIDER_RESPONSE');
});
test('malformed JSON, UTF-8, BOM, MIME and source clocks fail closed with redacted errors',async()=>{
  for(const response of [jsonResponse('{'+testKey),jsonResponse(new Uint8Array([0xc3,0x28])),
    jsonResponse('\uFEFF'+template.balldontlieJson),new Response(template.balldontlieJson)]){
    const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>response});
    assert.equal(r.status,'INVALID_PROVIDER_RESPONSE');assert.ok(!JSON.stringify(r).includes(testKey));
  }
  let clocks=0;const r=await readLiveBallDontLieFinal({...opts(),clock:()=>Date.parse(template.evaluatedAt)-(clocks++?1000:0),fetchImpl:async()=>jsonResponse()});
  assert.equal(r.status,'INVALID_PROVIDER_RESPONSE');
  assert.deepEqual(r.validationDiagnostic,{httpStatus:200,stage:'RECEIPT_TIME',reason:'INVALID_RECEIPT_CLOCK'});
});
test('deadline covers stalled headers and body even when cancellation never settles',async()=>{
  const started=Date.now();
  const header=await readLiveBallDontLieFinal({...opts(),timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});
  assert.equal(header.status,'REQUEST_TIMEOUT');
  const body=await readLiveBallDontLieFinal({...opts(),timeoutMs:10,fetchImpl:async()=>({status:200,
    headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{}),releaseLock(){}})}})});
  assert.equal(body.status,'REQUEST_TIMEOUT');assert.ok(Date.now()-started<1000);
});
test('late ignored-abort fetch cannot start reading a body after the deadline',async()=>{
  let resolve,reads=0;
  const waiting=readLiveBallDontLieFinal({...opts(),timeoutMs:10,fetchImpl:()=>new Promise(r=>{resolve=r;})});
  assert.equal((await waiting).status,'REQUEST_TIMEOUT');
  resolve({status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader(){reads++;throw Error('LATE');}}});
  await new Promise(r=>setTimeout(r,10));assert.equal(reads,0);
});
test('empty or excessive tiny chunks cannot bypass byte bounds or starve the deadline',async()=>{
  let reads=0;
  const empty=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>({status:200,
    headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      async read(){reads++;return {done:false,value:new Uint8Array()};},cancel(){},releaseLock(){}})}})});
  assert.equal(empty.status,'INVALID_PROVIDER_RESPONSE');assert.equal(reads,1);
  reads=0;
  const tiny=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>({status:200,
    headers:new Headers({'content-type':'application/json'}),body:{getReader:()=>({
      async read(){reads++;return {done:false,value:new Uint8Array([32])};},cancel(){},releaseLock(){}})}})});
  assert.equal(tiny.status,'INVALID_PROVIDER_RESPONSE');assert.ok(reads<=8193);
});
test('monotonic deadline rejects success when immediate microtasks delay the timer callback',async()=>{
  const r=await readLiveBallDontLieFinal({...opts(),timeoutMs:10,fetchImpl:async()=>{
    const start=performance.now();while(performance.now()-start<20){}return jsonResponse();
  }});
  assert.equal(r.status,'REQUEST_TIMEOUT');
});
test('full bounded community CSV is hashed intact rather than substituting a filtered reconstruction',async()=>{
  let csv=template.nflverseCsv;for(let i=0;i<120;i++)csv+=template.nflverseCsv.split('\n')[1].replace('synthetic-2026-SEA-CHI','untracked-'+i)+'\n';
  const r=await readLiveBallDontLieFinal({...opts(),nflverseCsv:csv,fetchImpl:async()=>jsonResponse()});
  assert.equal(r.crossCheckedGames,1);assert.equal(r.crossChecks[0].sourceReceipts.nflverse.sha256,
    createHash('sha256').update(csv).digest('hex'));
});
test('successful transport output still cannot pass existing attestation or settlement gates',async()=>{
  const r=await readLiveBallDontLieFinal({...opts(),fetchImpl:async()=>jsonResponse()});
  const now=Date.parse(template.evaluatedAt),candidate=selectFinalizedResults(template.journal,parseCsv(template.nflverseCsv),{now})[0];
  assert.equal(isAttestedFinal(candidate,r.crossChecks[0],{now}),false);
  assert.equal(isCorroboratedSettlement({...candidate,revision:1,verifiedAt:template.evaluatedAt,
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',finalityAttestation:r.crossChecks[0],
    communitySourceVintage:{sha256:createHash('sha256').update(template.nflverseCsv).digest('hex'),
      collectorObservedAt:template.nflverseObservedAt,publicationTimeVerified:false}}),false);
});
