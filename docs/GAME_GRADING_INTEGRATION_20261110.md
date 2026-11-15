# Game grading integration, 2026-11-10

Local integration combines retained game grading commit `6a75f73`, per-game evaluation
commit `932ef886` (cherry-picked as `ebda3e3`), and exact latest-main data at
`589223ad986199695415c199244d1a02cfdc1c40`.

Main was checked before and after data materialization. GitHub comparison against
candidate data base `9157f19` showed only two changed paths. These were materialized
without regeneration and verified against GitHub Git blob IDs:

- data/nfl_elo.json: f1896c0fb3e6a9d841bce9b9e2362d7b93f2913a
- data/nfl_injuries.json: 6d9b2c9857d7bbdef6f3aaf1b6a477a6f74ac41a

All other data, journal records, workflows, lockfile and Render configuration remain
unchanged from the preserved candidate. No historical predictions were reconstructed.
Two test-only clocks now derive fresh/stale dates from artifact metadata rather than
fixed calendar dates that automated data refreshes can overtake. Production freshness
checks are unchanged.

Combined validation: 1,000 offline tests passed, 0 failed/skipped; package syntax
checks and git diff --check passed. New UI tests exercise real backend compatibility,
null version metadata, ties, missing metrics, quarantined rows and stale response
ordering. Browser visual QA remains unavailable because Chromium cannot create its
process-singleton socket in this environment (reported by the evaluation worker).

Retained coverage: 31 games, 16 recorded outcomes, 15 pending results, 0 qualified
grades. The 16 outcomes remain ungraded rather than receiving invented source receipts.
This inventory is not league-wide coverage. No model improvement or betting edge is
claimed. No publication, merge, deployment, database setting, provider refresh or
paid operation was performed.
