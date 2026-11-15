import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readScheduleSourceBytes} from '../src/schedule-source-receipt.mjs';
import {parseCsv} from '../src/nfl-elo.mjs';
const header='game_id,season,game_type,gameday,away_team,home_team,away_score,home_score,location';
const observedAt='2026-11-15T20:00:00.000Z';
const read=text=>readScheduleSourceBytes(Buffer.from(text),observedAt);

test('single-pass fields preserve whitespace, quotes, CRLF, BOM, and EOF empty records',()=>{
  for(const ending of ['','\n','\r','\r\n']){
    for(const location of ['Home','""','"with,comma"','"embedded\r\nline"','"a""b"',' spaced ']){
      const text=header+'\r\n'+'id,2026,REG,2026-11-15,NYJ,BUF,10,20,'+location+ending;
      assert.deepEqual(read(text).rows,parseCsv(text));
      assert.deepEqual(read('\uFEFF'+text).rows,parseCsv(text));
      assert.equal(read(text).sourceReceipt.sha256,createHash('sha256').update(text).digest('hex'));
    }
  }
  for(const tail of [',,',',,\n','"",,','\n\r\n,,,','\n,,,\r\n']){
    assert.deepEqual(read(header+'\n'+tail).rows,parseCsv(header+'\n'+tail));
  }
});

test('row limit and width remain strict and missing columns are not coerced',()=>{
  const row='id,2026,REG,2026-11-15,NYJ,BUF,10,20,Home\n';
  assert.equal(read(header+'\n'+row.repeat(30000)).rows.length,30000);
  assert.throws(()=>read(header+'\n'+row.repeat(30001)),/SCHEDULE_ROW_LIMIT/);
  assert.throws(()=>read(header+'\nx,,,,,,,,,'),/SCHEDULE_ROW_WIDTH_MISMATCH/);
  assert.throws(()=>read(header+'\nx'),/SCHEDULE_ROW_WIDTH_MISMATCH/);
  assert.throws(()=>read('game_id\nx'),/Missing NFL game column: season/);
  assert.throws(()=>read(header+',game_id\nx'),/INVALID_SCHEDULE_HEADERS/);
});

// Each adversarial fixture is isolated from the test runner and all others. The
// limit deliberately matches the small production-worker heap used in review.
const cases={
  '12 MB unclosed quoted field':`text='"'+'x'.repeat(11999999); expected='INVALID_SCHEDULE_QUOTING';`,
  '12 MB invalid header':`text='\\0'.repeat(12000000); expected='INVALID_SCHEDULE_HEADERS';`,
  '12 MB valid large cell':`const prefix=header+'\\nid,2026,REG,2026-11-15,NYJ,BUF,10,20,';text=prefix+'x'.repeat(12000000-prefix.length);`,
  '12 MB escaped quoted cell':`const prefix=header+'\\nid,2026,REG,2026-11-15,NYJ,BUF,10,20,"';text=prefix+'""'.repeat(Math.floor((12000000-prefix.length-1)/2))+'"';`,
  '12 MB empty columns':`text=','.repeat(12000000); expected='INVALID_SCHEDULE_HEADERS';`,
  '12 MB wide nonempty record':`const prefix=header+'\\nx';text=prefix+','.repeat(12000000-prefix.length);expected='SCHEDULE_ROW_WIDTH_MISMATCH';`,
  'oversized column shape':`text=header+','+Array.from({length:248},(_,i)=>'extra'+i).join(',');expected='SCHEDULE_COLUMN_LIMIT';`,
  'bounded aggregate cells':`const h=header+','+Array.from({length:247},(_,i)=>'extra'+i).join(',');text=h+'\\n'+('x'+','.repeat(255)+'\\n').repeat(3907);expected='SCHEDULE_CELL_LIMIT';`
};
for(const [name,fixture] of Object.entries(cases))test(name+' completes under 256 MB heap',()=>{
  const source=new URL('../src/schedule-source-receipt.mjs',import.meta.url).href;
  const script=`import assert from 'node:assert/strict';import {readScheduleSourceBytes} from ${JSON.stringify(source)};
    globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};
    const header=${JSON.stringify(header)};let text,expected;${fixture}
    const bytes=Buffer.from(text);text=null;
    if(expected)assert.throws(()=>readScheduleSourceBytes(bytes,${JSON.stringify(observedAt)}),new RegExp(expected));
    else assert.equal(readScheduleSourceBytes(bytes,${JSON.stringify(observedAt)}).rows.length,1);
    console.log('bounded-ok');`;
  const result=spawnSync(process.execPath,['--max-old-space-size=256','--input-type=module','-e',script],{
    env:{PATH:process.env.PATH},encoding:'utf8',timeout:20000,maxBuffer:20000
  });
  assert.equal(result.error,undefined,String(result.error));
  assert.equal(result.signal,null,result.stderr);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/bounded-ok/);
});
