import test from 'node:test';
import assert from 'node:assert/strict';
import {NFL_TEAMS} from '../src/nfl-elo.mjs';
import {validateDepthContext,depthContextForGame,createDepthContextFeed,DEPTH_URL} from '../src/depth-context.mjs';
const now=Date.parse('2026-11-17T20:00:00.000Z');
const artifact=()=>({schema:1,season:2026,source:'NFLVERSE_DEPTH_CHARTS',sourceUrl:'https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_2026.csv.gz',sourceLoadAt:'2026-11-17T07:00:00.000Z',collectedAt:'2026-11-17T08:00:00.000Z',sourceSha256:'a'.repeat(64),teams:Object.fromEntries(Object.values(NFL_TEAMS).map(t=>[t,{player:t+' Player',playerId:'123'}]))});
const fixture={home:'Houston Texans',away:'Indianapolis Colts',kickoff:'2026-11-20T01:15:00.000Z'};
test('Source-backed roles bind matchup, not starter or probability claims',()=>{
 const r=depthContextForGame(artifact(),'2026_11_IND_HOU',fixture,now);assert.equal(r.available,true);assert.deepEqual(r.teams.map(x=>x.team),['IND','HOU']);assert.equal(r.starterVerified,false);assert.equal(r.probabilitiesAdjusted,false);
 assert.equal(depthContextForGame(artifact(),'2026_11_IND_HOU',{...fixture,away:'Baltimore Ravens'},now).available,false);
});
test('Missing stale future ambiguous source and kickoff context never display roles',()=>{
 for(const a of [null,{...artifact(),sourceLoadAt:'2026-11-16T07:00:00.000Z'},{...artifact(),collectedAt:'2026-11-18T08:00:00.000Z'},{...artifact(),sourceLoadAt:'2026-11-17 07:00:00'},{...artifact(),teams:{}}])assert.equal(depthContextForGame(a,'2026_11_IND_HOU',fixture,now).available,false);
 assert.equal(depthContextForGame(artifact(),'2026_11_IND_HOU',{...fixture,kickoff:'2026-11-17T19:00:00.000Z'},now).available,false);
});
test('Public compact source caches calls, coalesces and fallback cannot extend freshness',async()=>{
 let calls=0,clock=now;const f=createDepthContextFeed({clock:()=>clock,fetchImpl:async url=>{assert.equal(url,DEPTH_URL);calls++;return new Response(JSON.stringify(artifact()));}});
 const [a,b]=await Promise.all([f.get(),f.get()]);assert.deepEqual(a,b);assert.equal(calls,1);await f.get();assert.equal(calls,1);
 clock+=86400000;assert.equal(depthContextForGame(await f.get(),'2026_11_IND_HOU',fixture,clock).available,false);
 const broken=createDepthContextFeed({artifact:artifact(),clock:()=>now,fetchImpl:async()=>{throw Error('offline');}});assert.deepEqual(await broken.get(),artifact());
});
test('Malformed names and identity fail validation',()=>{for(const mutate of [a=>a.teams.HOU.player='\u0000bad',a=>a.teams.HOU.playerId='?',a=>a.sourceUrl='https://example.com',a=>delete a.teams.IND]){const a=artifact();mutate(a);assert.throws(()=>validateDepthContext(a,now));}});
test('Malformed bundle recovers; arbitrary player flags cannot override projected identity',async()=>{
 const bad=artifact();bad.teams.HOU.team='BAL';bad.teams.HOU.starterVerified=true;assert.throws(()=>validateDepthContext(bad,now));assert.throws(()=>validateDepthContext(artifact(),NaN));
 const feed=createDepthContextFeed({artifact:{...artifact(),sourceLoadAt:'bad'},clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(artifact()))});assert.deepEqual(await feed.get(),artifact());
});
test('Older remote load cannot roll retained source backward',async()=>{
 const old={...artifact(),sourceLoadAt:'2026-11-16T07:00:00.000Z'};
 const feed=createDepthContextFeed({artifact:artifact(),clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify(old))});assert.equal((await feed.get()).sourceLoadAt,artifact().sourceLoadAt);
});
