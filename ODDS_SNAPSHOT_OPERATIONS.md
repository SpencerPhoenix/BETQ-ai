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
