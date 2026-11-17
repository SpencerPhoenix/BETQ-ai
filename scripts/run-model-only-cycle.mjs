#!/usr/bin/env node
/** No credentials or paid providers. Reserve must be durably published before capture. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {createOfficialGameFeed,discoveryWeeks,gameScope} from '../src/on-demand-game.mjs';
import {readBoundedText} from '../src/integrity.mjs';import {parseCsv,cleanGames} from '../src/nfl-elo.mjs';
import {inspectModelOnlyHealth} from '../src/model-only-health.mjs';
import {GAME_CARD_ORIGIN} from '../src/model-only-receipt.mjs';
import {emptyModelLedger,validateModelLedger,assertLedgerAppend,reserveModelGames,appendModelCapture,ledgerEvent,NFLVERSE_SCHEDULE,sameOfficialFinal} from '../src/scheduled-model-ledger.mjs';
const [mode,path,...extra]=process.argv.slice(2),runKey=`${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT}`;
if(!['reserve','capture'].includes(mode)||!path||extra.length||!/^\d+\.\d+$/.test(runKey))throw Error('Expected reserve|capture NEW_LEDGER_PATH and workflow run identity');
let original;try{const text=await readFile(path,'utf8');if(text.length>8000000)throw Error('LEDGER_SIZE_LIMIT');original=validateModelLedger(JSON.parse(text));}catch(e){if(e.code==='ENOENT'&&mode==='reserve')original=emptyModelLedger(Date.now());else throw e;}
async function saveCandidate(candidate){assertLedgerAppend(original,candidate);const text=JSON.stringify(candidate,null,2)+'\n';if(Buffer.byteLength(text)>8000000)throw Error('LEDGER_SIZE_LIMIT_REQUIRES_REVIEWED_ARCHIVAL');const temporary=resolve(path)+'.tmp';await writeFile(temporary,text,{mode:0o600});await rename(temporary,resolve(path));}
let ledger=structuredClone(original);const clock=Date.now,root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifact=JSON.parse(await readFile(resolve(root,'data/nfl_elo.json'),'utf8')),challengerArtifact=JSON.parse(await readFile(resolve(root,'data/nfl_efficiency.json'),'utf8'));
if(mode==='reserve'){
 ledgerEvent(ledger,'RUN',null,{runKey,failedWeeks:[],phase:'STARTED'},clock());
 const scope=discoveryWeeks(clock()),weeks=new Set(scope.weeks);
 for(const e of ledger.events.filter(e=>e.type==='RESERVED'))if(clock()-Date.parse(e.payload.game.kickoff)<14*86400000&&gameScope(e.gameId).season===scope.season)weeks.add(gameScope(e.gameId).week);
 const feed=createOfficialGameFeed(),reads=await Promise.all([...weeks].slice(0,6).map(async week=>({week,...await feed.getWeek(scope.season,week)})));
 const receipts=reads.filter(r=>r.available).map(r=>r.receipt),failedWeeks=reads.filter(r=>!r.available).map(r=>r.week);
 const productionHealth=await inspectModelOnlyHealth(artifact,{clock}),productionCompatible=productionHealth.compatible;
 if(productionCompatible)ledger=reserveModelGames(ledger,receipts,{now:clock(),runKey,failedWeeks});
 const resultConflicts=[];let finalSourceAvailable=null;
 if(ledger.events.some(e=>e.type==='CUSTODY')){
  try{
   const response=await fetch(NFLVERSE_SCHEDULE,{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('PUBLIC_SCHEDULE_UNAVAILABLE');
   const csv=await readBoundedText(response,12000000),receivedAt=new Date().toISOString(),hash=createHash('sha256').update(csv).digest('hex');
   const games=cleanGames(parseCsv(csv),{today:receivedAt.slice(0,10)});finalSourceAvailable=true;
   for(const receipt of receipts)for(const game of receipt.games){
    if(!ledger.events.some(e=>e.type==='CUSTODY'&&e.gameId===game.gameId))continue;
    if(!game.final){if(ledger.events.some(e=>e.type==='FINAL'&&e.gameId===game.gameId))resultConflicts.push({gameId:game.gameId,reason:'OFFICIAL_FINAL_STATE_WITHDRAWN'});continue;}
    const source=games.filter(g=>g.id===game.gameId),old=ledger.events.filter(e=>e.type==='FINAL'&&e.gameId===game.gameId).at(-1);
    if(source.length!==1||source[0].home!==game.home||source[0].away!==game.away||source[0].homeScore!==game.homeScore||source[0].awayScore!==game.awayScore||source[0].date!==game.gameDate){resultConflicts.push({gameId:game.gameId,reason:'FINAL_SOURCES_DISAGREE_OR_MISSING'});continue;}
    const conflict=ledger.events.filter(e=>e.type==='RESULT_CONFLICT'&&e.gameId===game.gameId).at(-1);
    if(old&&(!conflict||ledger.events.indexOf(conflict)<ledger.events.indexOf(old))&&sameOfficialFinal(old.payload.officialGame,game))continue;
    const candidate=structuredClone(ledger);ledgerEvent(candidate,'FINAL',game.gameId,{officialGame:game,officialSource:{url:receipt.sourceUrl,observedAt:receipt.observedAt,bodySha256:receipt.sourceBodySha256},nflverse:{url:NFLVERSE_SCHEDULE,bodySha256:hash,receivedAt,gameId:game.gameId,date:source[0].date,home:source[0].home,away:source[0].away,homeScore:source[0].homeScore,awayScore:source[0].awayScore}},clock());
    try{assertLedgerAppend(ledger,candidate);ledger=candidate;}catch{resultConflicts.push({gameId:game.gameId,reason:'FINAL_IDENTITY_OR_KICKOFF_CONFLICT'});}
   }
  }catch{finalSourceAvailable=false;}
 }
 for(const c of resultConflicts){const latest=ledger.events.filter(e=>e.gameId===c.gameId&&['RESULT_CONFLICT','FINAL'].includes(e.type)).at(-1);if(latest?.type!=='RESULT_CONFLICT'||latest.payload.reason!==c.reason)ledgerEvent(ledger,'RESULT_CONFLICT',c.gameId,{reason:c.reason},clock());}
 ledgerEvent(ledger,'RUN',null,{runKey,failedWeeks,productionCompatible,productionHealth,finalSourceAvailable,resultConflicts,scopeLimited:weeks.size>6},clock());
}else{
 const proof=JSON.parse(await readFile(path+'.publication-checkpoint.json','utf8')),bytes=await readFile(path);
 if(!/^[a-f0-9]{40}$/.test(proof.sha||'')||proof.reservationContentSha256!==createHash('sha256').update(bytes).digest('hex')||!Number.isFinite(Date.parse(proof.reservationServerDate))||clock()-Date.parse(proof.reservationServerDate)>120000||Date.parse(proof.reservationServerDate)>clock()+1500)throw Error('RESERVATION_REMOTE_READBACK_REQUIRED');
 for(const reserved of ledger.events.filter(e=>e.type==='RESERVED'&&e.payload.runKey===runKey)){
  if(ledger.events.some(e=>['CAPTURED','CAPTURE_FAILED'].includes(e.type)&&e.gameId===reserved.gameId))continue;
  try{
   if(clock()>Date.parse(reserved.payload.game.kickoff)-45*60000)throw Error('WINDOW_CLOSED');
   const requestStartedAt=new Date().toISOString(),response=await fetch(GAME_CARD_ORIGIN+'/api/game-evaluation?gameId='+encodeURIComponent(reserved.gameId),{credentials:'omit',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('GAME_CARD_UNAVAILABLE');
   const data=JSON.parse(await readBoundedText(response,100000));
   ledger=appendModelCapture(ledger,reserved.gameId,data,{artifact,challengerArtifact,requestStartedAt,receivedAt:new Date().toISOString(),runKey});
  }catch{ledgerEvent(ledger,'CAPTURE_FAILED',reserved.gameId,{reservationId:reserved.id,reason:'SOURCE_MODEL_OR_WINDOW_UNAVAILABLE'},clock());}
  await saveCandidate(ledger);
 }
}
await saveCandidate(ledger);
console.log(JSON.stringify({mode,runKey,events:ledger.events.length,paidRequests:0,remotePublicationConfirmed:false}));
