# Local schedule, strategy and historical-view integration

November 7, 2026. This is a local candidate, not a production release.
No publication, merge to main, deployment, provider request, credential use,
production setting change or new research outcome is part of this integration.

## Inputs and conflict resolutions

The isolated integration branch starts from schedule candidate
`6ef272a1773a06ab999cbe075f48b0726b97caa4`. It includes the complete changes from:

- Strategy feature `879264f742369c864c85ce27e68c79d3053826b7`.
- Historical-view foundation `4ba7233f3c6b151f7977e8230801697f9765e5a4` and its
  app/bundle integration `89d2e77bafa55ba74a86e7bcd833851d45c7dfe8`.

The three original candidates remain unchanged. Local cherry-picks give the
integrated copies different commit IDs; no original branch was rewritten.

Content conflicts were resolved additively:

- `package.json`: retain the union of all 58 unique syntax-check targets and
  the two historical commands. No dependency or lockfile change.
- `public/app.js`: retain both the schedule-label update and strategy refresh
  in the existing 15-second clock callback. Neither replaces the game-card or
  disclosure controls. Retained dossier schedule notes remain next to their
  frozen values; strategy explanations are also present.
- `public/styles.css`: retain the strategy styles and the separate historical
  navigation link rule.
- `src/server.mjs`: retain both the strategy asset and historical document,
  script and style entries in the explicit static allowlist. CSP is unchanged.

Other overlapping HTML changes merged cleanly. The main app loads the strategy
script before its own script, and links to the historical document without
loading historical data in the normal app. Historical assets, records and
research results are separate from the live slate and prospective journal.

## Integration-specific safeguards

Review identified a semantic conflict absent from simple text merging: a
strategy panel could label a quote recent even when the card reported a known
schedule conflict. Strategy source status now gives schedule conflict and
identity mismatch precedence. Every strategy remains PASS with zero suggested
units; neither quote recency nor schedule review grants execution authority.

The strategy panel also no longer claims that play began merely because a
scheduled start passed. Its wording distinguishes scheduled timing and cached
flags from unverified actual game status. Its source, receipt and kickoff
parsing now requires an explicit UTC/offset and a real calendar date, matching
the server's schedule rule. Parity tests cover missing offsets, invalid dates,
midnight-crossing offsets and the repeated DST hour.

The historical implementation itself is byte-identical to its reviewed input
candidate. Its bundle is still a lossless copy of the existing frozen artifacts,
with the original fingerprints and retained license. Historical development
results do not increase prospective qualification or establish a betting edge.

## Preservation checks

Main was checked before and after integration and remained
`69ca969eeef474b379a0b8bc729a1cdde348dc6e`. The candidate retains its exact files:

- Journal: `a0674b3c1c87c21fad7d61cadad357a87e66bc84`.
- Evidence summary: `b5b9ca77176f0d8d195b4fb24bc03024038aafc0`.
- Injury artifact: `3c54494640faadb308114e65da41d78a8d096e0e`.

There are still 159 snapshots, 31 prospective games, three raw settlements and
zero qualified settlements. No existing data, model, journal, budget/transport
protection, schedule quarantine, receipt policy, workflow or dependency lock
changed relative to the scheduling candidate. New historical bundle files are
the copies already present in the historical-view candidate.

## Verification

- Node 24.22.1: **677 tests passed**, zero failures or skips.
- All 58 syntax targets and whitespace checks passed.
- Independent read-only review passed **391 focused tests**, zero skips, and
  found no remaining material issue in the integrated scope.
- The local historical artifact verification passed all **285 games** and
  **14,250 retained analogs**, using **289 loopback requests** and zero external
  requests. Original source-file fingerprints remain unchanged.
- Full suites ran with a cleared environment and a localhost-only fetch
  preload that rejects redirects. Actual handler tests explicitly forbid all
  provider, remote-feed and database methods on the read-only feature routes.
- Seven new combined tests cover engine-to-strategy conflict handling, parsing
  parity, truthful passed-start labels, merged game-card content, both clock
  hooks with stable controls, the syntax/asset union, and historical/prospective
  route coexistence without journal mutation.

These tests exercise pure code, VM DOM doubles and local HTTP handlers. They do
not replace browser, visual or assistive-technology testing.

## Remaining release gates

Android and real-browser visual QA remains unperformed: no screenshots,
measured 360/390-pixel layout, actual keyboard/focus/scroll test or screen-reader
certification. Previous browser access restrictions were respected; no alternate
route or security-setting change was attempted.

This exact combined tree has not run GitHub CI or a deployed preview. Before an
authorized publication, recheck main and preserve any newer data, review build
and workflow effects, and verify preview/deployment settings. Publication does
not authorize merge or deployment.

Schedule revisions still require a reviewed versioned identity design before
corrected-kickoff captures/finals can join old frozen identities. Quarantine is
deliberate, and no historical values are silently shifted. Other current league
schedules, today's college games and provider availability are not certified by
this local integration. No college outcome model or dossier was added.
