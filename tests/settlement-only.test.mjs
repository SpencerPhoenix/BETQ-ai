import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {fetchNflverseScheduleCsv,NFLVERSE_SCHEDULES_URL,reconcileSettlements}
  from '../src/settlement-only.mjs';

const now=Date.parse('2026-11-03T12:30:00.000Z');
const makeJournal=()=>({
  schema:1,season:2026,sport:'americanfootball_nfl',
  snapshots:[{
    id:'first-source',season:2026,gameId:'2026_08_CHI_SEA',gameDate:'2026-11-02',
    home:'SEA',away:'CHI',commenceTime:'2026-11-03T01:20:00.000Z',
    capturedAt:'2026-11-02T01:07:26.939Z',modelHomeProbability:0.61,
    marketHomeProbability:0.607672,researchOnly:true
  }], settlements:[]
});
const makeRow=(overrides={})=>({
  game_id:'2026_08_CHI_SEA',season:'2026',game_type:'REG',gameday:'2026-11-02',
  home_team:'SEA',away_team:'CHI',home_score:'17',away_score:'34',...overrides
});

test('read-only schedule fetch is pinned to the community source and never a paid endpoint',async()=>{
  let calls=0;
  const csv=await fetchNflverseScheduleCsv(async (url,options)=>{
    calls++;
    assert.equal(url,NFLVERSE_SCHEDULES_URL);
    assert.equal(options.headers.Accept,'text/csv,text/plain');
    assert.equal(options.method,undefined); // GET
    return {ok:true,text:async()=> 'header\nrow'};
  });
  assert.equal(csv,'header\nrow');
  assert.equal(calls,1);
  await assert.rejects(fetchNflverseScheduleCsv(async()=>({ok:false,status:503})),
    /NFLVERSE_SCHEDULE_HTTP_503/);
  await assert.rejects(fetchNflverseScheduleCsv(async()=>({ok:true,text:async()=>''})),
    /NFLVERSE_SCHEDULE_INVALID_SIZE/);
});

test('new final is appended once with original forecast preserved exactly',()=>{
  const journal=makeJournal();
  const originalSnapshot=JSON.stringify(journal.snapshots);
  const first=reconcileSettlements(journal,[makeRow()],{now});
  assert.equal(first.appended,1);
  assert.equal(first.journal.settlements[0].revision,1);
  assert.equal(first.journal.settlements[0].outcome,'AWAY');
  assert.equal(first.journal.settlements[0].source,'NFLVERSE_SCHEDULES');
  assert.equal(JSON.stringify(first.journal.snapshots),originalSnapshot);
  assert.deepEqual(journal.settlements,[]);
  const repeat=reconcileSettlements(first.journal,[makeRow()],{now:now+86400000});
  assert.equal(repeat.appended,0);
  assert.deepEqual(repeat.journal.settlements,first.journal.settlements);
});

test('score correction is append-only and does not count as another game',()=>{
  const first=reconcileSettlements(makeJournal(),[makeRow()],{now});
  const second=reconcileSettlements(first.journal,[makeRow({home_score:'20'})],
    {now:now+86400000});
  assert.equal(second.appended,1);
  assert.equal(second.journal.settlements.length,2);
  assert.deepEqual(second.journal.settlements.map(x=>x.revision),[1,2]);
  assert.equal(new Set(second.journal.settlements.map(s=>s.gameId)).size,1);
  assert.equal(second.journal.snapshots[0].id,'first-source');
});

test('missing, premature and partial results cannot become a final settlement',()=>{
  for(const rows of [[],[makeRow({home_score:''})],[makeRow({away_score:'12x'})]]){
    assert.equal(reconcileSettlements(makeJournal(),rows,{now}).appended,0);
  }
  const tooEarly=Date.parse('2026-11-03T03:00:00Z');
  assert.equal(reconcileSettlements(makeJournal(),[makeRow()],{now:tooEarly}).appended,0);
  assert.equal(reconcileSettlements(makeJournal(),[makeRow()],
    {now:Date.parse('2026-11-02T12:00:00Z')}).appended,0);
});

test('ties are recorded but are not counted twice',()=>{
  const r=reconcileSettlements(makeJournal(),[makeRow({home_score:'17',away_score:'17'})],{now});
  assert.equal(r.appended,1);
  assert.equal(r.journal.settlements[0].outcome,'TIE');
  assert.equal(reconcileSettlements(r.journal,[makeRow({home_score:'17',away_score:'17'})],{now}).appended,0);
});

test('conflicting source IDs and duplicate source scores fail closed',()=>{
  const original=makeJournal();
  for(const row of [makeRow({home_team:'NYG'}),makeRow({gameday:'2026-11-01'}),
    makeRow({season:'2025'})]){
    assert.throws(()=>reconcileSettlements(original,[row],{now}),/SOURCE_GAME_IDENTITY_MISMATCH/);
  }
  assert.throws(()=>reconcileSettlements(original,[makeRow(),makeRow({home_score:'20'})],{now}),
    /CONTRADICTORY_SOURCE_SCORES/);
  const malformed=makeJournal();
  malformed.snapshots.push({...malformed.snapshots[0],id:'other',home:'NYG'});
  assert.throws(()=>reconcileSettlements(malformed,[makeRow()],{now}),
    /CONTRADICTORY_TRACKED_GAME_ID/);
});

test('same revision with conflicting previous settlement is rejected',()=>{
  const first=reconcileSettlements(makeJournal(),[makeRow()],{now});
  first.journal.settlements.push({...first.journal.settlements[0],homeScore:20});
  assert.throws(()=>reconcileSettlements(first.journal,[makeRow()],{now}),
    /CONTRADICTORY_SETTLEMENT_REVISION/);
});

test('settlement command and transitive import graph contain no live odds client',()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const explored=new Set();
  const walk=file=>{
    if(explored.has(file))return;
    explored.add(file);
    const text=readFileSync(file,'utf8');
    for(const match of text.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s*)?['"]([^'"]+)['"]/g)){
      const name=match[1];
      if(!name.startsWith('.'))continue;
      const target=resolve(dirname(file),name);
      assert.doesNotMatch(target,/\/(?:odds|server|engine|agent-run|shadow-store)\.mjs$/);
      walk(target);
    }
    if(file.endsWith('/scripts/reconcile-settlements.mjs')){
      assert.doesNotMatch(text,/\/api\/slate|api\.the-odds-api\.com|ODDS_API_KEY/);
    }
  };
  walk(resolve(root,'scripts/reconcile-settlements.mjs'));
  assert.ok(explored.size>=3);
});
