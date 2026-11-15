# Local JAX–BAL postgame comparison preparation

This is a local-only adaptation of the successfully tested one-shot reader at
`839b7704dd6383123d1a725aee0dd89d653d5495`. It has not been published, activated or
run against a provider. No credentials have been read. The seven library files
remain byte-for-byte identical to that reviewed reader; their earlier source
and diagnostic changes remain documented in `reviewed-source.json`.

## Fixed checkpoint and timing

- Frozen game: `2026_09_JAX_BAL`, JAX away, BAL home, season 2026, regular season.
- Original kickoff: **2026-11-06T01:15:00.000Z**. Do not replace it with a later
  provider kickoff or silently adapt the cohort after a postponement.
- Earliest execution: **2026-11-07T01:15:00.000Z**, 24 hours after that kickoff.
  The existing conservative community-score delay remains unchanged. This is
  only the earliest possible check, not a claim the game will be final then.
- The original first Elo forecast is snapshot `1f4bc657f670fcd10bbff447`, BAL
  probability 0.401566, with no challenger. It is one member of the already
  published fixed 29-game checkpoint, not a newly selected favorable outcome.
- Published checkpoint: `a2f92bb5af44cbe853b6d97c00bf2f34599906d0`,
  [draft PR #12](https://github.com/SpencerPhoenix/BETQ-ai/pull/12).
  Manifest SHA-256:
  `f8b7b53e7fb8931bb76496d4fffe2d2568d19d176c7725815c1ce89b39b13847`.
  Its exact bindings and successful offline GitHub receipts were verified by
  November 5 at 16:24:05 UTC. The runner verifies that frozen manifest, the
  entire checkpoint and archived journal locally before any request.
- Current-main baseline: `607366752c0d32410caf23fc068335acb06f858e`. Before any
  eventual publication/execution, recheck main, the branch, prior dispatches and
  the actual checkpoint receipt. If main advances, stop and review/retest a
  refreshed isolated branch; never overwrite new evidence.

## Exact bounded requests, only after separate approval

1. Read the public schedule:
   `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`.
   At most one redirect to HTTPS `release-assets.githubusercontent.com`, so at
   most two public HTTP requests total. No credential on either request. Total
   deadline 15 seconds; raw body at most 12 MB. Require the unique matching
   game/date/season/teams and completed-looking scores under the 24-hour guard.
   Missing, ambiguous or inconsistent community input stops before key use.
2. Make at most one authenticated GET to the free BALLDONTLIE NFL Games endpoint:
   `https://api.balldontlie.io/nfl/v1/games?per_page=100&seasons%5B%5D=2026&season_types%5B%5D=2&dates%5B%5D=2026-11-05&dates%5B%5D=2026-11-06`.
   Put the existing key only in the Authorization header to this issuing
   service. No paid odds, redirects, pagination follow-up or retries. Deadline
   eight seconds; raw body at most 256 KiB. A timeout may have consumed the one
   approved request and is not permission to retry.

BALLDONTLIE must supply an unambiguous matching identity, exact original kickoff,
explicit consistent final status, matching bounded scores and a valid update
receipt. The conservative documented pagination rules remain unchanged: reject
all present non-null cursors and ambiguous full pages with an omitted cursor.
A short page supports checking its records, not a guarantee of completeness.
Neither source brand establishes independent upstream lineage or official NFL
certification. Source terms and free-tier availability should be rechecked if
materially changed before use; no new account, subscription or credentials are
required by this design.

## Authorization and execution boundary

`live-probe.yml.template` is inert because it is outside `.github/workflows`.
It documents the reviewed manual-only branch workflow for possible later use.
No active workflow, schedule, runtime module or live evidence file is changed.
The CLI defaults to denial. Do not dispatch the existing main `live-probe.yml`,
which is a different production odds probe.

Before activation, obtain explicit permission to publish the isolated workflow
and make **one** credential-bearing read. Disclose the key will be sent to
BALLDONTLIE, exposure could permit misuse, and the sanitized derived comparison
will appear in public GitHub logs. An earlier request's approval is consumed and
does not authorize this one. The only permitted saved credential reference is
repository secret `BALLDONTLIE_API_KEY`; do not extract its value or configure a
new credential or persistent access.

Execution requires the exact reviewed code SHA, correct isolated branch, verified
current main, explicit approval, repository-secret confirmation, no debug mode,
first run attempt and a canonical UTC expiry at most 15 minutes ahead. Both the
inert template and runner reject execution before the 24-hour guard. A second
authorization check immediately before forwarding the authenticated request
rejects an expired or backwards clock and counts only actual forwarded calls. Offline
checks precede the credential-bearing step. This is not a durable cross-run
once-only lock: another dispatch needs another approval, and an operator must
check that the authorized request has not already run.

## Outputs and limits

Print only an allowlisted status, fixed game/snapshot/checkpoint/code identities,
request counts, matching scores and source hashes where valid, and fixed
validation failure codes. Never log keys, URLs, headers, raw responses, arbitrary
provider strings or exceptions. No artifacts, repository writes, prediction
changes, settlements or score calculations are produced by the runner.

A match remains `CROSS_CHECKED_INDEPENDENCE_UNVERIFIED`, with zero qualifying
outcomes and no qualification-gate change. Ties may match as source observations
but are not binary model scores. No forecast accuracy, calibration, edge,
CLV/ROI, wagering permission or profitability is inferred. Preserve this
operational comparison separately from the live qualification journal and the
other 28 members' future outcomes.

## Offline verification

`node scripts/one-shot-balldontlie/verify.mjs`

`node --import 'data:text/javascript,globalThis.fetch=()=>{throw Error("REAL_NETWORK_FORBIDDEN")}' --test scripts/one-shot-balldontlie/*.test.mjs`

`npm run check && npm test`

All enabled tests provide mocked transport and fabricated score responses. Those
fixtures are tests only and are never appended to the real evidence journal.
References: [successful earlier real comparison](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/42022137361),
[BALLDONTLIE Games schema](https://nfl.balldontlie.io/#games),
[official terms](https://www.balldontlie.io/terms),
[GitHub secret naming](https://docs.github.com/en/actions/reference/security/secrets).
