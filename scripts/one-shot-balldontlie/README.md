# Refreshed isolated JAX–BAL postgame comparison

This local-only candidate restores the reviewed reader from draft PR #13
(`db2ea1df0069c63ca1faabb33d67e8e1527778a7`) on the newer main baseline. It has
not been published or dispatched, and no provider credential has been accessed.
The seven library files retain their exact reviewed hashes in
`reviewed-source.json`. No sports-provider calls occur in offline verification.

## Separate operational and immutable historical sources

- Operational main: `28948b906e1124bae5b5ba0745cc582490296f28`.
- Current journal SHA-256:
  `21d97c7a27873f16962034eb50e1ff040bb55c23aed19160633c4ae7985834e9`.
  All 132 current snapshots and three recorded results are preserved unchanged.
- Immutable evidence source: `607366752c0d32410caf23fc068335acb06f858e`.
  The archived journal remains 77 snapshots and two earlier results, SHA-256
  `94625a292147c8806fe9a66af2df58cc6b081f1b2f04d8387887d4e39d4d5441`.
- Published checkpoint: `a2f92bb5af44cbe853b6d97c00bf2f34599906d0`,
  [draft PR #12](https://github.com/SpencerPhoenix/BETQ-ai/pull/12).
  Manifest SHA-256:
  `f8b7b53e7fb8931bb76496d4fffe2d2568d19d176c7725815c1ce89b39b13847`.
- The complete checkpoint, historical model/scorer files and verifier are
  unchanged. All 29 selected forecasts and all 77 original snapshots match the
  current journal; later forecasts and results cannot replace the selection.
- Successful GitHub publication receipts
  [42063991067](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/42063991067)
  and [42063991074](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/42063991074)
  bind checkpoint tree `567cbb3d122b883747257291af1a4be0d4efe15a`; they completed
  November 5 at 16:24:05 and 16:24:04 UTC, before the first kickoff. The original
  manifest is not rewritten to add this later receipt verification.

Frozen game `2026_09_JAX_BAL`: JAX away, BAL home, season 2026 regular season.
Original kickoff is **2026-11-06T01:15:00.000Z**. Earliest read remains
**2026-11-07T01:15:00.000Z**, preserving the 24-hour guard. Final status still
requires validation. Original first Elo snapshot is `1f4bc657f670fcd10bbff447`,
BAL probability 0.401566, with no challenger. Do not substitute a later forecast,
rewrite kickoff, pool earlier results or select a new favorable cohort.

## Local workflow preparation, not activation

The isolated local branch is `feat/jax-bal-postgame-refresh-20261107`.
Its `.github/workflows/live-probe.yml` is a manual-only, read-only replacement
of an existing registered workflow path, byte-identical to the review template
in this directory. There is no push, pull-request, schedule or workflow-run
trigger. Both approval toggles default false; the exact isolated branch, exact
reviewed SHA, first attempt, no debug and canonical UTC expiry within 15 minutes
are mandatory. **Never merge this replacement or dispatch it from main.**

The workflow checks the dispatched checkout and current main, performs offline
checks without the provider secret, then checks main and approval again directly
before the credential step. The runner independently verifies the current
journal hash and preservation of the original records. The historical source
journal alone supplies the frozen comparison identity. Main advancing requires
review and retest, not bypassing the pin or overwriting newer evidence.

## Exact bounded reads, only after new approval

1. Public schedule GET:
   `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`.
   At most one redirect to HTTPS `release-assets.githubusercontent.com`, hence
   at most two public HTTP requests. No credential is sent to either host.
   Deadline 15 seconds; body limit 12 MB. Unique matching game/date/season/teams
   and completed-looking scores after the 24-hour guard are mandatory. Missing,
   ambiguous or inconsistent input stops before credential transmission.
2. At most one authenticated GET:
   `https://api.balldontlie.io/nfl/v1/games?per_page=100&seasons%5B%5D=2026&season_types%5B%5D=2&dates%5B%5D=2026-11-05&dates%5B%5D=2026-11-06`.
   The existing key goes only in the Authorization header to BALLDONTLIE.
   No paid odds, redirects, pagination follow-up or retries. Deadline eight
   seconds; body limit 256 KiB. An uncertain timeout consumes the request.

The provider must supply a unique matching identity, exact original kickoff,
explicit consistent final status, bounded matching scores and valid update
chronology. Expiry and monotonic time are rechecked immediately before forwarding
the authenticated request. Missing/ambiguous pagination remains fail-closed.
Source names or score agreement do not establish independent upstream lineage.

## Approval required before publishing or running

Request explicit permission to publish this isolated workflow and to use the
saved repository secret `BALLDONTLIE_API_KEY` for one read. Disclose that the key
will be sent to BALLDONTLIE for authentication, exposure could permit misuse,
and a sanitized derived comparison will appear in public GitHub logs. Earlier
completed comparisons do not authorize this request. No new credential or
persistent access is needed; never retrieve the secret value into chat/files.

After approval, recheck main and prior dispatches, publish without overwriting,
verify exact remote tree and safe offline CI, then provide the exact published
SHA and a fresh expiry only when the operator is ready. There is no durable
cross-dispatch once-only lock; every new dispatch needs a separately checked
approval. Do not rerun a failed/uncertain attempt automatically.

Output is limited to allowlisted status, fixed identities/hashes, request counts
and bounded matching scores. No raw responses, arbitrary provider strings,
URLs, headers, exceptions or credentials are logged. No result artifacts,
repository writes, settlements, forecast changes, performance scores or
qualification updates occur. A match remains
`CROSS_CHECKED_INDEPENDENCE_UNVERIFIED`, with zero qualifying outcomes and no
accuracy, calibration, betting-edge or profitability claim.

## Offline checks

`node scripts/one-shot-balldontlie/verify.mjs`

`node --import 'data:text/javascript,globalThis.fetch=()=>{throw Error("REAL_NETWORK_FORBIDDEN")}' --test scripts/one-shot-balldontlie/*.test.mjs`

`npm run check && npm test`

All transport tests use mocks and fabricated score payloads. They do not append
to the real journal. Existing source/credential protections are retained from
[PR #13](https://github.com/SpencerPhoenix/BETQ-ai/pull/13).
