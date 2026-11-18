# Owner-only on-demand trial: disabled draft

This is a preparation build, not authorization to spend. It creates no accounts,
credentials, database rows, quota baselines, timers or scheduled jobs. No production
migration or activation is included. The existing one-time pilot remains closed.

## Trust boundary

`createHandler` accepts an explicit `ownerRefreshHandler`; without one,
`/api/owner/refresh` returns 404. No environment flag activates it. The boundary
module requires a trusted, server-side owner-session verifier, same-origin POST,
JSON, CSRF validation and an operation UUID. Request parameters never establish
owner identity. Do not put the existing operator bearer in browser JavaScript,
HTML, localStorage or a URL. The disabled owner-session adapter is described in `OWNER_SESSION_ADAPTER.md`.
Actual verified owner login and durable session/rate stores remain **release blockers**.

The trial store is an additional spending restriction, not a substitute for the
existing durable provider budget. Its policy must be explicitly provisioned
through separately approved operator tooling. Runtime must not seed accounts,
renew expiry, alter policy, reset counters or delete history. Existing provider
baselines and reservations are untouched. Pending/unknown operations block new
claims. A process restart does not authorize replay. Each attempt consumes at
least one trial credit conservatively, even if a cache hit costs zero upstream.
This avoids inventing refunds; report actual provider cost separately.

The supported scope is NFL, US region, one of moneyline/spreads/totals per request.
A future all-markets control must execute sequentially and stop on uncertainty.
No automatic retry, scheduler or authorization to place bets is provided.

## Receipts

Paid source responses carry an internal receipt binding successful reconciliation
and snapshot persistence to their reservation. This receipt is not added to the
public slate. HTTP 200 alone is insufficient. Missing quota headers, unresolved
provider accounting or failed snapshot persistence must leave a stopped attempt.
A cache hit is explicitly not a new provider observation.

## Saved data versus fresh data

The optional `/api/retained-odds-observation?market=h2h` route requires an injected
reader and account identity. It returns only a public-safe summary: teams,
provider-reported kickoff, bookmaker count and original observation/quote times.
It never returns raw bookmaker prices, credentials, quota, picks or stakes.
It remains nonactionable even within five minutes. After five minutes its label
says out of date. The existing fresh slate/TTL is unchanged. No fabricated data
or timestamp extension is used. A full owner UI with retained-price presentation
is **not delivered** by this draft; it needs separate UX and licensing review.

## Before any activation

1. Independently review migration, role grants, concurrency and authorization.
2. Run the disposable PostgreSQL 17 CI integration checks for real transaction
   races, caps, restart persistence, expiry and restricted privileges. These tests
   use synthetic localhost data and do not prove Neon network/TLS or crash recovery.
   Reverify the eventual restricted production role before activation.
3. Integrate a verified owner session, secure cookies/session expiry and CSRF
   delivery. Add owner-level abuse controls and test repeated tabs/devices.
4. Integrate an authenticated, fixed zero-credit probe with the exact runtime
   provider key. Never infer a renewal date or raise a baseline from stale logs.
5. Obtain concrete approval for total credits, daily cap, trial expiry, reserve,
   owner access and credential storage. Proposed initial policy: at most 36
   existing credits over seven days, at most 12 per UTC day, reserve at least 50.
   This proposal is not approval. Provider plan/dollar billing is unverified.
6. Apply only reviewed isolated schema and least-privilege runtime credentials;
   no owner role in the application. No unrelated Render environment overwrite.
7. Verify exact deployment, disabled behavior, first approved request receipts,
   restart/read-only recovery, and shutdown at cap/expiry. Preserve all records.

## Limits

The initial implementation covers a bounded trial, not reusable rolling monthly
budgets or recurring billing periods. Those need further design. Other consumers
of the same API key can spend externally; the app cannot guarantee their usage.
Provider costs must still be checked against the current official contract.
Render Free cold starts remain; database persistence does not promise instant
availability. Refreshing odds does not establish model accuracy or market edge.

## Rollback

Remove the injected handler and disable the policy. Keep pending/unknown rows,
provider reservations, actual quota baseline and original saved observations.
Never delete records or reseed a balance to make a retry pass.

When an owner handler is injected, legacy paid GET bearer requests are rejected
before source access, including scores. Thus an old operator credential cannot
bypass the additional trial ledger. Account-scoped operation IDs cannot be reused
for another market. Unexpected charges above the one-credit contract must be
recorded as unknown atomically, before any following claim can be admitted.
The explicit `configuredOwnerTrial` factory defaults disabled, accepts no ambient
environment, enforces verified TLS and bounded connections/timeouts, and does not
seed policy or run migrations. It remains unwired to production startup. Its unit
tests verify configuration; disposable PostgreSQL CI tests real store behavior
without claiming a new Neon TLS test.
