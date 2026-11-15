/** In-memory source receipt and diagnostics only. No transport, storage or source eligibility expansion. */
import {createHash} from 'node:crypto';
import {resultsFromSchedule,validateJournal} from './evidence.mjs';
import {canonicalTimestamp,FINALITY_DELAY_MS} from './evidence-integrity.mjs';
import {unambiguousFrozenGameIds} from './settlement-qualification.mjs';

/** The digest covers the exact received bytes, not reserialized parsed rows. */
export function readScheduleSourceBytes(bytes,observedAt){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>12000000||
    !Number.isFinite(canonicalTimestamp(observedAt)))throw Error('INVALID_SCHEDULE_SOURCE_RECEIPT');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('INVALID_SCHEDULE_UTF8');}
  // Slice once per field instead of building character ropes and parsing twice.
  // Byte/row bounds alone do not bound the memory occupied by wide output objects.
  const MAX_COLUMNS=256,MAX_CELLS=1000000;
  const rows=[];let headers=null,row=[],columns=0,nonempty=false,records=0,totalCells=0;
  let start=0,end=0,state='plain',escaped=false;
  const pushCell=position=>{
    const value=state==='closed'
      ?(escaped?text.slice(start,end).replaceAll('""','"'):text.slice(start,end))
      :text.slice(start,position);
    columns++;nonempty ||= value!=='';
    // Keep empty oversized records allocation-free until their meaning is known.
    if(columns<=MAX_COLUMNS)row.push(value);
    else if(nonempty)throw Error(headers?'SCHEDULE_ROW_WIDTH_MISMATCH':'SCHEDULE_COLUMN_LIMIT');
    state='plain';escaped=false;start=position+1;
  };
  const pushRow=(position,eof=false)=>{
    pushCell(position);
    if(nonempty){
      if(columns>MAX_COLUMNS)throw Error(headers?'SCHEDULE_ROW_WIDTH_MISMATCH':'SCHEDULE_COLUMN_LIMIT');
      if(++records>30001)throw Error('SCHEDULE_ROW_LIMIT');
      if(!headers){
        if(row.some(x=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(x))||new Set(row).size!==row.length)
          throw Error('INVALID_SCHEDULE_HEADERS');
        headers=row;
      }else{
        if(columns!==headers.length)throw Error('SCHEDULE_ROW_WIDTH_MISMATCH');
        totalCells+=columns;
        if(totalCells>MAX_CELLS)throw Error('SCHEDULE_CELL_LIMIT');
        rows.push(Object.fromEntries(headers.map((key,i)=>[key,row[i]])));
      }
    }else if(eof&&columns>1&&headers){
      // Preserve parseCsv's historical EOF-only empty-record behavior: absent
      // cells default to empty and excess empty cells are ignored.
      totalCells+=headers.length;
      if(totalCells>MAX_CELLS)throw Error('SCHEDULE_CELL_LIMIT');
      rows.push(Object.fromEntries(headers.map(key=>[key,''])));
    }
    row=[];columns=0;nonempty=false;
  };
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(state==='quoted'){
      if(c==='"'){if(text[i+1]==='"'){escaped=true;i++;}else{end=i;state='closed';}}
    }else if(c===',')pushCell(i);
    else if(c==='\n'||c==='\r'){
      pushRow(i);
      if(c==='\r'&&text[i+1]==='\n')i++;
      start=i+1;
    }else if(c==='"'&&state==='plain'&&i===start){state='quoted';start=i+1;}
    else if(state==='closed'||c==='"')throw Error('INVALID_SCHEDULE_QUOTING');
  }
  if(state==='quoted')throw Error('INVALID_SCHEDULE_QUOTING');
  if(start<text.length||columns||state==='closed')pushRow(text.length,true);
  if(!headers)throw Error('INVALID_SCHEDULE_HEADERS');
  for(const field of ['game_id','season','game_type','gameday','away_team','home_team','away_score','home_score','location']){
    if(!headers.includes(field))throw Error('Missing NFL game column: '+field);
  }
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
