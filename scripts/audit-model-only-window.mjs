// Read-only and credential-free: consume snapshots acquired by an independent observer.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gameScope} from '../src/on-demand-game.mjs';
import {validateModelLedger} from '../src/scheduled-model-ledger.mjs';
const ms = value => {
 const n=Date.parse(value);
 if(typeof value!=='string'||!Number.isFinite(n)||new Date(n).toISOString()!==value)throw Error('INVALID_UTC_INSTANT');
 return n;
};
const iso=n=>new Date(n).toISOString();
export function auditModelWindow({ledger,actions,gameId,kickoff,observedAt}){
 gameScope(gameId);
 validateModelLedger(ledger);
 if(!actions||!Array.isArray(actions.workflow_runs)||actions.workflow_runs.length>100)throw Error('INVALID_ACTIONS_SNAPSHOT');
 const k=ms(kickoff),at=ms(observedAt),open=k-90*60000,close=k-45*60000;
 const rows=ledger.events.filter(e=>e.gameId===gameId&&ms(e.at)<=at);
 const select=type=>rows.find(e=>e.type===type);
 const reservation=select('RESERVED'),capture=select('CAPTURED'),custody=select('CUSTODY'),miss=select('MISSED');
 if([reservation?.payload.game.kickoff,capture?.payload.record.kickoff,miss?.payload.kickoff].some(x=>x!==undefined&&x!==kickoff))
  throw Error('LEDGER_KICKOFF_DISAGREES');
 const runs=actions.workflow_runs.filter(r=>r.event==='schedule'||r.event==='workflow_dispatch').map(r=>{
  if(!Number.isSafeInteger(r.id)||r.id<=0)throw Error('INVALID_ACTIONS_RUN');
  const created=msGithub(r.created_at);
  const start=r.run_started_at==null?null:msGithub(r.run_started_at);
  return {id:r.id,event:r.event,created, start};
 });
 const inWindow=(x)=>x!==null&&x>=open&&x<=close&&x<=at;
 const runCreated=runs.filter(r=>inWindow(r.created)).map(r=>r.id);
 const runStarted=runs.filter(r=>inWindow(r.start)).map(r=>r.id);
 const runHeartbeat=ledger.events.filter(e=>e.type==='RUN'&&inWindow(ms(e.at)));
 const status= custody ? (ms(custody.at)<=close?'CUSTODY_READBACK_BY_CUTOFF':'PREKICKOFF_CUSTODY_AFTER_CUTOFF')
  : capture ? 'CAPTURED_AWAITING_CUSTODY'
  : select('CAPTURE_FAILED') ? 'CAPTURE_FAILED'
  : at>close ? 'NO_ARCHIVE'
  : reservation ? 'RESERVED'
  : at<open ? 'NOT_DUE' : 'NO_FIXTURE_RECORD_YET';
 return {gameId,kickoff,openedAt:iso(open),cutoffAt:iso(close),observedAt,status,
  runCreated,runStarted,inWindowDurableHeartbeats:runHeartbeat.length,
  captureAt:capture?.at??null,custodyReadbackAt:custody?.at??null,
  // A persisted acknowledgement can appear later than its readback timestamp.
  acknowledgedByCutoffProven:Boolean(custody&&ms(custody.at)<=close&&at<=close),
  fixtureFailureCause:select('CAPTURE_FAILED')?.payload.reason??null,paidRequests:0};
}
function msGithub(v){
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v))throw Error('INVALID_ACTIONS_TIMESTAMP');
 return ms(v.length===20?v.replace('Z','.000Z'):v);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [l,a,gameId,kickoff,observedAt,...extra]=process.argv.slice(2);
 if(!l||!a||!gameId||!kickoff||!observedAt||extra.length)throw Error('EXPECTED_LEDGER_ACTIONS_GAME_KICKOFF_OBSERVATION');
 const load=async path=>{const b=await readFile(path);if(b.length>8000000)throw Error('SNAPSHOT_TOO_LARGE');return JSON.parse(b);};
 const report=auditModelWindow({ledger:await load(l),actions:await load(a),gameId,kickoff,observedAt});
 console.log(JSON.stringify(report,null,2));
 // Distinguish pending, no archive, and invalid inputs in the caller.
 if(['NO_ARCHIVE','CAPTURE_FAILED','PREKICKOFF_CUSTODY_AFTER_CUTOFF'].includes(report.status)||
   (report.status==='CAPTURED_AWAITING_CUSTODY'&&ms(observedAt)>ms(report.cutoffAt)))process.exitCode=2;
}
