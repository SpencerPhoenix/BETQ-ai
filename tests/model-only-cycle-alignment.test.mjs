import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {syntheticDeliveryArtifact} from './fixtures/model-delivery.mjs';
import {evaluateOnDemandGame} from '../src/on-demand-game.mjs';
import {emptyModelLedger,reserveModelGames,appendModelCapture,confirmModelPublication,ledgerEvent,modelLedgerSummary,NFLVERSE_SCHEDULE} from '../src/scheduled-model-ledger.mjs';

const at=Date.parse('2026-11-17T00:00:00.000Z'),iso=n=>new Date(n).toISOString(),id='2026_10_LAC_BAL';
const kickoff=at+75*60000,officialUrl='https://www.nfl.com/scores/2026/week-10';
const fixture={gameId:id,providerGameId:'official-1',season:2026,week:10,home:'BAL',away:'LAC',kickoff:iso(kickoff),gameDate:'2026-11-16',neutralSite:false,scheduleStatus:'SCHEDULED',summaryPhase:'PREGAME',final:false,homeScore:null,awayScore:null};
const receipt={observedAt:iso(at-1000),sourceUrl:officialUrl,sourceBodySha256:'a'.repeat(64),games:[fixture]};
const artifact=syntheticDeliveryArtifact(iso(at-3*3600000),'2026-11-15');
function confirmed(){
 const r=reserveModelGames(emptyModelLedger(at-2*3600000),[receipt],{now:at,runKey:'1.1'});
 const result=evaluateOnDemandGame(id,{artifact,now:at+2000,schedule:{available:true,receipt}});
 const c=appendModelCapture(r,id,result,{artifact,requestStartedAt:iso(at+1000),receivedAt:iso(at+3000),runKey:'1.1'});
 return confirmModelPublication(c,{remoteCommit:'a'.repeat(40),serverDate:iso(at+4000),now:at+4000});
}
function officialPage(phase){
 const game={id:fixture.providerGameId,season:2026,seasonType:'REG',week:10,time:fixture.kickoff,neutralSite:false,status:'SCHEDULED',
  homeTeam:{id:'h',fullName:'Baltimore Ravens'},awayTeam:{id:'a',fullName:'Los Angeles Chargers'},
  summary:{gameId:fixture.providerGameId,phase,quarter:phase==='FINAL'?'END_OF_GAME':'Q4',homeTeam:{teamId:'h',score:{total:20}},awayTeam:{teamId:'a',score:{total:10}}}};
 const state={queries:[{queryKey:['useFetchFootballWeeklyGameDetails',{season:'2026',week:10,seasonType:'REG'}],state:{status:'success',data:[game]}}]};
 return '<script>self.__next_f.push('+JSON.stringify([1,'2b:'+JSON.stringify(['$','component',null,{state}])+'\n'])+')</script>';
}
const header='game_id,season,game_type,week,gameday,away_team,home_team,away_score,home_score,location';
const row=id+',2026,REG,10,2026-11-16,LAC,BAL,10,20,Home';
async function invoke(t,{ledger=confirmed(),now=kickoff+3*3600000,mode='settle',phase='FINAL',csv=header+'\n'+row,code=200}={}){
 const dir=await mkdtemp(join(tmpdir(),'betq-cycle-alignment-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 ledgerEvent(ledger,'RUN',null,{runKey:'2.1',failedWeeks:[],productionCompatible:true,finalSourceAvailable:null,resultConflicts:[]},now);
 const initial=structuredClone(ledger),path=join(dir,'ledger.json'),preload=join(dir,'sources.mjs'),calls=join(dir,'calls.txt');
 await writeFile(path,JSON.stringify(ledger));await writeFile(calls,'');
 await writeFile(preload,`import {appendFileSync} from 'node:fs';const timestamp=${now},OriginalDate=Date;
 globalThis.Date=class extends OriginalDate { constructor(...a){super(...(a.length?a:[timestamp]));} static now(){return timestamp;} };
 globalThis.fetch=async(url,options)=>{
 appendFileSync(${JSON.stringify(calls)},String(url)+'\\n');
 if(options.credentials!=='omit')throw Error('unexpected credentials');
 if(url===${JSON.stringify(officialUrl)})return new Response(${JSON.stringify(officialPage(phase))},{headers:{'content-type':'text/html'}});
 if(url===${JSON.stringify(NFLVERSE_SCHEDULE)})return new Response(${JSON.stringify(csv)},{status:${code}});
 throw Error('undocumented source');
 };`);
 const res=spawnSync(process.execPath,['--import',preload,new URL('../scripts/run-model-only-cycle.mjs',import.meta.url).pathname,mode,path],{encoding:'utf8',env:{...process.env,GITHUB_RUN_ID:'2',GITHUB_RUN_ATTEMPT:'1'}});
 assert.equal(res.status,0,res.stderr);
 const result=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(result.events.slice(0,initial.events.length),initial.events);
 return {result,calls:(await readFile(calls,'utf8')).trim().split('\n').filter(Boolean)};
}
test('postgame entrypoint grades exact matching two-source final but never rewrites frozen bytes',async t=>{
 const {result,calls}=await invoke(t);
 assert.deepEqual(calls,[officialUrl,NFLVERSE_SCHEDULE]);
 assert.equal(result.events.at(-1).payload.finalSourceAvailable,true);
 assert.equal(modelLedgerSummary(result).games[0].grade.homeScore,20);
});
test('same stage holds pending kickoff and source outage separately without weakening grading',async t=>{
 const pre=await invoke(t,{now:kickoff-10000});
 assert.deepEqual(pre.calls,[]);
 assert.equal(pre.result.events.at(-1).payload.finalSourceAvailable,null);
 const outage=await invoke(t,{code:503});
 assert.equal(outage.result.events.at(-1).payload.finalSourceAvailable,false);
 assert.equal(outage.result.events.some(e=>e.type==='CUSTODY'),true);
 assert.equal(outage.result.events.some(e=>e.type==='FINAL'),false);
});
test('duplicate corroborating source rows cannot settle a final even when first row matches',async t=>{
 const {result}=await invoke(t,{csv:[header,row,row.replace(',10,20,',',11,20,')].join('\n')});
 assert.equal(result.events.some(e=>e.type==='FINAL'),false);
 assert.equal(result.events.find(e=>e.type==='RESULT_CONFLICT').payload.reason,'FINAL_SOURCES_DISAGREE_OR_MISSING');
});
