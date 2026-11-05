# Fixed pending-game Elo checkpoint, version 1

This is a pregame byte commitment and an operational validation trial. It is
not a betting recommendation, an accuracy result, or a claim of profitability.
No provider call, new forecast, settlement, model change, collection trigger,
or production integration is authorized by preparing this bundle.

## Membership and forecast choice

Freeze every pending upcoming game present in the exact source journal at
commit 607366752c0d32410caf23fc068335acb06f858e. There are 29 games. Use the earliest
existing Elo snapshot per game, ordered by canonical capture timestamp and then
raw snapshot ID. Freeze all 29 game IDs, snapshot IDs, probabilities, original
kickoffs, record hashes and cohort digest in manifest.json. Select no game by
its predicted advantage or later result. Do not replace forecasts with later
captures, add a later challenger, or add games to this closed cohort.

JAX at BAL is the first operational example because it is the next scheduled
game, with frozen kickoff November 6, 2026 at 01:15 UTC. It uses snapshot
1f4bc657f670fcd10bbff447: BAL probability 0.401566, captured November 2 at
01:07:26.939 UTC. Its derived market reference 0.239418 is that historical
snapshot's comparator, not current or executable odds. The first record has no
EPA challenger. The later 0.36465 challenger must not be attached to it.

Retain missing, cancelled, postponed and tied games in the cohort accounting.
Do not substitute another game or rewrite the original kickoff. Any subsequent
schedule change, source correction or outcome record requires a separately
retained observation. A binary outcome score excludes ties, never relabels them.
Never count multiple revisions or snapshots as multiple games.

## Inference and provenance

Archive the exact already-public derived journal bytes and both historical Elo
models/scorers needed for these forecasts, including the evening scorer's
integrity helper. Bind every file by SHA-256. Reproduce all 29 rounded Elo
probabilities at their original capture clocks with mapped home/away names and
frozen kickoff; omit neutralSite, matching the scorer's default false behavior.
This is compatible inference reconstruction from frozen model parameters. The
original event payload and actual deployed scorer are not archived or verified;
neutral-site input authenticity and training reproducibility are not established.
Raw market quotes are unavailable, so the derived market reference cannot be
independently rebuilt. Never bind today's model to an old prediction.

Existing GitHub run receipts support that the source bytes were public before
kickoff. They do not prove the exact first publication time or authenticate the
underlying provider data. This new plan is not predeclared merely because an
older forecast was published earlier.

## Publication gate

The complete bundle, including this plan, manifest, verifier and all pinned
inputs, must have a separately verified GitHub server-timestamped successful
run bound to its exact published commit before the EARLIEST frozen kickoff,
2026-11-06 01:15 UTC. A client-generated preparedAt or a self-authored commit date
is not publication proof. Keep the original manifest unchanged and retain the
receipt separately. Retrieve receipt metadata directly from GitHub; a local
JSON file passing structural validation does not authenticate its contents.

If publication misses the deadline, do not call this a pregame checkpoint,
backdate it, remove JAX, or silently create a smaller cohort under the same ID.
A new cohort needs a new version, new membership and publication before its own
games. Do not repeat this trial ID or treat duplicate publication as new data.
GitHub history and retained receipts are useful public evidence, not WORM storage
or a guaranteed permanent archive. Retain verified copies in any later approved
archive without changing original bytes.

## Outcomes and claims

This checkpoint adds zero qualifying outcomes and does not alter the existing
settlement gate or metrics. Source independence remains unverified. Any future
BALLDONTLIE/nflverse check needs its own authorization and remains
CROSS_CHECKED_INDEPENDENCE_UNVERIFIED, outside the qualifying settlement journal.
Do not pool this checkpoint with the two prior raw outcomes or historical
backtests. Do not promote a model, claim ROI/CLV, or authorize wagers.

The fixed cohort has only 29 games and cannot itself satisfy the existing
30-qualified-game aggregate reporting threshold. Additional research cohorts
must be declared prospectively, with any pooling analysis specified before
examining their outcomes. One matching score, a favorable game or reproduced
probability does not demonstrate calibration, forecasting advantage or profit.
