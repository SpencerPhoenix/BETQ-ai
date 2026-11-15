# Schedule safety review, November 7, 2026

Local-only changes. No provider requests, credentials, production changes,
workflow changes, publication, merge or deployment were performed by this fix.
This review does not certify all current league schedules or actual game status.

## Verified LV–SF discrepancy

The retained game is `2026_09_LV_SF`, Las Vegas at San Francisco on November 8,
2026. Provider event `ac9d38a18d5c92814233a31aa9a48d78` has seven immutable
snapshots, all recording `2026-11-08T21:05:00.000Z`. There is no retained result.

The following dated official team pages were read on November 7:

- [49ers, November 4](https://www.49ers.com/news/ways-to-watch-and-listen-raiders-vs-49ers-week-9)
- [Raiders, November 5](https://www.raiders.com/news/how-to-watch-listen-to-and-livestream-raiders-at-49ers)

They give 1:25 p.m. Pacific on November 8: 21:25 UTC, under Pacific Standard
Time. The older Raiders May schedule announcement gave 1:05 p.m./CBS, while
the dated November coverage gives 1:25 p.m./FOX. This is consistent with a
schedule revision, not a daylight-saving conversion error. The exact change
announcement was not found. Some older official pages retain the earlier time.
No new provider response was fetched, so the current provider feed is unverified.

`schedule-review.mjs` holds a separately dated observation, not a live schedule
feed or scoring receipt. It binds only to the exact provider/team/season/game
identity and appears only after its observation time. A mismatched supplied
game ID fails closed. Equivalent explicit offsets represent the same instant.
No frozen kickoff, forecast or result is rewritten. The observation cannot
authorize scoring or certify source publication time.

## Fixes and preserved boundaries

- All five supported sports, including college football, reject date-only,
  timezone-naive and impossible-calendar provider kickoffs. Explicit UTC and
  offsets are accepted. NFL model, challenger, injury and direct capture
  consumers use the same strict kickoff parser. NFL game-day derivation keeps
  its Eastern-date convention; no historical dates are shifted.
- The known dated schedule conflict, or a mismatched known event identity,
  forces price signals to PASS with zero theoretical units and a visible reason.
  After the dated observation, the collector independently recomputes that
  exact known conflict and skips new forecasts at the stale kickoff. It does
  not trust an incoming slate's claimed schedule-review status.
- Capture admission checks frozen identity before deterministic daily-ID
  deduplication. A genuine identity conflict quarantines that game's capture
  batch, allowing unrelated captures and independently eligible final-result
  reconciliation to continue. An already corrupt journal remains a hard error.
- Routine same-ID/same-identity recaptures retain the first observation and
  count as routine duplicates, not scheduling incidents. Changed prices or
  capture times never overwrite frozen data. Cross-game reused-ID collisions
  remain quarantined. No kickoff tolerance or identity-merge shortcut is added.
- Schedule displays include the viewer's timezone. Cached schedule labels
  advance with the clock using text-node updates, without a provider refresh
  or replacing focused dossier controls. Elapsed scheduled start is explicitly
  status-unverified, not an assertion that play began. Dossiers label each
  frozen kickoff separately from the dated official observation.

## Data preservation

The candidate includes the exact three already-published data files from main
`69ca969eeef474b379a0b8bc729a1cdde348dc6e`, instead of reverting to the older
local candidate's 132 snapshots. Git blob identities are:

- `data/evidence/nfl-2026.json`: `a0674b3c1c87c21fad7d61cadad357a87e66bc84`
- `data/evidence/summary.json`: `b5b9ca77176f0d8d195b4fb24bc03024038aafc0`
- `data/nfl_injuries.json`: `3c54494640faadb308114e65da41d78a8d096e0e`

The journal is append-only versus the prior candidate: 159 snapshots, 31 games,
three raw settlements, zero qualified settlements. No new outcomes were added
by this work. Prior qualified-receipt and disabled BDL candidate code is retained.
Workflow schedules, authentication, dependency lock, models and deployment
configuration are unchanged. Earlier local review documents describe their
then-current 132-snapshot baseline; this section records the newer data import.

## Verification and remaining work

Offline regression tests exercise same-day repeats, changed kickoff quarantine,
unrelated-game continuation, strict result identity, malformed inputs, timezone
offsets, DST, midnight boundaries, source-note binding and focus-preserving
display updates. Collector tests intercept every request with synthetic data;
they do not run real collection. Existing workflow and result-qualification
tests remain part of the full suite.

The final local suite passed 626/626 tests with zero skips on Node 24.22.1,
with a cleared environment and an external test preload that rejects non-local
fetches and redirects. Syntax checks passed. Independent read-only review
passed 115 focused tests and found no remaining blocking issue in this scope.
Data hashes and append-only preservation were independently rechecked.

A versioned, reviewed schedule-identity lineage is still needed before captures
and final receipts at a revised kickoff can join a game's old frozen identity.
This fix deliberately quarantines that case rather than weakening qualification.
All other current official schedules, including today's college games, still
need source-specific verification outside this code-only fix. No new live
college feed, college outcome model or college dossier is implemented. Render,
GitHub CI for this tree and Android visual behavior have not been exercised by
this local-only change. A later publication must recheck main and preserve any
subsequent journal/data updates.
