import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runOneShot,verifyFrozenCheckpoint,BASE_SHA,BRANCH,GAME_ID,FROZEN_KICKOFF,EARLIEST_READ_AT,
  CHECKPOINT_COMMIT,CHECKPOINT_MANIFEST_SHA256,SNAPSHOT_ID} from './run.mjs';
import {NFLVERSE_SCHEDULES_URL} from './lib/settlement-only.mjs';
const root=new URL('../../',import.meta.url),at=Date.parse(EARLIEST_READ_AT),key='mock-not-a-key';
const journalText=await readFile(new URL('docs/checkpoints/2026-11-05-elo/source-journal.json',root),'utf8');
const context=now=>({approved:'true',repositorySecretConfirmed:'true',repository:'SpencerPhoenix/BETQ-ai',
  event:'workflow_dispatch',ref:BRANCH,runAttempt:'1',expectedSha:'a'.repeat(40),actualSha:'a'.repeat(40),
  currentMainSha:BASE_SHA,expiresAt:new Date(now+600000).toISOString()});
const csv='game_id,season,game_type,gameday,away_team,home_team,away_score,home_score,location\n'+
  GAME_ID+',2026,REG,2026-11-05,JAX,BAL,17,21,Home\n';
const payload=()=>({data:[{id:90001,season:2026,postseason:false,date:FROZEN_KICKOFF,
  updated_at:'2026-11-06T06:00:00.000Z',status:'Final',status_state:'final',
  home_team:{id:90002,abbreviation:'BAL'},visitor_team:{id:90003,abbreviation:'JAX'},
  home_team_score:21,visitor_team_score:17}],meta:{next_cursor:null,per_page:100}});
const json=p=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json'}});
const run=(fetchImpl,now=at)=>runOneShot({context:context(now),apiKey:key,journalText,clock:()=>now,fetchImpl});

test('JAX read cannot begin before the unchanged 24-hour guard, including one millisecond early',async()=>{
  assert.equal(at-Date.parse(FROZEN_KICKOFF),86400000);
  let calls=0;const noFetch=async()=>{calls++;throw Error('NO_NETWORK');};
  for(const now of [Date.parse('2026-11-05T16:00:00.000Z'),Date.parse(FROZEN_KICKOFF),at-1]){
    const result=await run(noFetch,now);
    assert.equal(result.status,'POSTGAME_WAIT_REQUIRED');assert.equal(result.providerRequests,0);
    assert.equal(result.publicScheduleRequests,0);assert.equal(result.qualifiedOutcomes,0);
  }
  assert.equal(calls,0);
});
test('the exact public checkpoint and first Elo identity are pinned before any read',async()=>{
  assert.equal(await verifyFrozenCheckpoint(),true);
  const seen=[];
  const result=await run(async(url,init)=>{
    seen.push(url);
    if(url===NFLVERSE_SCHEDULES_URL){assert.equal(init.headers.Authorization,undefined);return new Response(csv);}
    assert.equal(url,'https://api.balldontlie.io/nfl/v1/games?per_page=100&seasons%5B%5D=2026&season_types%5B%5D=2&dates%5B%5D=2026-11-05&dates%5B%5D=2026-11-06');
    assert.equal(init.headers.Authorization,key);return json(payload());
  });
  assert.equal(seen.length,2);assert.equal(result.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');
  assert.equal(result.checkpointCommit,CHECKPOINT_COMMIT);assert.equal(result.checkpointManifestSha256,CHECKPOINT_MANIFEST_SHA256);
  assert.equal(result.snapshotId,SNAPSHOT_ID);assert.equal(result.providerRequests,1);
  assert.equal(result.qualifiedOutcomes,0);assert.equal(result.journalWrites,0);assert.equal(result.sourceIndependenceVerified,false);
});
test('missing, postponed or conflicting JAX community scores stop before authenticated request',async()=>{
  for(const source of [csv.replace(',17,21,',',,,'),csv.replace('2026-11-05,JAX,BAL','2026-11-06,JAX,BAL'),
    csv.replace('JAX,BAL','BAL,JAX'),csv+csv.split('\n')[1]+'\n']){
    let calls=0;const result=await run(async(url,init)=>{calls++;assert.equal(init.headers.Authorization,undefined);return new Response(source);});
    assert.equal(calls,1);assert.equal(result.providerRequests,0);assert.notEqual(result.matched,true);
  }
});
test('a tied matching observation never becomes a binary score or qualified outcome',async()=>{
  const p=payload();p.data[0].home_team_score=17;
  const result=await run(async url=>url===NFLVERSE_SCHEDULES_URL?new Response(csv.replace(',17,21,',',17,17,')):json(p));
  assert.equal(result.status,'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');assert.equal(result.homeScore,17);
  assert.equal(result.awayScore,17);assert.equal(result.qualifiedOutcomes,0);assert.equal(result.journalWrites,0);
  for(const field of ['brier','logLoss','accuracy','ROI','profit','modelPromoted'])assert.equal(result[field],undefined);
});
test('workflow remains an inert review template and checks the delay before secret injection',async()=>{
  const active=await readFile(new URL('.github/workflows/live-probe.yml',root),'utf8');
  const template=await readFile(new URL('./live-probe.yml.template',import.meta.url),'utf8');
  assert.doesNotMatch(active,/one-shot-balldontlie|BALLDONTLIE_API_KEY/);
  assert.ok(template.indexOf('Date.now()<Date.parse(EARLIEST_READ_AT)')<template.indexOf('secrets.BALLDONTLIE_API_KEY'));
});

test('expiry or backwards clock during local provider preflight prevents the actual credential transmission',async()=>{
  for(const sendAt of [at+1000,at+1001,at+499,at+749,NaN]){
    const clocks=[at,at+500,at+750,sendAt];let index=0,calls=0;
    const approval=context(at);approval.expiresAt=new Date(at+1000).toISOString();
    const result=await runOneShot({context:approval,apiKey:key,journalText,
      clock:()=>clocks[index++]??sendAt,fetchImpl:async(url,init)=>{
        calls++;assert.equal(url,NFLVERSE_SCHEDULES_URL);assert.equal(init.headers.Authorization,undefined);
        return new Response(csv);
      }});
    assert.equal(result.status,'APPROVAL_EXPIRED');assert.equal(result.providerRequests,0);
    assert.equal(result.publicScheduleRequests,1);assert.equal(result.retries,0);assert.equal(calls,1);
  }
});
test('a still-valid send boundary permits exactly one request and counts an uncertain failure as consumed',async()=>{
  for(const fail of [false,true]){
    const clocks=[at,at+500,at+750,at+999,at+999];let index=0,calls=0;
    const approval=context(at);approval.expiresAt=new Date(at+1000).toISOString();
    const result=await runOneShot({context:approval,apiKey:key,journalText,
      clock:()=>clocks[index++]??at+999,fetchImpl:async(url,init)=>{
        calls++;if(url===NFLVERSE_SCHEDULES_URL)return new Response(csv);
        assert.equal(init.headers.Authorization,key);if(fail)throw Error('uncertain '+key);
        return json(payload());
      }});
    assert.equal(result.providerRequests,1);assert.equal(calls,2);assert.equal(result.retries,0);
    assert.equal(result.status,fail?'REQUEST_FAILED':'CROSS_CHECKED_INDEPENDENCE_UNVERIFIED');
    assert.ok(!JSON.stringify(result).includes(key));
  }
});
