# Current-data integration, 2026-11-13

Local successor to reviewed candidate `147896b`, preserving exact upstream data at
`5819b6704835d0a17c8ae6e8dcc42b86c055fbe8`. GitHub main was checked before copying
and after running verification and remained at that revision. No publication,
workflow activation, deployment or provider operation was performed.

The comparison from prior data base `41715b4151121514b65668fc96edc43968392910`
contains four upstream commits changing only these three files. They were copied
without regeneration and checked against their GitHub Git blob IDs:

- data/evidence/nfl-2026.json: 9f04a0be188ffebcd38e5a5c09ea32cb34109f63
- data/evidence/summary.json: cd9320c7a92cc41ac29510650d276c7f83b31ce3
- data/nfl_injuries.json: ed1d6c39f12d5f5009bad02705df20faa5a3e4bd

Journal SHA-256: `8413b453762c403bfeda892648b1b686bc4ec59d827a6229989f8fc200fe958f`.
Every prior snapshot was deep-compared by identifier with the new journal; all 217
prior snapshots and the complete 17-record settlement prefix are unchanged. All
other data files, including Elo and efficiency, remain unchanged from the previous
verified candidate. There are no code, workflow, dependency or runtime-setting changes.

Bundled-data test expectations now reflect 271 snapshots, 44 games and 17 recorded
outcomes. The eligible public projection excludes the same LV–SF conflict and has
262 snapshots, 43 games and 16 outcomes. A model-delivery test clock includes the
latest journal observation times; production timing and qualification gates are
unchanged. Browser test text assertions were updated, but browser QA was not run.

Verification on Node v24.22.1:

- Full offline test suite with cleared environment: 1,008 passed, zero failures/skips.
- Package syntax and git diff --check passed.
- Retained grading audit: 44 games, 17 outcomes, 27 pending, zero qualified grades.
- Prospective direction audit: 271 snapshots, 44 games, zero timestamp-passing paired
  games. Descriptive hit rate remains withheld below the required sample.
- Sequential market audit: zero first-source-paired finalized games; 30 additional
  qualifying games needed for a reportable research score; model promotion false.
- Data blob hashes rechecked after all three audits. No journal mutation occurred.

These results do not establish complete league coverage, source independence,
predictive improvement, executable entry prices, CLV, ROI or wagering permission.
The six-hour audit remains a local candidate, not an activated schedule. Existing
publication approval is pending; nothing was pushed, merged, or deployed.

Independent review found no blockers: all three source blob hashes, prior snapshot
and settlement preservation, append-only validation, recomputed projection, and test
assertion changes were independently checked. No assertions were loosened to accept
missing evidence or silently omit quarantined history.
