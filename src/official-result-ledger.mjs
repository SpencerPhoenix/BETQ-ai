/** Append-only public metadata for observed official finals; never an aggregate settlement writer. */
import {gradeRetainedGames} from './game-grading.mjs';
import {canonicalTimestamp,validFrozenIdentity} from './evidence-integrity.mjs';
import {NFL_TEAMS} from './nfl-elo.mjs';
import {officialWeeklyUrl,OFFICIAL_FINALITY_POLICY} from './nfl-official-finality.mjs';
import {reviewedResultDigest} from './bdl-reviewed-result.mjs';
export const OFFICIAL_RESULT_LEDGER_POLICY='OFFICIAL_OBSERVED_RESULT_LEDGER_V1';
export const OFFICIAL_RESULT_LEDGER_MAX_BYTES=8*1024*1024;
const MAX_ENTRIES=2000,identityKeys=['gameId','season','home','away','gameDate','commenceTime'];
const teams=new Set(Object.values(NFL_TEAMS)),digest=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const fail=code=>{throw Error(code);};
const hash=reviewedResultDigest;
const plain=v=>!!v&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>{
 if(!plain(v)||Reflect.ownKeys(v).length!==keys.length||!keys.every(k=>{
  const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');
 }))fail('OFFICIAL_LEDGER_UNEXPECTED_FIELDS');
};
const array=(v,max,min=0)=>Array.isArray(v)&&Object.getPrototypeOf(v)===Array.prototype&&v.length>=min&&v.length<=max&&
 Reflect.ownKeys(v).length===v.length+1&&Array.from({length:v.length},(_,i)=>Object.getOwnPropertyDescriptor(v,String(i))).every(d=>d?.enumerable&&Object.hasOwn(d,'value'));
const time=s=>{const n=canonicalTimestamp(s);if(!Number.isFinite(n))fail('OFFICIAL_LEDGER_TIMESTAMP');return n;};
const label=(s,max=200)=>typeof s==='string'&&s.length>0&&s.length<=max&&s.trim()===s&&!/[\u0000-\u001f\u007f]/.test(s);
const nullableLabel=s=>s===null||label(s,50);
const score=n=>Number.isSafeInteger(n)&&n>=0&&n<=100;
const day=s=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const clone=v=>JSON.parse(JSON.stringify(v));
const receiptKeys=['schema','policy','sourceUrl','season','week','observedAt','sourcePublishedAt','sourceBodySha256','games',
 'sourceUpstreamIndependenceVerified','sourceAuthenticityIndependentlyAttested','completeLeagueCoverageVerified','historicalAvailabilityProven','aggregateScoringEligible'];
const gameKeys=['gameId','providerGameId','season','week','home','away','kickoff','gameDate','neutralSite','scheduleStatus','summaryPhase','summaryQuarter','summaryState','final','homeScore','awayScore'];
export function validateOfficialResultReceipt(r,now=Date.now()){
 exact(r,receiptKeys);
 if(!Number.isFinite(now)||r.schema!==1||r.policy!==OFFICIAL_FINALITY_POLICY||r.sourceUrl!==officialWeeklyUrl(r.season,r.week)||
  r.sourcePublishedAt!==null||!digest(r.sourceBodySha256)||time(r.observedAt)>now||
  receiptKeys.slice(9).some(k=>r[k]!==false)||!array(r.games,16,1))fail('OFFICIAL_LEDGER_RECEIPT');
 const ids=new Set(),providers=new Set();
 for(const g of r.games){
  exact(g,gameKeys);
  const terminal=['FINAL','FINAL_OVERTIME'].includes(g.summaryPhase);
  if(g.season!==r.season||g.week!==r.week||!teams.has(g.home)||!teams.has(g.away)||g.home===g.away||
   g.gameId!==`${r.season}_${String(r.week).padStart(2,'0')}_${g.away}_${g.home}`||ids.has(g.gameId)||
   !label(g.providerGameId)||providers.has(g.providerGameId)||g.gameDate!==day(time(g.kickoff))||
   typeof g.neutralSite!=='boolean'||!nullableLabel(g.scheduleStatus)||!nullableLabel(g.summaryPhase)||!nullableLabel(g.summaryQuarter)||
   !['ABSENT','PRESENT','MALFORMED'].includes(g.summaryState)||typeof g.final!=='boolean'||
   terminal!==(g.summaryQuarter==='END_OF_GAME')||g.final!==terminal||
   (g.final?(!['SCHEDULED','FINAL'].includes(g.scheduleStatus)||g.summaryState!=='PRESENT'||!score(g.homeScore)||!score(g.awayScore)||time(g.kickoff)>=time(r.observedAt)):
    (g.homeScore!==null||g.awayScore!==null)))fail('OFFICIAL_LEDGER_RECEIPT_GAME');
  if(g.summaryState==='ABSENT'&&(g.summaryPhase!==null||g.summaryQuarter!==null))fail('OFFICIAL_LEDGER_ABSENT_SUMMARY');
  ids.add(g.gameId);providers.add(g.providerGameId);
 }
 return r;
}
export function emptyOfficialResultLedger(){return {schema:1,policy:OFFICIAL_RESULT_LEDGER_POLICY,aggregateScoringEligible:false,entries:[]};}
const bindingKeys=['gameId','baselineSnapshotId','baselineSnapshotSha256','frozenIdentity'];
function validateBinding(b,r){
 exact(b,bindingKeys);exact(b.frozenIdentity,identityKeys);
 const i=b.frozenIdentity;
 if(b.gameId!==i.gameId||!label(b.baselineSnapshotId)||!digest(b.baselineSnapshotSha256)||!validFrozenIdentity(i)||
  !teams.has(i.home)||!teams.has(i.away)||i.season!==r.season||!i.gameId.startsWith(`${r.season}_${String(r.week).padStart(2,'0')}_`)||
  i.gameId!==`${r.season}_${String(r.week).padStart(2,'0')}_${i.away}_${i.home}`||i.gameDate!==day(i.commenceTime))fail('OFFICIAL_LEDGER_BINDING');
}
const entryBody=e=>{const {entrySha256,...b}=e;return b;};
const semantic=(r,bindings)=>hash({season:r.season,week:r.week,games:[...r.games].sort((a,b)=>a.gameId<b.gameId?-1:a.gameId>b.gameId?1:0),bindings});
export function validateOfficialResultLedger(ledger,now=Date.now()){
 exact(ledger,['schema','policy','aggregateScoringEligible','entries']);
 if(!Number.isFinite(now)||ledger.schema!==1||ledger.policy!==OFFICIAL_RESULT_LEDGER_POLICY||ledger.aggregateScoringEligible!==false||
  !array(ledger.entries,MAX_ENTRIES))fail('OFFICIAL_LEDGER_INVALID');
 let previousHash=null,previousAt=-Infinity;const bindings=new Map(),weeks=new Map();
 for(let index=0;index<ledger.entries.length;index++){
  const e=ledger.entries[index];exact(e,['sequence','previousHash','recordedAt','receipt','bindings','entrySha256']);
  const at=time(e.recordedAt);validateOfficialResultReceipt(e.receipt,now);
  if(e.sequence!==index+1||e.previousHash!==previousHash||at<previousAt||at>now||time(e.receipt.observedAt)>at||
   !digest(e.entrySha256)||hash(entryBody(e))!==e.entrySha256||!array(e.bindings,16,1))fail('OFFICIAL_LEDGER_CHAIN');
  const ids=new Set();let last='';
  for(const b of e.bindings){validateBinding(b,e.receipt);
   if(ids.has(b.gameId)||b.gameId<=last||(bindings.has(b.gameId)&&hash(bindings.get(b.gameId))!==hash(b)))fail('OFFICIAL_LEDGER_BASELINE_CHANGED');
   ids.add(b.gameId);last=b.gameId;bindings.set(b.gameId,b);
  }
  const key=e.receipt.season+':'+e.receipt.week,prior=weeks.get(key);
  if(prior&&(time(e.receipt.observedAt)<=time(prior.receipt.observedAt)||semantic(e.receipt,e.bindings)===semantic(prior.receipt,prior.bindings)))fail('OFFICIAL_LEDGER_REPLAY_OR_DUPLICATE');
  if(prior&&prior.bindings.some(b=>!ids.has(b.gameId)))fail('OFFICIAL_LEDGER_BINDING_REMOVED');
  weeks.set(key,e);previousHash=e.entrySha256;previousAt=at;
 }
 if(Buffer.byteLength(JSON.stringify(ledger))>OFFICIAL_RESULT_LEDGER_MAX_BYTES)fail('OFFICIAL_LEDGER_SIZE');
 return ledger;
}
function journalContext(journal,now){
 const report=gradeRetainedGames(journal,{now});if(!report.available)fail('OFFICIAL_LEDGER_INVALID_JOURNAL');
 const shots=new Map(journal.snapshots.map(s=>[s.id,s]));
 return {report,shots};
}
function makeBinding(g,s){return {gameId:g.gameId,baselineSnapshotId:s.id,baselineSnapshotSha256:hash(s),
 frozenIdentity:Object.fromEntries(identityKeys.map(k=>[k,s[k]]))};}
export function appendOfficialResultObservations(ledger,journal,receipts,{now=Date.now()}={}){
 validateOfficialResultLedger(ledger,now);const {report,shots}=journalContext(journal,now);
 if(!array(receipts,18))fail('OFFICIAL_LEDGER_RECEIPTS_LIMIT');
 const out=clone(ledger),seen=new Set();
 for(const receipt of receipts){
  validateOfficialResultReceipt(receipt,now);if(now-time(receipt.observedAt)>=300000)fail('OFFICIAL_LEDGER_STALE_APPEND');
  const key=receipt.season+':'+receipt.week;if(seen.has(key))fail('OFFICIAL_LEDGER_DUPLICATE_WEEK');seen.add(key);
  const prior=out.entries.filter(e=>e.receipt.season===receipt.season&&e.receipt.week===receipt.week).at(-1);
  const currentBindings=report.games.filter(g=>g.gameId.startsWith(`${receipt.season}_${String(receipt.week).padStart(2,'0')}_`))
   .map(g=>{const s=shots.get(g.baselineSnapshotId);if(time(s.capturedAt)>time(receipt.observedAt))fail('OFFICIAL_LEDGER_OBSERVATION_BEFORE_BASELINE');return makeBinding(g,s);})
   .sort((a,b)=>a.gameId<b.gameId?-1:a.gameId>b.gameId?1:0);
  const bindingMap=new Map((prior?.bindings??[]).map(b=>[b.gameId,b]));
  for(const b of currentBindings)bindingMap.set(b.gameId,b);
  const bindings=[...bindingMap.values()].sort((a,b)=>a.gameId<b.gameId?-1:a.gameId>b.gameId?1:0);
  if(!bindings.length)continue;
  if(prior&&time(receipt.observedAt)<time(prior.receipt.observedAt))fail('OFFICIAL_LEDGER_BACKDATED_RECEIPT');
  if(prior&&semantic(prior.receipt,prior.bindings)===semantic(receipt,bindings))continue;
  const body={sequence:out.entries.length+1,previousHash:out.entries.at(-1)?.entrySha256??null,recordedAt:new Date(now).toISOString(),receipt:clone(receipt),bindings};
  out.entries.push({...body,entrySha256:hash(body)});
 }
 validateOfficialResultLedger(out,now);assertOfficialResultLedgerAppend(ledger,out,{now});return out;
}
export function assertOfficialResultLedgerAppend(before,after,{now=Date.now()}={}){
 validateOfficialResultLedger(before,now);validateOfficialResultLedger(after,now);
 if(after.entries.length<before.entries.length||before.entries.some((e,i)=>hash(e)!==hash(after.entries[i])))fail('OFFICIAL_LEDGER_HISTORY_REWRITE');
 return true;
}
export function latestOfficialResultObservations(ledger,journal,{now=Date.now()}={}){
 validateOfficialResultLedger(ledger,now);const {report,shots}=journalContext(journal,now),current=new Map(report.games.map(g=>[g.gameId,g])),latest=new Map(),firstProviders=new Map(),providerGames=new Map();
 for(const e of ledger.entries)for(const b of e.bindings){
  const game=e.receipt.games.find(g=>g.gameId===b.gameId)??null;
  if(game){
   if(!firstProviders.has(b.gameId))firstProviders.set(b.gameId,game.providerGameId);
   if(!providerGames.has(game.providerGameId))providerGames.set(game.providerGameId,new Set());
   providerGames.get(game.providerGameId).add(b.gameId);
  }
  latest.set(b.gameId,{...b,receipt:clone(e.receipt),game:game?clone(game):null,recordedAt:e.recordedAt,entrySha256:e.entrySha256});
 }
 const byGame=new Map();
 for(const [id,o] of latest){
  const g=current.get(id),s=g?shots.get(g.baselineSnapshotId):null,p=o.game;
  let status=!s||s.id!==o.baselineSnapshotId||hash(s)!==o.baselineSnapshotSha256?'BASELINE_CHANGED':
   g.status==='SCHEDULE_CONFLICT_QUARANTINED'?'QUARANTINED':!p?'MISSING_GAME':
   providerGames.get(p.providerGameId)?.size>1||p.providerGameId!==firstProviders.get(id)||p.home!==g.home||p.away!==g.away||p.gameDate!==g.gameDate||p.kickoff!==g.commenceTime?'IDENTITY_CONFLICT':
   !p.final?'NOT_FINAL':g.result&&(p.homeScore!==g.result.homeScore||p.awayScore!==g.result.awayScore)?'SCORE_CONFLICT':'FINAL';
  byGame.set(id,{...o,status,aggregateScoringEligible:false});
 }
 return {byGame,policy:OFFICIAL_RESULT_LEDGER_POLICY,aggregateScoringEligible:false};
}
