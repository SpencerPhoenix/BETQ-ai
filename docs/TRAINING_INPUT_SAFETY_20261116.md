# November 16 training input safety follow-up

## Shipped protection, not a claim of finality or improved accuracy

Both Elo and efficiency training now use `NFL_SCHEDULE_DELAYED_RESULTS_V1`.
It rejects recent score-bearing rows until 12 hours beyond the complete UTC game
date, explicit nonfinal/unknown status fields, conflicting duplicate game IDs,
invalid scores and unspecified venues. Historical input cleanup used by replay
and other offline studies is unchanged. Current artifact bytes and all retained
forecasts and grades are unchanged by this source release.

The 12-hour date embargo reduces same-day/in-progress leakage and prevents a
new build's date cutoff extending beyond its build time. It is **not** a verified
completion timestamp or independent final-status receipt. A postponed game with
old partial scores and absent status can still pass; resolving this requires an
identity-matched final-status receipt feed. That weakness remains open.

Newly trained artifacts carry the selection policy, excluded-row counts and
current-season per-team observed game counts/last dates. These describe source
coverage only, not proof that all completed games were ingested. Existing
artifacts lack this manifest until the next successful scheduled/manual build.
The unchanged schedule can leave the newest game outside the embargo until the
next run. No additional paid calls or automated refreshes were introduced.

Predictions explicitly flag missing venue as `HOME_ADVANTAGE_UNVERIFIED` and
state that venue-source verification, complete schedule coverage and independent
training finality have not been established. Numerical predictions are unchanged.
A caller-supplied venue boolean is not treated as an independent source receipt.
A verified game-identity-matched venue/coverage adapter remains necessary.

## Legacy read-only probe review

The market and phase-4 production probes now check the deployed package version
against the checked-out `package.json`, not obsolete 0.7.0/0.4.x literals. The
market UI version check follows that same value. Added checkout is read-only;
triggers, schedules, permissions, endpoints and secret scope are unchanged.
Workflow byte-hash baselines were deliberately updated after this diff review.
These version checks do not verify exact deployed commit identity.

## User interface

The selected game's dossier collapses unrelated quarantined-game evidence into
native accessible details, keeping exclusion counts visible and the full
history available. This does not hide or remove the selected game's source issue.
