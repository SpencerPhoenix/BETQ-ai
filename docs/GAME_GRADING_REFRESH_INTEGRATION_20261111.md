# Retained grading refresh integration, 2026-11-11

Local successor to `acea558`, including the independent read-only six-hour audit
from `714bd1e` (cherry-picked as `8596f56`). No publication or activation performed.

## Consistent reads

The grades endpoint now awaits the same validated, cached, coalesced public derived
journal refresh as the games, forecasts and evidence endpoints. Previously a concurrent
page load could leave grades showing one game while the game list showed two. This
change does not request odds, recompute forecasts, change qualification or write data.

Regression tests wait for both HTTP handlers to join a held refresh, then verify the
same two-game result and a single public-journal request. Invalid and failed refreshes
retain the same safe baseline in both views. Invalid queries and writes do not refresh.
The concurrency tests have explicit timeouts. The feed's existing append-only and
future-record rejection rules remain unchanged.

## Current data preservation

GitHub main was checked before and after materialization at
`41715b4151121514b65668fc96edc43968392910`. Its four commits since the candidate's
previous data base `589223ad986199695415c199244d1a02cfdc1c40` change only these five files.
Each was copied without regeneration and its Git blob ID verified:

- data/evidence/nfl-2026.json: c0e7711d6c431f4222fa088c205a5ca1bdc9fb0d
- data/evidence/summary.json: a9a6e147645d6a4b63141a076c6a64dd9c5e8b3d
- data/nfl_efficiency.json: 0a38648c68902121ede3e20b8b87509a7db6f5f9
- data/nfl_elo.json: 269e83349362ef3f25432392cb39c2812c4c02a4
- data/nfl_injuries.json: 19d33eb1fac5a0e28948f5f98a83d02114f96448

Journal SHA-256: `0d5699dfb4b52a78d6081339c216db1e185e83e5b5da104568f11562b6ad3420`.
All other data files remain unchanged. Bundled-data test counts were updated to the
new source inventory; a forecast test's clock now follows the latest retained record
rather than rejecting later data as future evidence. No production time gate changed.

## Verification and limits

- Full offline suite: 1,007 passed, zero failures/skips, with cleared environment.
- Package syntax checks and git diff --check passed.
- Independent focused review found no production correctness/security blocker;
  concurrency and rejected-request test improvements were applied.
- Offline audit reports 217 snapshots across 31 retained games, 17 raw outcomes,
  14 pending results, and zero qualified grades. One schedule-conflicted game remains
  quarantined. Public eligible projection is 30 games, 208 snapshots and 16 outcomes.
- All 17 outcomes stay ungraded; none receives an invented receipt or result.
- Existing GitHub review drafts #16–18 are older overlapping candidates, not this
  integration. No existing PR was changed and nothing was merged or deployed.
- Six-hour audit remains local, not an active schedule. It examines retained evidence;
  it does not independently obtain or certify game results or collector health.
- Browser/mobile visual QA has not been rerun. Earlier environment limitation remains
  separate from offline tests. No provider request, credit spend, database/configuration
  change, model promotion, profitability claim or wagering action was performed.

## Kickoff-revision edge-case review

A legitimate schedule revision is currently treated conservatively as unresolved
identity ambiguity; final receipts matching one observed kickoff do not themselves
explain or reconcile the conflicting frozen history. Removing kickoff from identity
would weaken pregame timing and receipt binding, so no production gate was relaxed.

The actual LV–SF retained record has seven 21:05 UTC snapshots (November 2–7) and two
21:25 UTC snapshots (November 8), all for the same provider event identifier and the
same 0.808528 model home probability. The first revised-time observation was captured
at 2026-11-08T17:13:38.309Z. Its sole recorded outcome is SF 38, LV 17, observed at
2026-11-09T00:55:06.471Z. That record has no terminal-status receipt, community-source
vintage binding or finality attestation. Consequently, removing the kickoff conflict
would not make this actual result source-qualified. No external source was consulted
to certify whether the schedule change was legitimate.

A new entirely synthetic regression covers receipts consistently matching either the
original or revised kickoff. Individual receipt qualification can pass against the
matching snapshot, but the conflicted game remains visibly quarantined and ungraded;
the first baseline and all bytes are preserved while an unrelated game still grades.
The grading plus schedule-quarantine focused suites passed 69/69 tests. A future safe
resolution would require an explicit provenance-backed schedule amendment that preserves
both original observations, retains the original forecast and validates pregame timing
against the reconciled event. Such a mechanism is not implemented or authorized by
this review, and matching final scores alone are insufficient.
