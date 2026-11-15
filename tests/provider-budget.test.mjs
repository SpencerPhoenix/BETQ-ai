import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderBudget, ProviderBudgetError } from '../src/provider-budget.mjs';

// SQL protocol simulator only. These tests do NOT verify PostgreSQL locking,
// isolation, durability, schema compatibility or behavior across real processes.
function mockDatabase({ remaining = 100, limit = 12, floor = 50, seeded = true, baseline = '2026-11-07T12:00:00Z' } = {}) {
  let data = { account: seeded ? { remaining_credits: remaining, daily_credit_limit: limit, minimum_reserve: floor, baseline_verified_at: baseline } : null, reservations: [] };
  let tail = Promise.resolve();
  const db = {
    day: '2026-11-07', now: Date.parse('2026-11-07T12:00:00Z'), fail: null, queries: [], baselineResult: undefined,
    get data() { return data; },
    async connect() {
      let unlock, snapshot, locked = false;
      return {
        async query(raw, params = []) {
          const sql = raw.replace(/\s+/g, ' ').trim();
          db.queries.push(sql);
          if (db.fail && sql.startsWith(db.fail)) throw new Error('postgres://secret:password@host SQL internals');
          if (sql === 'BEGIN') {
            const prev = tail;
            tail = new Promise(resolve => { unlock = resolve; });
            await prev;
            locked = true;
            snapshot = structuredClone(data);
            return { rows: [], rowCount: 1 };
          }
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            if (sql === 'ROLLBACK' && snapshot) data = snapshot;
            if (locked) { locked = false; unlock(); }
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith('SET LOCAL')) return { rows: [], rowCount: 1 };
          if (sql.startsWith('SELECT remaining_credits')) return { rows: data.account ? [structuredClone(data.account)] : [] };
          if (sql.startsWith('SELECT to_char')) {
            const verified = typeof params[0] === 'string' ? Date.parse(params[0]) : NaN;
            const current = Number.isFinite(verified) && verified <= db.now &&
              params[1] !== null && (db.now - verified) / 1000 < params[1];
            return { rows: [{ utc_day: db.day, baseline_current: db.baselineResult === undefined ? current : db.baselineResult }] };
          }
          if (sql.startsWith('SELECT COALESCE')) return { rows: [{ unresolved: String(data.reservations.filter(r => r.accountId === params[0] && !r.reconciled).length), used: String(data.reservations.filter(r => r.accountId === params[0] && r.day === params[1]).reduce((sum, r) => sum + r.charged_credits, 0)) }] };
          if (sql.startsWith('INSERT INTO provider_budget_reservations')) {
            data.reservations.push({ id: params[0], accountId: params[1], day: params[2], estimated_credits: params[3], charged_credits: params[3] });
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith('UPDATE provider_budget_accounts')) {
            data.account.remaining_credits = sql.includes('remaining_credits - $2') ? data.account.remaining_credits - params[1] : params[1];
            return { rows: [], rowCount: 1 };
          }
          if (sql.startsWith('SELECT estimated_credits')) return { rows: data.reservations.filter(r => r.id === params[0] && r.accountId === params[1]) };
          if (sql.startsWith('UPDATE provider_budget_reservations')) {
            Object.assign(data.reservations.find(r => r.id === params[0] && r.accountId === params[1]), { charged_credits: params[2], reconciled: true });
            return { rows: [], rowCount: 1 };
          }
          throw new Error('Unhandled SQL: ' + sql);
        },
        release() { if (locked) { locked = false; unlock(); } }
      };
    }
  };
  return db;
}
const budget = (pool, options = {}) => createProviderBudget({ pool, accountId: 'test-provider-account', dailyCreditCap: 12, reserveCredits: 50, baselineMaxAgeSeconds: 3600, ...options });
const rejectsCode = (promise, code) => assert.rejects(promise, e => e instanceof ProviderBudgetError && e.code === code);

test('mock: reservations persist across budget instances and use a shared cap', async () => {
  const db = mockDatabase();
  const first = await budget(db).reserve({ estimatedCredits: 8 });
  await budget(db).reconcile(first, { last: 8, remaining: 92 });
  await rejectsCode(budget(db).reserve({ estimatedCredits: 5 }), 'API_DAILY_BUDGET');
  assert.equal((await budget(db).status()).used, 8);
  assert.equal((await budget(db).status()).providerRemaining, 92);
});

test('mock: concurrent reservations serialize and unresolved request blocks all others', async () => {
  const db = mockDatabase();
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => budget(db).reserve({ estimatedCredits: 1 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.data.reservations.length, 1);
  assert.equal((await budget(db).status()).providerRemaining, 99);
  assert.ok(db.queries.some(q => q.includes('FOR UPDATE')));
});

test('mock: provider reserve includes previous unresolved reservations', async () => {
  const db = mockDatabase({ remaining: 52 });
  const r = await budget(db).reserve({ estimatedCredits: 2 });
  await rejectsCode(budget(db).reserve({ estimatedCredits: 1 }), 'BUDGET_OUTCOME_UNKNOWN');
  await budget(db).reconcile(r, { last: 2, remaining: 50 });
  await rejectsCode(budget(db).reserve({ estimatedCredits: 1 }), 'PROVIDER_CREDIT_RESERVE');
  assert.equal((await budget(db).status()).ready, false);
});

test('mock: zero and malformed config never authorize paid requests', async () => {
  for (const value of [null, '', ' ', -1, 1.1, Infinity, NaN, true, '1e2', '12x', '12\n', '12\r', '12\u2028', Number.MAX_SAFE_INTEGER + 1]) {
    await rejectsCode(budget(mockDatabase(), { dailyCreditCap: value }).reserve({ estimatedCredits: 1 }), 'BUDGET_CONFIG_INVALID');
    await rejectsCode(budget(mockDatabase(), { reserveCredits: value }).reserve({ estimatedCredits: 1 }), 'BUDGET_CONFIG_INVALID');
  }
  await rejectsCode(budget(mockDatabase(), { dailyCreditCap: 0 }).reserve({ estimatedCredits: 1 }), 'API_DAILY_BUDGET');
  await rejectsCode(budget(mockDatabase(), { accountId: ' ' }).reserve({ estimatedCredits: 1 }), 'BUDGET_CONFIG_INVALID');
  await rejectsCode(budget(null).reserve({ estimatedCredits: 1 }), 'BUDGET_CONFIG_INVALID');
});

test('mock: default absent daily cap is 12 and reserve 50', async () => {
  const names = ['ODDS_DAILY_CREDIT_LIMIT', 'ODDS_MIN_CREDITS_RESERVE'];
  const previous = names.map(n => process.env[n]);
  names.forEach(n => delete process.env[n]);
  try {
    const b = createProviderBudget({ pool: mockDatabase({ limit: 100, floor: 0 }), accountId: 'test', baselineMaxAgeSeconds: 3600 });
    const status = await b.status();
    assert.equal(status.limit, 12);
    assert.equal(status.minimumProviderCredits, 50);
  } finally {
    names.forEach((n, i) => { if (previous[i] === undefined) delete process.env[n]; else process.env[n] = previous[i]; });
  }
});

test('mock: large configured reserve is never clamped down', async () => {
  const b = budget(mockDatabase({ remaining: 6000 }), { reserveCredits: 6000 });
  assert.equal((await b.status()).minimumProviderCredits, 6000);
  await rejectsCode(b.reserve({ estimatedCredits: 1 }), 'PROVIDER_CREDIT_RESERVE');
});

test('mock: operator stored policy cannot be weakened by process config', async () => {
  const b = budget(mockDatabase({ limit: 1, floor: 99 }), { dailyCreditCap: 1000, reserveCredits: 0 });
  const r = await b.reserve({ estimatedCredits: 1 });
  await b.reconcile(r, { last: 1, remaining: 99 });
  await rejectsCode(b.reserve({ estimatedCredits: 1 }), 'API_DAILY_BUDGET');
  assert.equal((await b.status()).minimumProviderCredits, 99);
});

test('mock: missing or malformed baseline fails closed without migration', async () => {
  for (const options of [{ seeded: false }, { remaining: null }]) {
    const db = mockDatabase(options);
    await rejectsCode(budget(db).reserve({ estimatedCredits: 1 }), 'BUDGET_BASELINE_REQUIRED');
    assert.ok(!db.queries.some(q => /CREATE|ALTER/.test(q)));
  }
  for (const options of [{ remaining: -1 }, { limit: null }, { floor: 'bad' }, { remaining: '1.5' }]) {
    await rejectsCode(budget(mockDatabase(options)).reserve({ estimatedCredits: 1 }), 'BUDGET_STORAGE_INVALID');
  }
});

test('mock: malformed request estimates are rejected before SQL', async () => {
  const db = mockDatabase();
  for (const estimatedCredits of [undefined, null, 0, -1, 1.5, '', NaN, Infinity, false, '1\n', '1\r', '1\u2028']) {
    await rejectsCode(budget(db).reserve({ estimatedCredits }), 'BUDGET_ESTIMATE_INVALID');
  }
  assert.equal(db.queries.length, 0);
});

test('mock: unknown or malformed outcomes retain all reservations', async () => {
  const db = mockDatabase(), b = budget(db);
  const reservation = await b.reserve({ estimatedCredits: 3 });
  for (const quota of [undefined, {}, { last: null, remaining: 100 }, { last: -1, remaining: 100 }, { last: 0, remaining: '' }, { last: '1\n', remaining: 100 }, { last: 1, remaining: '100\r' }]) {
    assert.deepEqual(await b.reconcile(reservation, quota), { reconciled: false, retained: true });
  }
  assert.equal((await b.status()).used, 3);
  assert.equal((await b.status()).providerRemaining, 97);
});

test('mock: reconciliation never refunds, increases remaining or double charges retries', async () => {
  const db = mockDatabase(), b = budget(db);
  const r = await b.reserve({ estimatedCredits: 2 });
  await b.reconcile(r, { last: 1, remaining: 100 });
  assert.equal((await b.status()).used, 2);
  assert.equal((await b.status()).providerRemaining, 98);
  await b.reconcile(r, { last: 5, remaining: 90 });
  await b.reconcile(r, { last: 5, remaining: 90 });
  assert.equal((await b.status()).used, 5);
  assert.equal((await b.status()).providerRemaining, 90);
  await b.reconcile(r, { last: 2, remaining: 95 });
  assert.equal((await b.status()).used, 5);
  assert.equal((await b.status()).providerRemaining, 90);
});

test('mock: out of order observations cannot undo pending spend', async () => {
  const b = budget(mockDatabase());
  const a = await b.reserve({ estimatedCredits: 2 });
  await b.reconcile(a, { last: 2, remaining: 98 });
  const c = await b.reserve({ estimatedCredits: 2 });
  await b.reconcile(c, { last: 2, remaining: 96 });
  await b.reconcile(a, { last: 2, remaining: 98 });
  assert.equal((await b.status()).providerRemaining, 96);
});

test('mock: UTC day change resets daily accounting but not provider spend', async () => {
  const db = mockDatabase(), b = budget(db);
  const r = await b.reserve({ estimatedCredits: 12 });
  db.day = '2026-11-08';
  assert.equal((await b.status()).used, 0);
  assert.equal((await b.status()).providerRemaining, 88);
  await rejectsCode(b.reserve({ estimatedCredits: 1 }), 'BUDGET_OUTCOME_UNKNOWN');
  await b.reconcile(r, { last: 15, remaining: 85 });
  assert.equal((await b.status()).used, 0);
  assert.equal(db.data.reservations[0].charged_credits, 15);
});

test('mock: transaction errors fail closed and sanitize database details', async () => {
  const db = mockDatabase();
  db.fail = 'UPDATE provider_budget_accounts';
  await assert.rejects(budget(db).reserve({ estimatedCredits: 1 }), error => {
    assert.equal(error.code, 'BUDGET_STORAGE_UNAVAILABLE');
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /password|postgres:|SQL internals/);
    return true;
  });
  assert.equal(db.data.reservations.length, 0);
  assert.equal(db.data.account.remaining_credits, 100);
});

test('mock: another account cannot reconcile a reservation', async () => {
  const b = budget(mockDatabase());
  const r = await b.reserve({ estimatedCredits: 1 });
  await rejectsCode(b.reconcile({ ...r, accountId: 'other' }, { last: 1, remaining: 99 }), 'BUDGET_RESERVATION_INVALID');
  await rejectsCode(b.reconcile({ ...r, id: 'invalid' }, { last: 1, remaining: 99 }), 'BUDGET_RESERVATION_INVALID');
});


test('mock: a zero-row accounting write fails closed', async () => {
  const db = mockDatabase();
  const connect = db.connect.bind(db);
  db.connect = async () => {
    const client = await connect();
    const query = client.query.bind(client);
    client.query = async (sql, params) => sql.trim().startsWith('UPDATE provider_budget_accounts')
      ? { rows: [], rowCount: 0 } : query(sql, params);
    return client;
  };
  await rejectsCode(budget(db).reserve({ estimatedCredits: 1 }), 'BUDGET_STORAGE_INVALID');
  assert.equal(db.data.reservations.length, 0);
});

test('mock: fresh baseline uses one database clock observation after the account lock',async()=>{
  const db=mockDatabase();
  const state=await budget(db).status();
  assert.equal(state.ready,true);assert.equal(state.baselineCurrent,true);
  assert.equal(state.baselineMaxAgeSeconds,3600);
  const lock=db.queries.findIndex(q=>q.startsWith('SELECT remaining_credits'));
  const clock=db.queries.findIndex(q=>q.startsWith('SELECT to_char'));
  assert.ok(lock<clock);assert.match(db.queries[lock],/baseline_verified_at::text AS baseline_verified_at.*FOR UPDATE/);
  assert.equal((db.queries[clock].match(/clock_timestamp\(\)/g)||[]).length,1);
  assert.match(db.queries[clock],/isfinite/);assert.match(db.queries[clock],/< \$2::bigint/);
});

test('mock: stale, exact-expiry, future, missing and invalid baselines cannot reserve or mutate accounting',async()=>{
  for(const baseline of ['2026-11-07T11:00:00Z','2026-11-07T10:59:59Z','2026-11-07T12:00:00.001Z',null,undefined,'invalid','infinity','-infinity']){
    const db=mockDatabase();db.data.account.baseline_verified_at=baseline;
    const before=structuredClone(db.data);
    const state=await budget(db).status();
    assert.equal(state.ready,false);assert.equal(state.reason,'BUDGET_BASELINE_NOT_CURRENT');
    await rejectsCode(budget(db).reserve({estimatedCredits:1}),'BUDGET_BASELINE_NOT_CURRENT');
    assert.deepEqual(db.data,before);
    assert.ok(!db.queries.some(q=>q.startsWith('INSERT')||q.startsWith('UPDATE')));
  }
  const fresh=budget(mockDatabase({baseline:'2026-11-07T11:00:00.001Z'}));
  assert.equal((await fresh.status()).ready,true);
  await fresh.reserve({estimatedCredits:1});
});

test('mock: freshness requires a boolean true database result',async()=>{
  for(const result of [null,'true','false',1,0,{},[]]){
    const db=mockDatabase();db.baselineResult=result;
    assert.equal((await budget(db).status()).ready,false);
    await rejectsCode(budget(db).reserve({estimatedCredits:1}),'BUDGET_BASELINE_NOT_CURRENT');
    assert.equal(db.data.reservations.length,0);
  }
});

test('mock: baseline age requires an explicit positive safe integer and invalid policy performs no admission SQL',async()=>{
  for(const baselineMaxAgeSeconds of [null,0,'0','', ' ', -1,1.1,Infinity,NaN,true,'1e3','12x','3600\n','3600\r','3600\u2028',Number.MAX_SAFE_INTEGER+1]){
    const db=mockDatabase(),b=budget(db,{baselineMaxAgeSeconds});
    await rejectsCode(b.reserve({estimatedCredits:1}),'BUDGET_BASELINE_POLICY_REQUIRED');
    assert.equal(db.queries.length,0);
    const state=await b.status();assert.equal(state.ready,false);
    assert.equal(state.reason,'BUDGET_BASELINE_POLICY_REQUIRED');
  }
  assert.equal((await budget(mockDatabase(),{baselineMaxAgeSeconds:'3600'}).status()).ready,true);
});

test('mock: expiry while waiting for the account lock is checked at admission time',async()=>{
  const db=mockDatabase(),connect=db.connect.bind(db);
  let entered,release;const locked=new Promise(r=>{entered=r;}),waiting=new Promise(r=>{release=r;});
  db.connect=async()=>{const client=await connect(),query=client.query.bind(client);
    client.query=async(sql,args)=>{const result=await query(sql,args);
      if(sql.startsWith('SELECT remaining_credits')){entered();await waiting;}
      return result;};return client;};
  const attempt=budget(db).reserve({estimatedCredits:1});
  await locked;db.now+=3600000;release();
  await rejectsCode(attempt,'BUDGET_BASELINE_NOT_CURRENT');
  assert.equal(db.data.reservations.length,0);assert.equal(db.data.account.remaining_credits,100);
});

test('mock: expired or invalid baseline policy never blocks reconciliation or refreshes baseline age',async()=>{
  for(const baselineMaxAgeSeconds of [null,0,'',-1,1.5,3600]){
    const db=mockDatabase(),r=await budget(db).reserve({estimatedCredits:2});
    db.now+=86400000;db.day='2026-11-08';db.data.account.baseline_verified_at='infinity';
    db.queries.length=0;
    await budget(db,{baselineMaxAgeSeconds}).reconcile(r,{last:5,remaining:90});
    assert.equal(db.data.account.remaining_credits,90);assert.equal(db.data.reservations[0].charged_credits,5);
    assert.equal(db.data.reservations[0].reconciled,true);
    assert.equal(db.data.account.baseline_verified_at,'infinity');
    assert.ok(!db.queries.some(q=>q.includes('baseline_verified_at')||q.includes('baseline_current')));
  }
});

test('mock: rejected baseline admission never reaches the provider',async()=>{
  const {createOddsSource}=await import('../src/odds.mjs');
  let calls=0;
  for(const options of [{baselineMaxAgeSeconds:null},{}]){
    const source=createOddsSource({apiKey:'OFFLINE_FIXTURE_ONLY',
      budgetStore:budget(mockDatabase({baseline:'2026-11-01T00:00:00Z'}),options),
      fetchImpl:async()=>{calls++;throw Error('must not fetch');}});
    await assert.rejects(source.getOdds('americanfootball_nfl','h2h',{allowPaid:true}),e=>/^BUDGET_BASELINE_/.test(e.code));
  }
  assert.equal(calls,0);
});
