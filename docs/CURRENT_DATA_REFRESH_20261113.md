# Current data refresh, November 13, 2026

This local successor to `f9a000d17b718831f78364479e0f604f69ea2216` preserves
GitHub main `151a9a72cb362641b7cc388a2780afbccd4f4e06` without regenerating data.
Main's complete recursive tree differs from the previous data base `5819b67`
only in four files, with no removed paths:

- `data/evidence/nfl-2026.json`: `c90da89a49433b98fd12c488417354bb4bb08331`
- `data/evidence/summary.json`: `a4a3841f55c707622e45cc1a5173db9277a0c702`
- `data/nfl_elo.json`: `26169779c1f71e4c3cf2cbd01d7c39ef014d19f2`
- `data/nfl_injuries.json`: `94280e519f47a62b7e6186d409da7c4cfa1fa5ab`

All 12 data files present on main match their exact Git blob hashes. The candidate's
four additional historical research files remain unchanged. All 271 previous snapshots
and 17 result records remain unchanged ordered prefixes of the refreshed journal.
No frozen forecast, result, qualification rule, runtime file, workflow, lockfile or
deployment configuration was edited by this refresh. Test-only inventory assertions
now match the refreshed source counts; no assertion was removed or relaxed. The
browser fixture clock now follows the latest retained observation plus one minute,
instead of rejecting refreshed records against a fixed November 9 test clock.

The journal contains 297 snapshots across 44 retained games and 18 recorded results.
Its SHA-256 is `119b5e09133d7f72e0c98b53e4ce3e32873e3b130995781a90c39b2dc91a7ee2`.
The unchanged LV-SF schedule conflict quarantines nine snapshots and one result.
The public non-quarantined projection therefore contains 43 games, 288 snapshots and 17
result records. All 18 retained results remain ungraded, with zero source-qualified
results; 26 retained games have no recorded result. This is not league-wide coverage.

The full offline suite passed 1,008 tests, zero failed/skipped, on Node 24.22.1 with
a cleared environment. Package syntax and whitespace checks passed. The local audit
confirmed zero qualified grades and did not request a provider or mutate the journal.
Independent review passed all 312 focused tests and found no blocking issue.
Browser fixture generation succeeded after correcting its test clock, but Chromium
could not start: its process-singleton socket was denied by the environment. No browser
assertions or screenshots completed. GitHub Node 22 CI and current browser/mobile
visual verification remain separate gates.

This refresh was not published, merged or deployed. No paid request, credential use,
database change, new source receipt, model promotion or wagering action occurred.
Current main must be checked again before any eventual publication or release.
