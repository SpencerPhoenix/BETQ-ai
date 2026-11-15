# Durable provider credit ledger

`src/provider-budget.mjs` is a PostgreSQL-backed admission gate, not a payment or provider client. It does not create a pool, load database credentials, issue provider requests, migrate a database or infer quota. All runtime callers must use the same database and nonsecret account identity for a provider account, and must await a successful reservation commit **before** issuing any paid request. Never use a provider API key as the account identity.

## API

```js
const budget = createProviderBudget({
  pool,                         // configured pg.Pool, supplied by the server
  accountId: 'odds-main',        // nonsecret operator-assigned identity
  dailyCreditCap: 12,
  reserveCredits: 50
});
const reservation = await budget.reserve({ estimatedCredits: 2 });
// Only now may the caller issue the explicitly authorized provider request.
// Read quota headers only from that matching provider response.
await budget.reconcile(reservation, { last: 2, remaining: 198 });
const status = await budget.status();
```

Reservations contain `id`, `accountId`, `utcDay` and `estimatedCredits`. The ledger trusts the stored reservation, not caller-supplied estimates when reconciling. Status includes `persistent`, `available` (storage accessible), `ready` (no unresolved request and at least one credit admissible), `reason`, `utcDay`, `used`, `limit`, `availableCredits`, `minimumProviderCredits`, `providerRemaining` and `unresolvedReservations`. `ready` is not permission to call the provider; the atomic `reserve` is always required and may reject a larger estimate. Storage/configuration/baseline errors throw a sanitized `ProviderBudgetError`; callers must represent them as unavailable/not ready, not fall back to a process-local counter.

Absent environment settings default to daily cap 12 and reserve 50. Explicit zero cap disables paid requests. Malformed settings, blanks, fractions, negatives, unsafe integers, nulls and booleans disable admission. Decimal integer strings are accepted. `BETQ_BUDGET_ACCOUNT_ID` is the default identity setting; credit settings are `ODDS_DAILY_CREDIT_LIMIT` and `ODDS_MIN_CREDITS_RESERVE`. The parent application owns pool configuration. Neither secrets nor provider URLs are persisted in this ledger.

The effective daily cap is the smaller of the process setting and the operator's stored `daily_credit_limit`. The effective reserve is the larger of the process setting and stored `minimum_reserve`. There is no clamp that lowers a large operator reserve.

## Atomicity and unknown outcomes

Each operation starts a transaction and locks the account row `FOR UPDATE`. Reservation checks, immutable reservation insertion and provider remaining decrement occur under that lock. The database clock supplies the UTC accounting day after lock acquisition. Daily use is derived from durable reservations. A restart does not reset anything.

**Only one unresolved request is permitted per account, even across UTC days.** A pending reservation, crash, timeout, failed response or missing/malformed quota blocks the next reservation with `BUDGET_OUTCOME_UNKNOWN`. No timeout, retry, new day or process restart automatically releases it. This prevents unknown charges beyond an estimate from silently permitting further requests.

`reconcile` requires nonnegative safe integer `last` and `remaining` fields. Invalid or absent fields return `{reconciled:false, retained:true}` without clearing the unresolved marker. Valid reconciliation records at least the reserved estimate, increases accounting for a larger reported charge, and never refunds daily usage. Remaining credits can only decrease, including on repeated or out-of-order observations. Low charge responses and duplicate reconciliation cannot reopen spent budget. The unused `used` provider header is not trusted for authorization.

This is intentionally conservative. Operator reconciliation is necessary after a crash or unknown outcome. Provider-cycle resets and top-ups never automatically raise local remaining. A charge larger than the estimate can exceed the configured daily cap for the already-issued request; no system can retroactively prevent that charge. Use a credible upper-bound estimate for each endpoint, and block further calls when exhausted. Charges are attributed to the UTC day of reservation, not completion; an overnight response does not reset provider accounting.

## Offline operator setup and recovery

1. Apply `sql/provider-budget.sql` explicitly with an operator-controlled database connection. It is a one-time migration and intentionally not automatically executed or silently skipped by HTTP requests.
2. Obtain a verified remaining balance using an already-authorized non-billable source or the provider account dashboard. Do not make a paid request merely to discover quota. If unknown, leave the account absent or `remaining_credits` NULL; admission remains blocked.
3. Seed one account row with the nonsecret identity, verified remaining balance, daily cap, reserve floor and verification timestamp. No baseline is included in the migration. Example values below are illustrative, not a verified account balance:

```sql
INSERT INTO provider_budget_accounts
  (account_id, remaining_credits, daily_credit_limit, minimum_reserve, baseline_verified_at)
VALUES ('odds-main', 200, 12, 50, clock_timestamp());
```

4. Scope the runtime database role to the necessary SELECT/INSERT/UPDATE operations on these tables. Do not give the runtime role migration, account seeding, ledger deletion or baseline-reset responsibilities. Configure a finite pool connection timeout; SQL lock and statement waits are also bounded by the module.
5. For unknown-outcome recovery, stop **all** callers for the provider account, wait until upstream outcomes can be established, and independently verify actual charges and remaining balance. In an operator transaction locking the account row, conservatively repair the affected reservations and only then mark them reconciled. If charge remains unknown, keep the account blocked. Keep existing daily charges and record the operator's evidence outside this runtime ledger. Do not delete reservations or lower charges to obtain budget headroom.
6. For a verified quota renewal/top-up, likewise quiesce all callers before raising the baseline under the account lock and refreshing `baseline_verified_at`. Do not reset daily accounting or clear unresolved outcomes as a side effect. Runtime response headers can never raise the baseline.

All spending against this provider account must use this gate. Manual provider activity, another application, or a different identity/database can consume credits outside this ledger. The ledger cannot guarantee a reserve against such external spending; use a dedicated provider account or require every consumer to share accounting. Offline baseline seeding and recovery are operator procedures, not public endpoints. No automated seeding/recovery CLI is included in this change.

## Verification scope

`node --test tests/provider-budget.test.mjs` exercises configuration, admission, reserve floors, SQL sequencing, unresolved outcomes, rollback handling, reconciliation monotonicity and shared-state behavior using an explicitly labeled SQL protocol simulator. The simulator serializes transactions; it is **not evidence of PostgreSQL concurrency or crash durability**.

Isolated real PostgreSQL 17.11 integration was completed on 2026-11-07 after transport/error-handling fixes. See [the transport review](POSTGRES_TRANSPORT_REVIEW.md) for exact results and limits. Production configuration still needs separate verification. The isolated checks covered:

- two separate pools/processes competing for the same row, with only one unresolved request admitted;
- kill/restart after committed reservation, plus uncertain COMMIT outcomes;
- storage disconnect, permission denial and lock timeout with zero upstream requests;
- concurrent reconciliation and reserve, malformed/missing quota, and unresolved reservations surviving midnight;
- cap/floor policy, explicit offline seeding/recovery and a provider-cycle reset without clearing charges;
- migration compatibility, runtime least-privilege grants and rejection of a missing/malformed schema.

No real database, provider account, paid request, deployment, publication or credential operation is part of the mock tests.

## PostgreSQL transport hardening

`verifiedPostgresOptions` parses the configured TCP PostgreSQL URL into explicit host, port, database and optional user/password fields. It never passes a `connectionString` to the driver. All URL query and fragment options are rejected, including `sslmode=disable`, `sslmode=no-verify`, `ssl=0`, certificate-file options and libpq compatibility flags. Encoded Unix-socket hosts are also rejected. The driver receives `ssl.rejectUnauthorized=true` and fixed PostgreSQL TLS negotiation; hostname and certificate-chain verification stay enabled. URI parsing errors are sanitized before diagnostics.

This rule applies to the budget pool, private shadow runtime pool and private CLI. Any deployment URL requiring correction must be reviewed and configured separately; this code change does not change an account, secret, CA trust store or production connection. Trusted-CA integration fixtures use process-local test trust only.

Pools handle idle-client error events so a dropped idle connection cannot terminate the process. The handler does not retry transactions, refund reservations or authorize requests. Every subsequent admission still has to establish a connection and commit its durable checks; outages and uncertain outcomes continue to fail closed.

Checked-out clients have a separate transaction-scoped error guard, since PostgreSQL can report active-client errors independently of the pool. Observed connection failure around COMMIT never returns permission to spend. Failed clients are discarded rather than reused, late error events remain handled, and uncertain committed reservations remain unresolved. No automatic retry is performed after a lost COMMIT acknowledgement. The same guard covers private shadow capture transactions.

The forced native-driver mode (`NODE_PG_FORCE_NATIVE`) is rejected. The hardened path and its verification apply to the locked JavaScript pg driver; an untested native/libpq path cannot inherit weaker environment SSL behavior.

### Database privilege boundary

The isolated least-privilege test rejected DDL, new-account seeding, deletion and account-policy updates. However, grants allowing the runtime to update `remaining_credits` also allow arbitrary direct SQL to increase that column; grants alone do not enforce monotonicity. Monotonicity and reservation rules are enforced by this application, not a tamper-resistant database API. A runtime able to issue arbitrary SQL can violate application accounting rules. Stronger database-side enforcement would require separately reviewed triggers or restricted stored procedures, migration and role design. No such enforcement or production permission change is claimed here.
