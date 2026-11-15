import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {createInjuryReportFeed,validateInjuryArtifact,PUBLIC_INJURY_ARTIFACT_URL} from '../src/injury-feed.mjs';
import {compileInjuryReports,injuryContextForGame,injurySourceStatus,INJURY_MAX_AGE_MS} from '../src/injuries.mjs';
import {createHandler} from '../src/server.mjs';
import {NFL_TEAMS} from '../src/nfl-elo.mjs';
const root=new URL('./fixtures/injuries/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
const load=i=>JSON.parse(gunzipSync(readFileSync(new URL(manifest[i].file,root))));
const OLD=load(0),NEW=load(1),NOW=Date.parse('2026-11-07T23:30:00.000Z');
const response=a=>new Response(JSON.stringify(a));
const fixture=NEW.fixtures.find(f=>NEW.reports[f.home+':'+f.week]&&NEW.reports[f.away+':'+f.week]);
const teamName=code=>Object.entries(NFL_TEAMS).find(([,c])=>c===code)[0];
const event={id:'retained-game-fixture',home_team:teamName(fixture.home),away_team:teamName(fixture.away),
  commence_time:fixture.gameDate+'T20:00:00.000Z',bookmakers:[]};

test('Retained real artifacts reproduce stale deployment versus fresh repository without changing source timestamps',()=>{
  manifest.forEach((m,i)=>{
    const bytes=gunzipSync(readFileSync(new URL(m.file,root)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),m.sha256);
    const a=validateInjuryArtifact(load(i),NOW);assert.equal(a.sourceUpdatedAt,m.sourceUpdatedAt);
    assert.equal(a.reportCount,m.reportCount);assert.equal(a.perPlayerTimestampsAvailable,false);
  });
  assert.equal(injurySourceStatus(OLD,NOW).reason,'INJURY_SOURCE_STALE');
  assert.equal(injurySourceStatus(NEW,NOW).available,true);
  assert.equal(NEW.sourceUpdatedAt,'2026-11-07T13:53:57.000Z');
  assert.equal(NEW.reportCount,272);
});
test('Fixed public artifact reader refreshes old bundle, coalesces reads and never requests provider or credentials',async()=>{
  let calls=0,now=NOW,release;
  const gate=new Promise(r=>{release=r;});
  const feed=createInjuryReportFeed({fallbackArtifact:OLD,clock:()=>now,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,PUBLIC_INJURY_ARTIFACT_URL);assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');assert.deepEqual(options.headers,{Accept:'application/json'});
    await gate;return response(NEW);
  }});
  assert.equal(feed.status().available,false);
  const pending=Array.from({length:12},()=>feed.get());release();const values=await Promise.all(pending);
  assert.equal(calls,1);assert.equal(values[0].status.available,true);
  assert.equal(values[0].status.publication.source,'PUBLIC_RETAINED_ARTIFACT');
  assert.equal(values[0].status.playerTimestampAvailable,false);
  values[0].artifact.reports={};assert.equal((await feed.get()).artifact.reportCount,272);
  now=Date.parse(NEW.sourceUpdatedAt)+INJURY_MAX_AGE_MS+1;
  assert.equal(feed.status().available,false);assert.equal(feed.status().reason,'INJURY_SOURCE_STALE');
});
test('HTTP denial has no alternate route or immediate retry and retains honest stale status',async()=>{
  let calls=0,now=NOW;
  const feed=createInjuryReportFeed({fallbackArtifact:OLD,clock:()=>now,fetchImpl:async()=>{
    calls++;return new Response('private upstream error details',{status:403});
  }});
  const one=await feed.get();await feed.get();assert.equal(calls,1);
  assert.equal(one.status.available,false);assert.equal(one.status.reason,'INJURY_SOURCE_STALE');
  assert.equal(one.status.publication.httpStatus,403);
  assert.equal(one.status.publication.lastSuccessfulFetchAt,null);
  assert.doesNotMatch(JSON.stringify(one.status),/private upstream/);
  now+=300001;await feed.get();assert.equal(calls,2);
});
test('Unknown, future, oversized and regressing artifact responses preserve retained reports',async()=>{
  const cases=[OLD,{...NEW,sourceUpdatedAt:'2026-11-08T00:00:00.000Z'},
    {...NEW,token:'must-not-escape'}, {...NEW,reportCount:0},
    {...NEW,validUntil:'2027-01-01T00:00:00.000Z'},
    {...NEW,reports:{...NEW.reports,'KC:9':{...NEW.reports['KC:9'],flaggedCount:999}}}];
  for(const candidate of cases){
    const feed=createInjuryReportFeed({fallbackArtifact:NEW,clock:()=>NOW,fetchImpl:async()=>response(candidate)});
    const result=await feed.get();assert.equal(result.status.publication.lastError,'PUBLIC_INJURY_ARTIFACT_UNAVAILABLE_OR_INVALID');
    assert.deepEqual(result.artifact,NEW);
  }
  const feed=createInjuryReportFeed({fallbackArtifact:NEW,clock:()=>NOW,
    fetchImpl:async()=>new Response(' ',{headers:{'content-length':'1500001'}})});
  assert.equal((await feed.get()).status.publication.lastError,'PUBLIC_INJURY_ARTIFACT_UNAVAILABLE_OR_INVALID');
});
test('Wrong-season candidates cannot poison the retained source or block a later legitimate read',async()=>{
  let now=NOW,candidate=structuredClone(NEW);
  candidate.season=2027;candidate.sourceUrl=candidate.sourceUrl.replace('2026','2027');
  candidate.fixtures=candidate.fixtures.map(f=>({...f,gameId:f.gameId.replace('2026','2027'),gameDate:f.gameDate.replace('2026','2027')}));
  candidate.sourceUpdatedAt='2026-11-07T13:54:57.000Z';candidate.validUntil='2026-11-10T13:54:57.000Z';
  for(const r of Object.values(candidate.reports))r.lastPlayerUpdate=candidate.sourceUpdatedAt;
  const feed=createInjuryReportFeed({fallbackArtifact:NEW,clock:()=>now,fetchImpl:async()=>response(candidate)});
  const rejected=await feed.get();assert.equal(rejected.status.available,true);assert.deepEqual(rejected.artifact,NEW);
  assert.equal(rejected.status.publication.lastError,'PUBLIC_INJURY_ARTIFACT_UNAVAILABLE_OR_INVALID');
  now+=300001;candidate=NEW;
  const accepted=await feed.get();assert.equal(accepted.status.available,true);assert.equal(accepted.status.publication.lastError,null);
  const wrongDate=structuredClone(NEW);wrongDate.fixtures[0].gameDate='2027-11-07';
  assert.throws(()=>validateInjuryArtifact(wrongDate,NOW),/INVALID/);
});
test('Rebuilding unchanged vintage does not reset expiry, and equal-vintage report changes are rejected',async()=>{
  const next=structuredClone(NEW);next.builtAt=new Date(NOW).toISOString();next.fixtures=next.fixtures.slice(1);
  const feed=createInjuryReportFeed({fallbackArtifact:NEW,clock:()=>NOW,fetchImpl:async()=>response(next)});
  const r=await feed.get();assert.equal(r.status.validUntil,NEW.validUntil);assert.equal(r.artifact.fixtures.length,NEW.fixtures.length-1);
  const changed=structuredClone(next);changed.reports[Object.keys(changed.reports)[0]].flaggedPlayers[0].injury='Changed retained report';
  const bad=createInjuryReportFeed({fallbackArtifact:NEW,clock:()=>NOW,fetchImpl:async()=>response(changed)});
  assert.deepEqual((await bad.get()).artifact,NEW);
});
test('Fresh source is context only; expiry, future time, missing teams and wrong season fail closed',()=>{
  const r=injuryContextForGame(event,NEW,NOW);
  assert.equal(r.available,true);assert.equal(r.starterVerified,false);assert.equal(r.probabilitiesAdjusted,false);
  assert.equal(r.freshnessBasis,'SOURCE_FILE_ONLY');
  assert.equal(r.home.individualTimestampAvailable,false);assert.equal(r.home.lastPlayerUpdateAt,null);
  assert.equal(r.home.sourceLastModified,NEW.sourceUpdatedAt);
  const boundary=Date.parse(NEW.sourceUpdatedAt)+INJURY_MAX_AGE_MS;
  assert.equal(injuryContextForGame(event,NEW,boundary).available,true);
  assert.equal(injuryContextForGame(event,NEW,boundary+1).reason,'INJURY_SOURCE_STALE');
  assert.equal(injurySourceStatus(NEW,Date.parse(NEW.sourceUpdatedAt)-1).reason,'INJURY_SOURCE_TIME_IN_FUTURE');
  assert.equal(injurySourceStatus({...NEW,season:2025},NOW).reason,'INJURY_SEASON_MISMATCH');
  assert.equal(injuryContextForGame(event,{...NEW,reports:{}},NOW).reason,'NO_REPORT_FOR_GAME_WEEK');
});
test('Mixed dated and undated reports never manufacture an aggregate player-update time',()=>{
  const rows=[
    {season:'2026',week:'9',team:'KC',position:'QB',full_name:'Synthetic Dated QB',gsis_id:'test-dated',
      report_status:'Questionable',date_modified:'2026-11-07T12:00:00.000Z'},
    {season:'2026',week:'9',team:'KC',position:'RB',full_name:'Synthetic Undated RB',gsis_id:'test-undated',
      report_status:'Out',date_modified:''}
  ];
  const artifact=compileInjuryReports(rows,{season:2026,sourceUpdatedAt:NEW.sourceUpdatedAt,now:NOW});
  artifact.fixtures=[{gameId:'2026_09_LV_KC',week:9,gameDate:'2026-11-08',home:'KC',away:'LV'}];
  artifact.validUntil=NEW.validUntil;validateInjuryArtifact(artifact,NOW);
  const context=injuryContextForGame({home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',
    commence_time:'2026-11-08T20:00:00.000Z'},artifact,NOW);
  assert.equal(context.home.individualTimestampAvailable,true);
  assert.equal(context.home.sourceLastModified,NEW.sourceUpdatedAt);
  assert.equal(context.home.lastPlayerUpdateAt,null);
  assert.equal(context.home.reportedQBs[0].dateModified,'2026-11-07T12:00:00.000Z');
  assert.equal(context.home.flaggedPlayers.find(p=>p.position==='RB').dateModified,null);
});
test('HTTP injury endpoint, health, config and cached NFL card use the same refreshed artifact with no odds request',async t=>{
  let reads=0,now=NOW;
  const feed=createInjuryReportFeed({fallbackArtifact:OLD,clock:()=>now,fetchImpl:async()=>{reads++;return response(NEW);}});
  const source={status:()=>({configured:false}),getScores:()=>{throw Error('provider forbidden');},
    getOdds:async()=>({events:[event],receivedAt:new Date(NOW).toISOString(),cacheHit:true,quota:null})};
  const server=http.createServer(createHandler({source,injuryFeed:feed,clock:()=>now,
    shadowStore:{capture:()=>{throw Error('capture forbidden');}}}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  const get=async path=>(await fetch(base+path)).json();
  assert.equal((await get('/api/health')).nflIntelligence.injurySourceAvailable,false);assert.equal(reads,0);
  const injuries=await get('/api/injuries/nfl');assert.equal(injuries.available,true);assert.equal(injuries.reportCount,272);
  assert.equal((await get('/api/config')).injuryReportAvailable,true);
  assert.equal((await get('/api/health')).nflIntelligence.injurySource.sourceUpdatedAt,NEW.sourceUpdatedAt);
  const slate=await get('/api/slate?sport=americanfootball_nfl&market=h2h');
  assert.equal(slate.events[0].injuryContext.sourceUpdatedAt,NEW.sourceUpdatedAt);
  assert.equal(slate.events[0].injuryContext.probabilitiesAdjusted,false);assert.equal(reads,1);
  now=Date.parse(NEW.validUntil)+1;
  assert.equal((await get('/api/health')).nflIntelligence.injurySourceAvailable,false);
  assert.equal((await get('/api/config')).injuryReportAvailable,false);
});
