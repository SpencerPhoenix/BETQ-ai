import { randomUUID } from 'node:crypto';
import {guardPostgresClient} from './postgres-security.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
const accountPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
// Share one exact-string account identity contract between configuration and admission.
export function isProviderBudgetAccountId(value) {
  return typeof value === 'string' && accountPattern.exec(value)?.[0] === value;
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProviderBudgetError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'ProviderBudgetError';
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => { throw new ProviderBudgetError(code, message, status); };
// Do not coerce blanks, booleans, null, negative values or fractions into permission.
function integer(value) {
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function storedInteger(value) {
  const n = integer(value);
  if (n === null) fail('BUDGET_STORAGE_INVALID', 'Provider budget storage is invalid. Paid requests are disabled.');
  return n;
}
function wroteOne(result) {
  if (result?.rowCount !== 1) fail('BUDGET_STORAGE_INVALID', 'Provider budget storage did not persist the required accounting change.');
}
function add(a, b) {
  if (a > MAX - b) fail('BUDGET_STORAGE_INVALID', 'Provider budget accounting exceeds the safe range.');
  return a + b;
}

/** PostgreSQL-backed budget. Pool is injected; this module never loads credentials or migrates. */
export function createProviderBudget({
  pool,
  accountId = process.env.BETQ_BUDGET_ACCOUNT_ID,
  dailyCreditCap = process.env.ODDS_DAILY_CREDIT_LIMIT === undefined ? 12 : process.env.ODDS_DAILY_CREDIT_LIMIT,
  reserveCredits = process.env.ODDS_MIN_CREDITS_RESERVE === undefined ? 50 : process.env.ODDS_MIN_CREDITS_RESERVE,
  baselineMaxAgeSeconds = process.env.BETQ_BUDGET_BASELINE_MAX_AGE_SECONDS
} = {}) {
  const cap = integer(dailyCreditCap);
  const floor = integer(reserveCredits);
  const parsedMaxAge = integer(baselineMaxAgeSeconds);
  const maxAge = parsedMaxAge !== null && parsedMaxAge > 0 ? parsedMaxAge : null;
  const configured = isProviderBudgetAccountId(accountId)
    && cap !== null && floor !== null && pool && typeof pool.connect === 'function';

  function checkConfig() {
    if (!configured) fail('BUDGET_CONFIG_INVALID', 'A valid durable provider budget configuration is required.');
  }
  async function transaction(work) {
    checkConfig();
    let client,guard;
    try {
      client = await pool.connect();
      guard=guardPostgresClient(client);
      await client.query('BEGIN');
      // Bound lock waits. A blocked or unavailable database must not authorize spending.
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await work(client);
      await client.query('COMMIT');
      guard.assertHealthy();
      return result;
    } catch (error) {
      if(guard)await guard.rollback();
      if (error instanceof ProviderBudgetError && !guard?.failed) throw error;
      guard?.markFailed();
      // Do not expose connection details, SQL, credentials or arbitrary database errors.
      fail('BUDGET_STORAGE_UNAVAILABLE', 'Durable provider budget storage is unavailable. Paid requests are disabled.');
    } finally {
      if(guard){
        try{guard.release();}
        catch{fail('BUDGET_STORAGE_UNAVAILABLE','Durable provider budget storage is unavailable. Paid requests are disabled.');}
      }
    }
  }
  async function accountState(client, { checkBaseline = true } = {}) {
    const account = await client.query(`SELECT remaining_credits, daily_credit_limit, minimum_reserve${checkBaseline ? ', baseline_verified_at::text AS baseline_verified_at' : ''}
      FROM provider_budget_accounts WHERE account_id = $1 FOR UPDATE`, [accountId]);
    if (account.rows.length !== 1) fail('BUDGET_BASELINE_REQUIRED', 'An operator must seed a verified provider quota baseline before paid requests.');
    const row = account.rows[0];
    if (row.remaining_credits === null) fail('BUDGET_BASELINE_REQUIRED', 'A verified provider quota baseline is required.');
    const remaining = storedInteger(row.remaining_credits);
    const limit = Math.min(cap, storedInteger(row.daily_credit_limit));
    const minimum = Math.max(floor, storedInteger(row.minimum_reserve));
    // Obtain the day AFTER acquiring the account lock, using the database clock.
    // Freshness is an admission policy, never a reason to abandon accounting for an existing request.
    // Sample the database clock once, after the account lock, and compare timestamps in PostgreSQL.
    const dayResult = checkBaseline ? await client.query(`SELECT to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS utc_day,
      CASE WHEN $1::timestamptz IS NULL OR NOT isfinite($1::timestamptz) THEN FALSE
        ELSE $1::timestamptz <= checked_at
          AND EXTRACT(EPOCH FROM (checked_at - $1::timestamptz)) < $2::bigint END AS baseline_current
      FROM (SELECT clock_timestamp() AS checked_at) AS budget_clock`, [row.baseline_verified_at, maxAge])
      : await client.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS utc_day");
    const day = dayResult.rows[0]?.utc_day;
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) fail('BUDGET_STORAGE_INVALID', 'Invalid budget accounting day.');
    const usage = await client.query(`SELECT COALESCE(SUM(charged_credits) FILTER (WHERE utc_day = $2::date), 0)::text AS used,
      COUNT(*) FILTER (WHERE reconciled_at IS NULL)::text AS unresolved
      FROM provider_budget_reservations WHERE account_id = $1`, [accountId, day]);
    const baselineCurrent = checkBaseline ? maxAge !== null && dayResult.rows[0]?.baseline_current === true : null;
    const used = storedInteger(usage.rows[0]?.used);
    const unresolved = storedInteger(usage.rows[0]?.unresolved);
    return { utcDay: day, used, limit, availableCredits: Math.max(0, limit - used),
      minimumProviderCredits: minimum, providerRemaining: remaining, persistent: true,
      available: true, unresolvedReservations: unresolved, baselineCurrent, baselineMaxAgeSeconds: maxAge,
      ready: unresolved === 0 && (!checkBaseline || baselineCurrent) && used < limit && remaining > minimum,
      reason: unresolved > 0 ? 'BUDGET_OUTCOME_UNKNOWN'
        : checkBaseline && maxAge === null ? 'BUDGET_BASELINE_POLICY_REQUIRED'
        : checkBaseline && !baselineCurrent ? 'BUDGET_BASELINE_NOT_CURRENT'
        : used >= limit ? 'API_DAILY_BUDGET' : remaining <= minimum ? 'PROVIDER_CREDIT_RESERVE' : null };
  }
  return {
    async status() {
      return transaction(accountState);
    },
    async reserve({ estimatedCredits } = {}) {
      checkConfig();
      if (cap === 0) fail('API_DAILY_BUDGET', 'Paid provider requests are disabled by the configured daily credit limit.', 429);
      if (maxAge === null) fail('BUDGET_BASELINE_POLICY_REQUIRED', 'An explicit positive maximum baseline age is required before paid requests.');
      const estimate = integer(estimatedCredits);
      if (estimate === null || estimate === 0) fail('BUDGET_ESTIMATE_INVALID', 'A positive integer upper-bound credit estimate is required.');
      return transaction(async client => {
        const state = await accountState(client);
        if (state.unresolvedReservations > 0) fail('BUDGET_OUTCOME_UNKNOWN', 'An unresolved provider request blocks further spending. Reconcile it before retrying.', 503);
        if (!state.baselineCurrent) fail('BUDGET_BASELINE_NOT_CURRENT', 'The provider quota baseline is not current. Operator verification is required before paid requests.');
        if (estimate > state.availableCredits) fail('API_DAILY_BUDGET', 'Daily provider credit budget reached.', 429);
        if (state.providerRemaining < estimate || state.providerRemaining - estimate < state.minimumProviderCredits) {
          fail('PROVIDER_CREDIT_RESERVE', 'The request would cross the provider credit reserve.', 429);
        }
        const id = randomUUID();
        wroteOne(await client.query(`INSERT INTO provider_budget_reservations
          (id, account_id, utc_day, estimated_credits, charged_credits)
          VALUES ($1::uuid, $2, $3::date, $4, $4)`, [id, accountId, state.utcDay, estimate]));
        wroteOne(await client.query(`UPDATE provider_budget_accounts SET remaining_credits = remaining_credits - $2,
          updated_at = clock_timestamp() WHERE account_id = $1`, [accountId, estimate]));
        return Object.freeze({ id, accountId, utcDay: state.utcDay, estimatedCredits: estimate });
      });
    },
    async reconcile(reservation, quota) {
      checkConfig();
      if (!reservation || reservation.accountId !== accountId || !uuidPattern.test(reservation.id ?? '')) {
        fail('BUDGET_RESERVATION_INVALID', 'A reservation for this provider account is required.');
      }
      // Unknown outcomes are retained indefinitely, including malformed/missing headers.
      const last = integer(quota?.last);
      const remaining = integer(quota?.remaining);
      if (last === null || remaining === null) return { reconciled: false, retained: true };
      return transaction(async client => {
        const state = await accountState(client, { checkBaseline: false });
        const result = await client.query(`SELECT estimated_credits, charged_credits FROM provider_budget_reservations
          WHERE id = $1::uuid AND account_id = $2 FOR UPDATE`, [reservation.id, accountId]);
        if (result.rows.length !== 1) fail('BUDGET_RESERVATION_INVALID', 'The reservation does not exist for this account.');
        const estimate = storedInteger(result.rows[0].estimated_credits);
        const charged = storedInteger(result.rows[0].charged_credits);
        if (estimate === 0 || charged < estimate) fail('BUDGET_STORAGE_INVALID', 'Invalid reservation accounting.');
        // Never refund estimated spend. Repeated or stale responses can only tighten limits.
        const newCharge = Math.max(charged, last);
        const extra = newCharge - charged;
        add(state.used, extra);
        const nextRemaining = Math.min(remaining, Math.max(0, state.providerRemaining - extra));
        wroteOne(await client.query(`UPDATE provider_budget_reservations SET charged_credits = $3,
          reconciled_at = clock_timestamp() WHERE id = $1::uuid AND account_id = $2`, [reservation.id, accountId, newCharge]));
        wroteOne(await client.query(`UPDATE provider_budget_accounts SET remaining_credits = $2,
          updated_at = clock_timestamp() WHERE account_id = $1`, [accountId, nextRemaining]));
        return { reconciled: true, retained: true, chargedCredits: newCharge };
      });
    }
  };
}
