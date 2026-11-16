import {describeMarketCaptureContract} from '../src/evidence-compat.mjs';
import test from 'node:test';
import {describeModelDelivery} from '../src/model-delivery.mjs';
import {syntheticDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emptyJournal,observationsFromSlate} from '../src/evidence.mjs';

// Fabricated schedules, forecasts and final scores. Every request is intercepted.
const NOW=Date.parse('2026-11-07T13:00:00.000Z'),iso=n=>new Date(n).toISOString();
const modelArtifact=syntheticDeliveryArtifact('2026-11-04T11:00:00.000Z','2026-11-03');
const deliveryIdentity=describeModelDelivery(modelArtifact,NOW);
const entry=new URL('../scripts/capture-evidence.mjs',import.meta.url).href;
const rows=[
  {game_id:'2026_09_LV_SF',season:2026,game_type:'REG',gameday:'2026-11-08',home_team:'SF',away_team:'LV'},
  {game_id:'2026_09_BUF_KC',season:2026,game_type:'REG',gameday:'2026-11-08',home_team:'KC',away_team:'BUF'}
];
function slate(at,kickoff='2026-11-08T21:05:00.000Z',includeOther=true){
  return {marketCaptureContract:describeMarketCaptureContract(),demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',market:'h2h',receivedAt:iso(at),nflModelDelivery:deliveryIdentity,
    events:[['offline-schedule-change','San Francisco 49ers','Las Vegas Raiders',kickoff],
      ...(includeOther?[['offline-unrelated','Kansas City Chiefs','Buffalo Bills','2026-11-08T18:00:00.000Z']]:[])]
      .map(([id,homeTeam,awayTeam,commenceTime])=>({id,homeTeam,awayTeam,commenceTime,
        independentModel:{available:true,method:'NFL_ELO_HISTORICAL_OUTCOMES',independentOfOdds:true,
          use:'RESEARCH_ONLY',homeWinProbability:.6,modelVersion:'nfl-elo-1',deliveryIdentity,
          modelBuiltAt:'2026-11-04T11:00:00.000Z',throughGameDate:'2026-11-03'}}))};
}
const csv='game_id,season,game_type,gameday,home_team,away_team,home_score,away_score,location,status,commenceTime\n'+
  '2026_09_LV_SF,2026,REG,2026-11-08,SF,LV,,,Home,SCHEDULED,2026-11-08T21:25:00.000Z\n'+
  '2026_09_BUF_KC,2026,REG,2026-11-08,KC,BUF,,,Home,SCHEDULED,2026-11-08T18:00:00.000Z\n'+
  '2026_09_SEA_ARI,2026,REG,2026-11-05,ARI,SEA,24,17,Home,FINAL,2026-11-05T18:00:00.000Z\n';

async function directoryFor(t,j){
  const directory=await mkdtemp(join(tmpdir(),'betq-capture-admission-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(directory,'data/evidence'),{recursive:true});
  await writeFile(join(directory,'data/nfl_elo.json'),JSON.stringify(modelArtifact));
  await writeFile(join(directory,'data/evidence/nfl-2026.json'),JSON.stringify(j,null,2)+'\n');
  return directory;
}
function run(directory,current,sourceCsv=csv,now=NOW){
  const code=`
    Date.now=()=>${now};let calls=0;
    globalThis.fetch=async input=>{
      calls++;const url=String(input);
      if(url==='https://offline-betq.test/api/health')return Response.json(${JSON.stringify(modelHealthFixture(modelArtifact,now))});
      if(url==='https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv')
        return new Response(${JSON.stringify(sourceCsv)});
      if(url.startsWith('https://offline-betq.test/api/slate?'))return Response.json(${JSON.stringify(current)});
      throw Error('Unexpected network request: '+url);
    };
    await import(${JSON.stringify(entry)});
    if(calls!==3)throw Error('Unexpected request count: '+calls);
  `;
  return execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,HOME:tmpdir(),BETQ_OPERATOR_REFRESH_TOKEN:'OFFLINE_OPERATOR_FIXTURE_0123456789',
      BETQ_PRODUCTION_URL:'https://offline-betq.test',BETQ_OPERATOR_APPROVED_ORIGIN:'https://offline-betq.test'}});
}

for(const addChallenger of [false,true])test('Collector treats same-day quote recapture as routine'+(addChallenger?' and appends a new same-game challenger ID':' without rewriting evidence'),async t=>{
  const beforeAt=NOW-3600000,baseline=slate(beforeAt,undefined,false),current=slate(NOW,undefined,false);
  const quote=(at,homeProbability)=>({available:true,method:'ALL_BOOKS_MEDIAN_DE_VIG',books:4,
    homeProbability,oldestQuoteAgeSeconds:2,oldestQuoteAt:iso(at-2000),latestQuoteAt:iso(at-2000),disagreementPoints:1});
  baseline.events[0].marketConsensus=quote(beforeAt,.55);
  current.events[0].marketConsensus=quote(NOW,.58);
  if(addChallenger)current.events.push({...structuredClone(current.events[0]),efficiencyChallenger:{
    available:true,independentOfOdds:true,researchOnly:true,automaticSelection:false,modelVersion:'offline-challenger',
    homeWinProbability:.65,generatedAt:'2026-11-04T11:00:00.000Z'}});
  const j=emptyJournal(2026);j.snapshots=observationsFromSlate(baseline,rows,beforeAt,2026).accepted;
  const repeated=observationsFromSlate(current,rows,NOW,2026).accepted;
  assert.equal(j.snapshots[0].id,repeated[0].id);
  assert.notEqual(j.snapshots[0].capturedAt,repeated[0].capturedAt);
  assert.notEqual(j.snapshots[0].marketHomeProbability,repeated[0].marketHomeProbability);
  if(addChallenger)assert.notEqual(j.snapshots[0].id,repeated[1].id);
  const directory=await directoryFor(t,j),path=join(directory,'data/evidence/nfl-2026.json');
  const summaryPath=join(directory,'data/evidence/summary.json'),summary='{"fixture":"routine-repeat"}\n';
  await writeFile(summaryPath,summary);const before=await readFile(path,'utf8');
  const output=run(directory,current,csv.replace('21:25:00.000Z','21:05:00.000Z'));
  assert.match(output,/"captureStatus": "SUCCESS"/);assert.match(output,/"routineDuplicateCaptures": 1/);
  assert.match(output,/"quarantinedCaptures": 0/);assert.match(output,/"quarantinedGames": 0/);
  assert.match(output,/"FROZEN_GAME_IDENTITY_CONFLICT": 0/);assert.match(output,/"SNAPSHOT_ID_PAYLOAD_CONFLICT": 0/);
  assert.match(output,new RegExp('"appended": '+(addChallenger?1:0)));
  const after=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(after.snapshots.find(s=>s.id===j.snapshots[0].id),j.snapshots[0]);
  if(addChallenger){
    assert.equal(after.snapshots.length,2);assert.deepEqual(after.snapshots.find(s=>s.id===repeated[1].id),repeated[1]);
  }else{
    assert.equal(await readFile(path,'utf8'),before);assert.equal(await readFile(summaryPath,'utf8'),summary);
  }
});

for(const sameId of [true,false])test('Collector quarantines '+(sameId?'same-ID':'new-ID')+' changed kickoff and still appends another game and final receipt',async t=>{
  const beforeAt=NOW-(sameId?3600000:86400000),j=emptyJournal(2026);
  j.snapshots=observationsFromSlate(slate(beforeAt,undefined,false),rows,beforeAt,2026).accepted;
  assert.equal(j.snapshots.length,1);
  const changed=structuredClone(j.snapshots[0]);
  j.snapshots.unshift({...changed,id:'offline-earlier-result',gameId:'2026_09_SEA_ARI',providerEventId:'offline-earlier',
    home:'ARI',away:'SEA',gameDate:'2026-11-05',commenceTime:'2026-11-05T18:00:00.000Z',
    capturedAt:'2026-11-04T12:00:00.000Z',sourceReceivedAt:'2026-11-04T12:00:00.000Z'});
  const directory=await directoryFor(t,j),output=run(directory,slate(NOW,'2026-11-08T21:25:00.000Z'));
  assert.match(output,/"captureStatus": "PARTIAL: CAPTURE_IDENTITY_CONFLICT"/);
  assert.match(output,/"quarantinedCaptures": 1/);assert.match(output,/"quarantinedGames": 1/);
  assert.match(output,/"FROZEN_GAME_IDENTITY_CONFLICT": 1/);
  assert.match(output,new RegExp('"SNAPSHOT_ID_PAYLOAD_CONFLICT": '+(sameId?1:0)));
  assert.match(output,/"appended": 1/);assert.match(output,/"newResultsOrCorrections": 1/);
  const after=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8'));
  assert.equal(after.snapshots.length,j.snapshots.length+1);
  for(const original of j.snapshots)assert.deepEqual(after.snapshots.find(s=>s.id===original.id),original);
  assert.equal(after.snapshots.filter(s=>s.gameId===changed.gameId).length,1);
  assert.equal(after.snapshots.find(s=>s.gameId==='2026_09_BUF_KC').commenceTime,'2026-11-08T18:00:00.000Z');
  assert.equal(after.settlements.length,1);assert.equal(after.settlements[0].gameId,'2026_09_SEA_ARI');
  assert.equal(after.settlements[0].terminalStatusReceipt.commenceTime,'2026-11-05T18:00:00.000Z');
});

test('Collector with only conflicting captures reports quarantine and leaves journal and summary bytes unchanged',async t=>{
  const at=NOW-3600000,j=emptyJournal(2026);
  j.snapshots=observationsFromSlate(slate(at,undefined,false),rows,at,2026).accepted;
  const directory=await directoryFor(t,j),path=join(directory,'data/evidence/nfl-2026.json');
  const summaryPath=join(directory,'data/evidence/summary.json'),summary='{"fixture":"unchanged"}\n';
  await writeFile(summaryPath,summary);const before=await readFile(path,'utf8');
  const output=run(directory,slate(NOW,'2026-11-08T21:25:00.000Z',false));
  assert.match(output,/"captureStatus": "QUARANTINED: CAPTURE_IDENTITY_CONFLICT"/);
  assert.match(output,/"appended": 0/);assert.match(output,/No new evidence/);
  assert.equal(await readFile(path,'utf8'),before);assert.equal(await readFile(summaryPath,'utf8'),summary);
});

test('Collector rejects a retained team identity conflict before any source request',async t=>{
  const at=NOW-3600000,j=emptyJournal(2026);
  j.snapshots=observationsFromSlate(slate(at,undefined,false),rows,at,2026).accepted;
  j.snapshots.push({...j.snapshots[0],id:'offline-corrupt-retained',commenceTime:'2026-11-08T21:25:00.000Z',home:'BUF'});
  const directory=await directoryFor(t,j),path=join(directory,'data/evidence/nfl-2026.json'),before=await readFile(path,'utf8');
  const code=`Date.now=()=>${NOW};globalThis.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_REACHED');};
    try{await import(${JSON.stringify(entry)});throw Error('Unexpected admission');}
    catch(error){if(error.message!=='Invalid/conflicting retained frozen identity')throw error;}`;
  execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory,timeout:10000,env:{PATH:process.env.PATH,HOME:tmpdir()}});
  assert.equal(await readFile(path,'utf8'),before);
});

test('Collector preserves already conflicting kickoff history and still admits an unrelated game',async t=>{
  const at=NOW-3600000,j=emptyJournal(2026);
  j.snapshots=observationsFromSlate(slate(at,undefined,false),rows,at,2026).accepted;
  j.snapshots.push({...j.snapshots[0],id:'offline-second-retained-kickoff',commenceTime:'2026-11-08T21:25:00.000Z'});
  const directory=await directoryFor(t,j),output=run(directory,slate(NOW,'2026-11-08T21:25:00.000Z'));
  assert.match(output,/"captureStatus": "PARTIAL: CAPTURE_IDENTITY_CONFLICT"/);
  assert.match(output,/"quarantinedCaptures": 1/);assert.match(output,/"quarantinedGames": 1/);
  assert.match(output,/"appended": 1/);
  const after=JSON.parse(await readFile(join(directory,'data/evidence/nfl-2026.json'),'utf8'));
  assert.equal(after.snapshots.length,3);assert.equal(after.settlements.length,0);
  for(const original of j.snapshots)assert.deepEqual(after.snapshots.find(s=>s.id===original.id),original);
  assert.equal(after.snapshots.filter(s=>s.gameId==='2026_09_LV_SF').length,2);
  assert.equal(after.snapshots.filter(s=>s.gameId==='2026_09_BUF_KC').length,1);
});

for(const includeOther of [false,true])test('Collector reports dated schedule skip'+(includeOther?' while an unrelated capture proceeds':' when no capture remains'),async t=>{
  const observed=Date.parse('2026-11-07T19:43:37.000Z'),beforeAt=observed-3600000,now=observed+3600000;
  const providerId='ac9d38a18d5c92814233a31aa9a48d78',baseline=slate(beforeAt,undefined,false),current=slate(now,undefined,includeOther);
  baseline.events[0].id=providerId;current.events[0].id=providerId;
  current.events[0].scheduleReview={status:'MATCHES_DATED_SCHEDULE_OBSERVATION',currentScheduleVerified:true};
  const j=emptyJournal(2026);j.snapshots=observationsFromSlate(baseline,rows,beforeAt,2026).accepted;
  assert.equal(j.snapshots.length,1);
  const directory=await directoryFor(t,j),path=join(directory,'data/evidence/nfl-2026.json'),before=await readFile(path,'utf8');
  const output=run(directory,current,csv,now);
  assert.match(output,/"scheduleConflictSkips": 1/);assert.match(output,/"skipped": 1/);
  assert.match(output,new RegExp('"appended": '+(includeOther?1:0)));
  assert.match(output,new RegExp('"captureStatus": "'+(includeOther?'SUCCESS':'STARVED: NO_ELIGIBLE_FRESH_CAPTURES')+'"'));
  const after=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(after.snapshots.find(s=>s.id===j.snapshots[0].id),j.snapshots[0]);
  assert.equal(after.snapshots.filter(s=>s.gameId==='2026_09_LV_SF').length,1);
  if(includeOther)assert.equal(after.snapshots.filter(s=>s.gameId==='2026_09_BUF_KC').length,1);
  else assert.equal(await readFile(path,'utf8'),before);
});
