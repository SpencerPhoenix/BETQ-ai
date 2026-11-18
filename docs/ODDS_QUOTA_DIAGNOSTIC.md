# Manual zero-credit odds quota diagnostic

The workflow **BETQ zero-credit odds quota diagnostic** runs only by manual dispatch.
It uses an already-configured repository `ODDS_API_KEY` secret, if present. A key
configured only in Render is not automatically available in GitHub. Do not paste
credentials into workflow inputs, issues, logs or chat. Missing credentials stop
before a network call. No secrets or settings are created by this change.

The script makes one GET to the fixed `https://api.the-odds-api.com/v4/sports/`
endpoint using the `x-api-key` header, rejects redirects, times out after ten
seconds, does not read response bodies and emits only allowlisted usage counters.
No odds, score, historical or payment endpoint is called. No budget baseline is
seeded, renewed or raised. No deployment is triggered. Provider errors are sanitized.

Official provider reference, checked November 18, 2026:
https://the-odds-api.com/liveapi/guides/v4/#get-sports
Documents this endpoint as quota-free and its remaining/used/last response headers.
The response does not identify the subscription price, plan or billing renewal
 date. Do not infer those from the counters. The `last` header is displayed as
reported; documented zero endpoint cost is not independently measured billing.

## Economics and operational constraints

The provider documents a normal odds request as one credit per region per market:
https://the-odds-api.com/liveapi/guides/v4/#usage-quota-costs-1
For NFL US moneyline, spread and total, budget three credits per complete refresh
cycle. The current app requests each market separately. Twelve daily credits
would permit only four such cycles (absent other usage), not continuous live data.
A hypothetical five-minute cadence for all three markets costs up to 36 credits
per hour. These are arithmetic scenarios, not authorization or a recommended plan.

BETQ's default odds cache is memory-only with a five-minute lifetime. Durable
budget accounting does not make that cache durable. A restart erases prices;
expired prices must not become fresh because the UI needs content. A useful
production design needs persistent private snapshots with original timestamps,
a labeled last-known state, and a separately approved bounded refresh cadence.

Before any chargeable refresh: confirm available quota and account consumers;
configure a durable PostgreSQL ledger and restricted runtime role; explicitly
set daily cap, reserve and baseline freshness policy; seed verified quota through
the operator procedure; configure operator authentication; and verify readiness.
Existing capture workflows may share the account and must share the same ledger.
Any timeout/unknown charge must stay blocked pending reconciliation.

This workflow intentionally does not enable any of those paid actions. An
observation is not an authorization, proof of prediction quality or proof of plan.
