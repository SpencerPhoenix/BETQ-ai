/** In-memory source receipt and diagnostics only. No transport, storage or source eligibility expansion. */
import {createHash} from 'node:crypto';
import {parseCsv} from './nfl-elo.mjs';
import {resultsFromSchedule,validateJournal} from './evidence.mjs';
import {canonicalTimestamp,FINALITY_DELAY_MS} from './evidence-integrity.mjs';
import {unambiguousFrozenGameIds} from './settlement-qualification.mjs';

/** The digest covers the exact received bytes, not reserialized parsed rows. */
export function readScheduleSourceBytes(bytes,observedAt){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>12000000||
    !Number.isFinite(canonicalTimestamp(observedAt)))throw Error('INVALID_SCHEDULE_SOURCE_RECEIPT');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INVALID_SCHEDULE_UTF8');}
  const records=[];let row=[],cell='',state='plain';
  const pushCell=()=>{row.push(cell);cell='';state='plain';};
  const pushRow=()=>{pushCell();if(row.some(v=>v!==''))records.push(row);row=[];};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(state==='quoted'){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else state='closed';}
      else cell+=c;
    }else if(c===',')pushCell();
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}
    else if(c==='"'&&state==='plain'&&cell==='')state='quoted';
    else if(state==='closed'||c==='"')throw Error('INVALID_SCHEDULE_QUOTING');
    else cell+=c;
    if(records.length>30001)throw Error('SCHEDULE_ROW_LIMIT');
  }
  if(state==='quoted')throw Error('INVALID_SCHEDULE_QUOTING');
  if(cell||row.length||state==='closed')pushRow();
  const headers=records[0]??[];
  if(!headers.length||headers.some(x=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||new Set(headers).size!==headers.length)
    throw Error('INVALID_SCHEDULE_HEADERS');
  if(records.slice(1).some(r=>r.length!==headers.length))throw Error('SCHEDULE_ROW_WIDTH_MISMATCH');
  if(records.length>30001)throw Error('SCHEDULE_ROW_LIMIT');
  const rows=parseCsv(text);
  return {rows,sourceReceipt:{source:'NFLVERSE_SCHEDULES',observedAt,
    sha256:createHash('sha256').update(bytes).digest('hex')}};
}

/** Multiple blockers may apply to one game. Counts are diagnostic, never outcomes. */
export function prepareScheduleReconciliation(journal,rows,now,{sourceReceipt=null}={}){
  validateJournal(journal);
  const results=resultsFromSchedule(journal,rows,now,{sourceReceipt});
  const admitted=new Set(results.map(r=>r.gameId));
  const unique=new Map(journal.snapshots.map(s=>[s.gameId,s]));
  const unambiguous=unambiguousFrozenGameIds(journal.snapshots);
  const blockers={AMBIGUOUS_FROZEN_IDENTITY:0,MISSING_SOURCE_ROW:0,DUPLICATE_SOURCE_ROW:0,
    SCORES_NOT_AVAILABLE:0,FINALITY_DELAY_NOT_REACHED:0,MISSING_EXPLICIT_FINAL_STATUS:0,
    MISSING_CANONICAL_SOURCE_KICKOFF:0,MISSING_INVALID_OR_STALE_SOURCE_RECEIPT:0,REJECTED_BY_RESULT_GATE:0};
  const at=canonicalTimestamp(sourceReceipt?.observedAt);
  const receiptReady=sourceReceipt?.source==='NFLVERSE_SCHEDULES'&&Number.isFinite(at)&&at<=now+60000&&at>=now-3600000&&
    typeof sourceReceipt?.sha256==='string'&&/^[a-f0-9]{64}$/.test(sourceReceipt.sha256);
  for(const [gameId,snapshot] of unique){
    if(admitted.has(gameId))continue;
    if(!unambiguous.has(gameId)){blockers.AMBIGUOUS_FROZEN_IDENTITY++;continue;}
    const matches=rows.filter(r=>r?.game_id===gameId);
    if(matches.length!==1){blockers[matches.length?'DUPLICATE_SOURCE_ROW':'MISSING_SOURCE_ROW']++;continue;}
    const row=matches[0];let count=0;
    const mark=key=>{blockers[key]++;count++;};
    if(![row.home_score,row.away_score].every(v=>(typeof v==='string'||typeof v==='number')&&/^\d{1,3}$/.test(String(v))&&Number(v)<=100))mark('SCORES_NOT_AVAILABLE');
    if(now<canonicalTimestamp(snapshot.commenceTime)+FINALITY_DELAY_MS)mark('FINALITY_DELAY_NOT_REACHED');
    if(row.status!=='FINAL')mark('MISSING_EXPLICIT_FINAL_STATUS');
    if(!Number.isFinite(canonicalTimestamp(row.commenceTime)))mark('MISSING_CANONICAL_SOURCE_KICKOFF');
    if(!receiptReady||at<canonicalTimestamp(snapshot.commenceTime)+FINALITY_DELAY_MS)mark('MISSING_INVALID_OR_STALE_SOURCE_RECEIPT');
    if(!count)mark('REJECTED_BY_RESULT_GATE');
  }
  return {results,diagnostics:{source:'NFLVERSE_SCHEDULES',trackedGames:unique.size,
    admissibleResultCandidates:results.length,blockedGames:unique.size-results.length,
    sourceReceiptStructurallyValid:receiptReady,blockers,
    scoringQualification:'NOT_SUPPLIED_BY_SCHEDULE_SOURCE',sourceIndependenceVerified:false}};
}
