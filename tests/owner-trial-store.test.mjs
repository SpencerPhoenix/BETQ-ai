import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createOwnerTrialStore} from '../src/owner-trial-store.mjs';
const now=Date.parse('2026-11-18T12:00:00Z');
// SQL protocol simulator with serialized transactions, NOT real PostgreSQL proof.
function simulator(overrides={}){
  const db={time:now,policy:{trial_id:randomUUID(),enabled:true,lifetime_credit_limit:3,daily_credit_limit:2,
    starts_at:now-1000,expires_at:new Date(now+86400000*6).toISOString(),...overrides},rows:new Map(),queries:[],connects:0,loseCommit:false};
  let tail=Promise.resolve();
  db.pool={async connect(){db.connects++;let unlock,backup,committed=false;
    return {on(){},removeListener(){},release(){if(unlock){unlock();unlock=null;}},async query(sql,args=[]){
      db.queries.push(sql);
      if(sql==='BEGIN'||sql.startsWith('SET LOCAL'))return {rows:[]};
      if(sql.includes('pg_advisory_xact_lock')){const previous=tail;tail=new Promise(r=>unlock=r);await previous;backup=structuredClone(db.rows);return {rows:[]};}
      if(sql==='COMMIT'){committed=true;if(unlock){unlock();unlock=null;}if(db.loseCommit){db.loseCommit=false;throw Error('private database URL');}return {rows:[]};}
      if(sql==='ROLLBACK'){if(!committed&&backup)db.rows=backup;if(unlock){unlock();unlock=null;}return {rows:[]};}
      if(sql.includes('FROM owner_refresh_trial_policies')){if(!db.policy)return {rows:[]};const p=db.policy;
        return {rows:[{...p,current:p.starts_at<=db.time&&db.time<Date.parse(p.expires_at),
          window_valid:Date.parse(p.expires_at)>p.starts_at&&Date.parse(p.expires_at)-p.starts_at<=604800000,
          utc_day:new Date(db.time).toISOString().slice(0,10)}]};}
      if(sql.includes('COALESCE(SUM')){const rows=[...db.rows.values()].filter(r=>r.account===args[0]);return {rows:[{
        lifetime_used:String(rows.reduce((s,r)=>s+r.charged_credits,0)),daily_used:String(rows.filter(r=>r.day===args[1]).reduce((s,r)=>s+r.charged_credits,0)),
        unresolved:String(rows.filter(r=>r.state!=='completed').length)}]};}
      const key=sql.startsWith('INSERT')?`${args[0]}:${args[2]}`:`${args[0]}:${args[1]}`;
      if(sql.startsWith('SELECT trial_id'))return {rows:db.rows.has(key)?[{...db.rows.get(key)}]:[]};
      if(sql.startsWith('INSERT')){if(db.rows.has(key))throw Error('duplicate');db.rows.set(key,{account:args[0],trial_id:args[1],market:args[3],day:args[4],charged_credits:1,state:'pending'});return {rowCount:1};}
      if(sql.startsWith('UPDATE')){const row=db.rows.get(key);if(!row)return {rowCount:0};
        if(sql.includes('charged_credits=$4')){row.state=args[4];row.charged_credits=args[3];}else row.state='unknown';return {rowCount:1};}
      throw Error('unhandled SQL');
    }};
  }};return db;
}
const store=db=>createOwnerTrialStore({enabled:true,pool:db.pool,accountId:'synthetic-trial'});
const id=(market='h2h')=>({operationId:randomUUID(),market});
test('disabled constructor and invalid inputs never initialize DB',async()=>{
  const db=simulator();const s=createOwnerTrialStore({pool:db.pool,accountId:'synthetic-trial'});
  await assert.rejects(s.claim(id()),{code:'OWNER_TRIAL_DISABLED'});assert.equal(db.connects,0);
  for(const input of [{operationId:randomUUID(),market:'scores'},{operationId:'bad',market:'h2h'}])assert.throws(()=>store(db).claim(input),{code:'OWNER_TRIAL_INPUT_INVALID'});
  assert.equal(db.connects,0);
});
test('claim is durable single permit; duplicate restart and unresolved operation block claims',async()=>{
  const db=simulator(),s=store(db),op=id();const permit=await s.claim(op);
  assert.equal(permit.reservedCredits,1);assert.equal(Object.isFrozen(permit),true);
  await assert.rejects(store(db).claim(op),{code:'OWNER_TRIAL_DUPLICATE'});
  await assert.rejects(store(db).claim(id('spreads')),{code:'OWNER_TRIAL_UNRESOLVED'});
  assert.equal((await s.status()).lifetimeUsed,1);
});
test('concurrent different operation IDs serialize; only one pending operation can win',async()=>{
  const db=simulator();const outcomes=await Promise.allSettled(Array.from({length:10},()=>store(db).claim(id())));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(db.rows.size,1);
});
test('zero actual charge is terminal but never refunds reserved trial allowance',async()=>{
  const db=simulator(),s=store(db),op=id();await s.claim(op);
  assert.deepEqual(await s.complete({...op,chargedCredits:0}),{completed:true,chargedCredits:1});
  await s.complete({...op,chargedCredits:0});assert.equal((await s.status()).lifetimeUsed,1);
  await assert.rejects(s.claim(op),{code:'OWNER_TRIAL_DUPLICATE'});
});
test('daily cap rolls UTC day while lifetime use never resets; expiry blocks even below limits',async()=>{
  const db=simulator(),s=store(db);
  for(let i=0;i<2;i++){const op=id();await s.claim(op);await s.complete({...op,chargedCredits:1});}
  await assert.rejects(s.claim(id()),{code:'OWNER_TRIAL_LIMIT'});
  db.time+=86400000;const op=id();await s.claim(op);await s.complete({...op,chargedCredits:1});
  assert.equal((await s.status()).lifetimeUsed,3);await assert.rejects(s.claim(id()),{code:'OWNER_TRIAL_LIMIT'});
  db.time=Date.parse(db.policy.expires_at);await assert.rejects(s.claim(id()),{code:'OWNER_TRIAL_EXPIRED'});
});
test('unknown is irreversible by runtime complete and blocks across restart and dates',async()=>{
  const db=simulator(),s=store(db),op=id();await s.claim(op);await s.failUnknown(op);db.time+=86400000;
  await assert.rejects(store(db).claim(id()),{code:'OWNER_TRIAL_UNRESOLVED'});
  await assert.rejects(s.complete({...op,chargedCredits:1}),{code:'OWNER_TRIAL_UNRESOLVED'});
});
test('uncertain completion can conservatively quarantine already completed operation',async()=>{
  const db=simulator(),s=store(db),op=id();await s.claim(op);await s.complete({...op,chargedCredits:1});
  await s.failUnknown(op);assert.equal((await s.status()).reason,'OWNER_TRIAL_UNRESOLVED');
});
test('claim lost commit acknowledgement returns no permit and retained pending operation blocks restart',async()=>{
  const db=simulator(),s=store(db);db.loseCommit=true;
  await assert.rejects(s.claim(id()),e=>e.code==='OWNER_TRIAL_STORAGE_UNAVAILABLE'&&!e.message.includes('private'));
  assert.equal(db.rows.size,1);await assert.rejects(store(db).claim(id()),{code:'OWNER_TRIAL_UNRESOLVED'});
});
test('completion after expiry/disabled policy still accounts for an incurred charge monotonically',async()=>{
  const db=simulator(),s=store(db),op=id();await s.claim(op);db.time=Date.parse(db.policy.expires_at);db.policy.enabled=false;
  await s.complete({...op,chargedCredits:4});await assert.rejects(s.complete({...op,chargedCredits:1}),{code:'OWNER_TRIAL_UNRESOLVED'});
  assert.equal((await s.status()).lifetimeUsed,4);
});
test('missing disabled excessive and future policies never admit; no schema or policy mutation',async()=>{
  for(const change of [{enabled:false},{lifetime_credit_limit:37},{daily_credit_limit:13},
    {expires_at:new Date(now+604800001).toISOString()},{starts_at:now+1}]){
    const db=simulator(change);await assert.rejects(store(db).claim(id()));assert.equal(db.rows.size,0);
    assert.ok(!db.queries.some(q=>/CREATE|ALTER|INSERT INTO owner_refresh_trial_policies|UPDATE owner_refresh_trial_policies/.test(q)));
  }
  const db=simulator();db.policy=null;await assert.rejects(store(db).claim(id()),{code:'OWNER_TRIAL_POLICY_REQUIRED'});
});
test('unrelated account cannot complete another account operation',async()=>{
  const db=simulator(),op=id();await store(db).claim(op);
  const other=createOwnerTrialStore({enabled:true,pool:db.pool,accountId:'other-account'});
  await assert.rejects(other.complete({...op,chargedCredits:1}),{code:'OWNER_TRIAL_OPERATION_REQUIRED'});
});
test('offline migration has no automatic policy seed, preserves rows and enforces hard caps',()=>{
  const sql=readFileSync(new URL('../sql/owner-refresh-trial.sql',import.meta.url),'utf8');
  assert.match(sql,/PRIMARY KEY \(account_id,operation_id\)/);assert.match(sql,/BETWEEN 1 AND 36/);assert.match(sql,/BETWEEN 1 AND 12/);assert.match(sql,/DEFAULT false/);
  assert.match(sql,/interval '168 hours'/);assert.doesNotMatch(sql,/CREATE TABLE IF NOT EXISTS|INSERT INTO|ON CONFLICT|DROP TABLE|TRUNCATE TABLE/);
});
test('36 lifetime and 12 daily hard ceiling survive repeated constructors and three UTC days',async()=>{
  const db=simulator({lifetime_credit_limit:36,daily_credit_limit:12});
  for(let day=0;day<3;day++){
    for(let n=0;n<12;n++){const op=id(['h2h','spreads','totals'][n%3]);await store(db).claim(op);await store(db).complete({...op,chargedCredits:1});}
    await assert.rejects(store(db).claim(id()),{code:'OWNER_TRIAL_LIMIT'});db.time+=86400000;
  }
  assert.equal((await store(db).status()).lifetimeUsed,36);
  await assert.rejects(store(db).claim(id()),{code:'OWNER_TRIAL_LIMIT'});
});
test('same operation UUID binds original market and concurrent duplicate never issues two permits',async()=>{
  const db=simulator(),op=id();
  const out=await Promise.allSettled([store(db).claim(op),store(db).claim(op)]);
  assert.equal(out.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(out.find(x=>x.status==='rejected').reason.code,'OWNER_TRIAL_DUPLICATE');
  await store(db).complete({...op,chargedCredits:1});
  for(const method of ['claim','complete','failUnknown'])await assert.rejects(store(db)[method]({...op,market:'spreads',chargedCredits:1}),{code:'OWNER_TRIAL_OPERATION_MISMATCH'});
  assert.equal(db.rows.size,1);
});
test('invalid actual charge never mutates and larger actual charge cannot be refunded',async()=>{
  const db=simulator(),s=store(db),op=id();await s.claim(op);
  for(const chargedCredits of [null,'1',-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>s.complete({...op,chargedCredits}),{code:'OWNER_TRIAL_INPUT_INVALID'});
  assert.deepEqual(await s.complete({...op,chargedCredits:4}),{completed:false,unknown:true,blocked:true,chargedCredits:4});await assert.rejects(s.complete({...op,chargedCredits:0}),{code:'OWNER_TRIAL_UNRESOLVED'});
  assert.equal((await s.status()).lifetimeUsed,4);await assert.rejects(s.claim(id()),{code:'OWNER_TRIAL_UNRESOLVED'});
  assert.ok(db.queries.every(q=>!q.includes('provider_budget_')));
});

test('anomalous charge and durable stop commit atomically before a concurrent next claim',async()=>{
  const db=simulator({lifetime_credit_limit:36,daily_credit_limit:12}),op=id();
  await store(db).claim(op);
  const [completed,next]=await Promise.allSettled([
    store(db).complete({...op,chargedCredits:2}),store(db).claim(id('totals'))
  ]);
  assert.equal(completed.status,'fulfilled');assert.equal(completed.value.unknown,true);
  assert.equal(next.status,'rejected');assert.equal(next.reason.code,'OWNER_TRIAL_UNRESOLVED');
  assert.equal(db.rows.size,1);assert.equal((await store(db).status()).lifetimeUsed,2);
});
