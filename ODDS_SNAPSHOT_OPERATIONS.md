# Private odds persistence: preparation, not activation

This change adds an injected PostgreSQL snapshot adapter and a pure bounded-refresh
planner. Neither is configured by environment variables or wired to production.
There is no new route, timer, workflow, migration execution, provider request,
credential change, purchase, or database provisioning. Existing credit-ledger and
operator gates remain authoritative. The planner's `eligible` result is **not**
authorization or a budget reservation.

## What is implemented

- Optional `snapshotStore` injection into `createOddsSource`; default `null`.
- Latest privately retained observation per account/sport/market, parameterized SQL,
  strict allowlisted payload, maximum 1,000 events / 5 MB, monotonic write time.
- A restarted instance may restore only a snapshot still inside the existing cache
  TTL. Original observation and bookmaker timestamps remain unchanged. Restoring
  never seeds provider quota or makes a network provider request.
- Cache-only public reads still fail with `PAID_REFRESH_REQUIRED` when no fresh
  observation exists. Scores are not persisted. No stale quote is labeled live.
- A database write failure does not discard a successfully obtained in-memory
  response; health exposes `SNAPSHOT_WRITE_FAILED`, not a durability claim.
- Pure NFL three-market planning: explicit opt-in, minimum five-minute spacing,
  bounded pregame window, cycle cap, daily credits and minimum reserve. Cost is
  conservatively three credits; actual budget ledger accounting remains required.

## Required before activation (separate reviewed change)

1. Verify live Render and GitHub key account identity without exposing keys.
   GitHub's 454 remaining / 46 used / last 0 observation is not proof of Render's
   quota, subscription price, reset date, or authorization to spend those credits.
2. Select dedicated private BETQ durable storage, confirm retention/licensing,
   availability, backup, and cost. Do not use the other project's database that
   expires November 27. Obtain any required purchase approval first.
3. Apply `migrations/odds-snapshots.sql` only on that approved database. Use a
   restricted application role, verified TLS (`verifiedPostgresOptions`), and
   bounded pool/connect/query/lock timeouts. No schema creation on app startup.
4. Explicitly configure and test the existing durable budget ledger plus operator
   authentication. Establish account-bound, fresh quota observation through its
   supported baseline procedure, never from persisted snapshots or a guessed
   monthly reset. Choose approved cycle/daily caps and reserve.
5. Implement one account-scoped, durable scheduler lease and durable cycle count
   before any automatic refresh. The pure planner is not distributed locking.
   Record attempt time before provider access, retain budget reservation on
   uncertain completion, do not retry unknown failures automatically, and use
   the existing `reserve`/`reconcile` path for each request. Stop on quota/storage
   error. Avoid deployment/restart catch-up bursts. Operator and scheduler must
   share accounting; no second provider client bypassing `createOddsSource`.
6. Wire adapter via a reviewed disabled-by-default configuration. Verify actual
   PostgreSQL restart/concurrency behavior and exact source scope in staging.
   This preparation was tested with injected database doubles, not a real DB.
7. Separately design an explicitly **last known, not current** display if desired.
   Do not extend the five-minute fresh TTL simply to fill the app. Keep old prices
   out of active EV/pick calculations. Frozen forecasts/results remain untouched.

## Economics to decide, not defaults to activate

Three single-market NFL calls cost up to three credits per full cycle. At 12
credits/day, only four full cycles fit. Continuous five-minute cycles would use
up to 36 credits/hour. Pregame windows, scheduled games, and explicit approved
caps should determine cadence; never treat “454 remaining” as a spending target.

## Verification

Offline tests cover strict schema/account binding, parameterized monotonic writes,
restart restoration without provider/ledger access, stale/future/missing/error
reads, private write failure, disabled and bounded plans. Existing checks and
full test suite must pass before a draft PR is considered for review. Production
activation and real-DB integration tests remain unperformed.

## Provider timestamp compatibility

The [provider's v4 guide](https://the-odds-api.com/liveapi/guides/v4/#more-info-1)
deprecates bookmaker-level `last_update` in favor of market-level `last_update`.
Storage accepts market-only timestamps, or the legacy bookmaker-only shape,
and preserves each supplied timestamp separately from BETQ's `receivedAt`.
Every supplied timestamp must be canonical and no later than the receipt; at
least one provider timestamp must exist. Neither is copied into the other.
Stale provider timestamps may be retained but are not refreshed by receipt or
restore. Both the price scanner (moneyline, spread and total) and NFL consensus
require a valid, fresh market-level timestamp. HTTP analysis also binds it to
the original receipt and rejects absent, future or preceding receipts. Storing a
legacy book-only payload does not qualify it for displayed quotes or scoring.
Legacy raw records remain unchanged; they are not repaired by inferred times.
Compatibility tests use documented-shape synthetic payloads and injected SQL
responses. They do not establish the actual account payload, production
activation, or hosted database availability.

## Prepared production wiring (disabled by default)

`configuredOddsSnapshotStore` is the default `createOddsSource` snapshot factory.
Only `BETQ_ODDS_SNAPSHOTS_ENABLED=true` opts in; absent or exact `false` returns no
adapter and loads no PostgreSQL driver. Other values fail closed with a sanitized
configuration diagnostic. Explicit `snapshotStore:null` still disables injection.

When enabled, `BETQ_ODDS_SNAPSHOT_DATABASE_URL` must be a query-free TCP PostgreSQL
URL accepted by `verifiedPostgresOptions`. There is no automatic credential fallback
or URI parameter stripping. A reviewed Neon connection URI must have its known
provider query options removed separately; the driver always verifies certificate
and hostname through explicit TLS options. `BETQ_BUDGET_ACCOUNT_ID` is the sole
snapshot account scope. This does not seed or enable the budget ledger.

The shared pool is lazy: snapshot reads/writes, not health, instantiate it. It has
at most 3 clients, a 3-second connection timeout, 5-second query/statement timeouts,
3-second lock timeout and 10-second idle timeout. `allowExitOnIdle` prevents idle
snapshot clients keeping an otherwise closed process alive. Existing idle-error
handling is reused; failed initialization may be retried by a later operation,
never by an automatic provider retry. There are no migrations or scheduler calls.

Before enabling: migrate only the approved snapshot database, verify restricted
role grants and real TLS, then test the configured HTTP path and restart against
isolated hosted staging. Budget baseline, operator authentication, explicit caps
and scheduler coordination remain independent rollout gates. Snapshot health
configuration is not evidence the DB is reachable. Five-minute stale data still
cannot become current quotes. This preparation changes no Render variables and
makes no provider requests.
