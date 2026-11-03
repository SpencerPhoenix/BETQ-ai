import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceProvenance} from './fixtures/source-provenance.mjs';
import {
  FREE_SCOREBOARD_BASE,matchFinalFromScoreboard,corroborateFinals
} from '../src/settlement-corroboration.mjs';

const at='2026-11-04T12:30:00.000Z';
const now=Date.parse(at);
const digest='f'.repeat(64);
const journal={schema:1,season:2026,sport:'americanfootball_nfl',
  snapshots:[{id:'first',gameId:'2026_08_CHI_SEA',gameDate:'2026-11-02',
    season:2026,home:'SEA',away:'CHI',commenceTime:'2026-11-03T01:20:00.000Z'}],
  settlements:[]};
const game={season:2026,home:'SEA',away:'CHI',
  kickoff:Date.parse('2026-11-03T01:20:00.000Z')};
const candidate={gameId:'2026_08_CHI_SEA',gameDate:'2026-11-02',
  homeScore:17,awayScore:34,outcome:'AWAY'};
const event=()=>({
  id:'401123456',date:'2026-11-03T01:20:00.000Z',
  season:{year:2026,type:2},
  status:{type:{name:'STATUS_FINAL',completed:true}},
  competitions:[{competitors:[
    {homeAway:'home',score:'17',team:{abbreviation:'SEA'}},
    {homeAway:'away',score:'34',team:{abbreviation:'CHI'}}
  ]}]
});
const summary=events=>({events});
const match=(e=event(),c=candidate,g=game)=>matchFinalFromScoreboard(c,g,
  summary([e]),{observedAt:at,sourceSha256:digest});

test('official-looking final must be explicitly completed and match BOTH scores',()=>{
  const a=match();
  assert.equal(a.status,'CROSS_SOURCE_FINAL');
  assert.equal(a.homeScore,17);
  assert.equal(a.awayScore,34);
  assert.equal(a.officialLeagueCertification,false);
  assert.equal(a.eventId,'401123456');
});
test('partial, postponed, ambiguous, missing-final and non-final status are never attested',()=>{
  for(const e of [
    {...event(),status:{type:{name:'STATUS_IN_PROGRESS',completed:false}}},
    {...event(),status:{type:{name:'STATUS_POSTPONED',completed:false}}},
    {...event(),status:{}},
    {...event(),competitions:[{...event().competitions[0],
      status:{type:{name:'STATUS_IN_PROGRESS',completed:false}}}]}
  ])assert.equal(match(e),null);
  assert.equal(matchFinalFromScoreboard(candidate,game,summary([event(),event()]),
    {observedAt:at,sourceSha256:digest}),null);
});
test('score disagreements, swapped teams and invalid score values fail closed',()=>{
  for(const changed of [
    {...event(),competitions:[{competitors:[
      {homeAway:'home',score:'17',team:{abbreviation:'SEA'}},
      {homeAway:'away',score:'30',team:{abbreviation:'CHI'}}]}]},
    {...event(),competitions:[{competitors:[
      {homeAway:'home',score:'17',team:{abbreviation:'CHI'}},
      {homeAway:'away',score:'34',team:{abbreviation:'SEA'}}]}]},
    {...event(),competitions:[{competitors:[
      {homeAway:'home',score:'17x',team:{abbreviation:'SEA'}},
      {homeAway:'away',score:'34',team:{abbreviation:'CHI'}}]}]}
  ])assert.equal(match(changed),null);
});
test('season and original event kickoff cannot be mismatched',()=>{
  assert.equal(match({...event(),season:{year:2025}}),null);
  assert.equal(match({...event(),date:'2026-11-04T15:20:00Z'}),null);
  assert.equal(match({...event(),id:'wrong-id'}),null);
});
test('free read-only lookup fetches only fixed NFL scoreboard date',async()=>{
  const calls=[];
  const result=await corroborateFinals(journal,[candidate],{
    clock:()=>now,
    fetchImpl:async(url,options)=>{
      calls.push(url);
      assert.equal(options.method,'GET');
      return new Response(JSON.stringify(summary([event()])),{status:200});
    }
  });
  assert.deepEqual(calls,[FREE_SCOREBOARD_BASE+'?dates=20261102']);
  assert.equal(result.confirmed,1);
  assert.equal(result.paidOddsCalls,0);
  assert.equal(result.attestations[candidate.gameId].gameId,candidate.gameId);
  assert.ok(!JSON.stringify(result).includes('bookmakers'));
});
test('unreachable, malformed and unavailable second source cannot invent confirmed finals',async()=>{
  for(const fetchImpl of [
    async()=>{throw Error('offline')},
    async()=>({ok:false,status:503}),
    async()=>new Response('not json',{status:200}),
    async()=>new Response(JSON.stringify(summary([{
      ...event(),status:{type:{name:'STATUS_IN_PROGRESS',completed:false}}
    }])),{status:200})
  ]){
    const result=await corroborateFinals(journal,[candidate],{fetchImpl,clock:()=>now});
    assert.equal(result.confirmed,0);
    assert.deepEqual(result.attestations,{});
    assert.equal(result.unconfirmed,1);
  }
});
test('no candidate triggers no HTTP request and no betting provider',async()=>{
  const result=await corroborateFinals(journal,[],{
    fetchImpl:()=>{throw Error('should not fetch')},clock:()=>now});
  assert.equal(result.confirmed,0);
  assert.equal(result.checkedDates.length,0);
  assert.equal(result.paidOddsCalls,0);
});

test('already attested same-score result avoids redundant ESPN requests',async()=>{
  const attested={
    ...candidate,source:'NFLVERSE_SCHEDULES',revision:2,
    finalityBasis:'TWO_SOURCE_FINAL_STATUS_NOT_LEAGUE_CERTIFIED',
    ...sourceProvenance(at),
    finalityAttestation:{
      status:'CROSS_SOURCE_FINAL',corroborator:'ESPN_SITE_SCOREBOARD_UNOFFICIAL',
      eventId:'401123456',gameId:candidate.gameId,gameDate:candidate.gameDate,
      homeScore:17,awayScore:34,sourceSha256:digest,
      observedAt:at,officialLeagueCertification:false
    }
  };
  const result=await corroborateFinals({...journal,settlements:[attested]},[candidate],{
    clock:()=>now,fetchImpl:()=>{throw Error('already verified; no request')}});
  assert.equal(result.alreadyCorroborated,1);
  assert.equal(result.eligibleCandidates,0);
  assert.deepEqual(result.checkedDates,[]);
  assert.equal(result.confirmed,0);
});
test('bounded multi-date requests rotate to avoid starving old provisional games',async()=>{
  const candidates=Array.from({length:6},(_,i)=>({
    gameId:'game-'+i,gameDate:'2026-11-'+String(i+1).padStart(2,'0'),
    homeScore:17,awayScore:34
  }));
  const j={...journal,snapshots:candidates.map(c=>({
    ...journal.snapshots[0],id:c.gameId,gameId:c.gameId,gameDate:c.gameDate
  }))};
  const fetchImpl=async()=>new Response(JSON.stringify({events:[]}),{status:200});
  const one=await corroborateFinals(j,candidates,{clock:()=>now,fetchImpl});
  const two=await corroborateFinals(j,candidates,{clock:()=>now+86400000,fetchImpl});
  assert.equal(one.checkedDates.length,4);
  assert.equal(two.checkedDates.length,4);
  assert.notDeepEqual(one.checkedDates,two.checkedDates);
  assert.equal(one.deferredDates.length,2);
  assert.equal(two.deferredDates.length,2);
});
