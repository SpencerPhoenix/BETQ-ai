# One approved read-only NFL comparison

This is an isolated research branch, based on main commit
`3dcd5a49948246248026f44f57f39d1e37fa9303`. It does not modify application code,
data, collectors, deployment configuration or any existing draft branch.
The reviewed reader and its pure dependencies are copied into `lib/` without
changes, with source commit and SHA-256 hashes in `reviewed-source.json`.
This keeps the stronger draft validation separate from the production modules.

## Current state

This refreshed revision is local only and has not been published or run against
BALLDONTLIE. The earlier isolated branch is unchanged and had no comparison runs
when this refresh was prepared. Current main's 77 snapshots, 31 tracked games and
two community-score settlement records are preserved byte-for-byte. The refreshed
journal SHA-256 is
`94625a292147c8806fe9a66af2df58cc6b081f1b2f04d8387887d4e39d4d5441`.
The user reports an existing GitHub Actions repository secret named
`Balldontlie_api_key`, correcting an earlier environment-scope description. The
fixed repository reference is prepared, but metadata availability and real
account entitlement are not independently verified. No secret value has been
requested or accessed. Publication and use still require approval.

GitHub stores secret names in uppercase and references are case-insensitive, so
the final fixed reference is `secrets.BALLDONTLIE_API_KEY`. There is no dynamic
secret-name selector and no fallback to another credential. Missing credentials
stop before network access.

## Proposed execution, after exact review and approval

1. Recheck remote main and the isolated branch. Main must still equal the pinned
   base; otherwise stop and reconcile offline. Confirm the repository secret name and intended provider without reading
   its value. Do not add or change credentials or permissions.
2. Publish only the approved isolated branch. This branch changes the existing
   manual `live-probe.yml` path because it is already registered on main. A new
   manual-only workflow would normally require default-branch registration.
   Never run the original main version: it requests production paid odds.
3. Dispatch only the reviewed isolated branch, with its full exact commit SHA,
   explicit consent, confirmed credential scope, and a UTC approval expiry no
   more than 15 minutes ahead. Defaults do not authorize a request. A rerun
   (`run_attempt > 1`) is refused. A separate dispatch is a new action requiring
   new approval; this is not a durable account-wide once-only lock.
4. The job checks its actual checkout and current main, verifies source and
   evidence hashes, and runs offline tests before the credential-bearing step.
   No dependency installation runs with the credential. Actions are SHA-pinned
   and checkout does not persist its GitHub credential.
5. The secret is injected into only the final Node process. That process removes
   it from its environment and retains it only in memory while making the read.
   It is never placed in a URL, command argument, file, body, log or artifact.
   Runner debug mode is refused.

The proposed job is not a merge, deployment, scheduled collector or publisher.
No GitHub environment is referenced or created. If the repository credential is
missing, stop rather than falling back to an environment, another secret, a new
credential or a different service.

## Exact request and evidence limits

- Fixed game `2026_08_PHI_WAS`, frozen kickoff
  `2026-11-02T01:20:00.000Z`, from the unchanged pinned main journal.
- One public nflverse schedule read, allowing at most one HTTPS redirect to
  `release-assets.githubusercontent.com`. No credential is supplied on either
  public request. Its body is capped at 12 MB with a 15-second total deadline.
- At most one authenticated GET to
  `https://api.balldontlie.io/nfl/v1/games`, with date/season filters derived from
  the frozen game. It uses the games endpoint, no paid odds route, no retries,
  pagination follow-up or redirects, with an eight-second deadline and 256 KiB
  body cap. Schema, identity and final-status failures remain failures.
- The journal is hash-checked, not updated. Source receipt times are current
  observations, not backdated source-publication timestamps.
- All tracked frozen identities are checked before narrowing to the selected
  game. An unrelated tracked-game identity conflict can stop the read before any
  credential-bearing request. Never rewrite the frozen journal to force a match.
- Only a bounded, allowlisted JSON summary is printed: status, pinned code/data
  identity, request counts, matching scores and source hashes when valid. No raw
  responses, headers, arbitrary provider strings or secret material are logged.
  There are no artifact uploads, repository writes or model/metric updates.
- Matches remain independence-unverified and nonqualifying. They establish
  response consistency, not independent lineage, official league certification,
  predictive quality or profitability.

## Offline verification

`node scripts/one-shot-balldontlie/verify.mjs`

`node --import 'data:text/javascript,globalThis.fetch=()=>{throw Error("REAL_NETWORK_FORBIDDEN")}' --test scripts/one-shot-balldontlie/*.test.mjs`

`npm run check && npm test`

Tests fabricate score responses in memory and never call the provider. The full
main evidence journal is read only to verify compatibility and exact identity;
no fabricated results are written into it. Real account entitlement, API schema
compatibility, repository secret availability and actual execution remain
unverified. Treat a request timeout as a possibly consumed request, not permission
to retry. A zero write-token scope does not make published logs private; summaries
are visible to the repository audience.

References:
- [GitHub secret naming](https://docs.github.com/en/actions/reference/security/secrets)
- [Manual workflow dispatch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [BALLDONTLIE NFL schema](https://nfl.balldontlie.io/#games)
