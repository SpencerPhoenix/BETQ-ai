# Local integration of exact model delivery and schedule quarantine

## Preserved bases

This combines model-delivery guard `072c4e0e5fca593a55d66eb4c88cff25b83f66fa`
with current-data-preserving schedule quarantine
`1aa17bcd90f4df0ec263fd5b6af316658007aeb0`.
The GitHub connector verified `main` still equals
`9157f19ae43430f9f79af8aafc9c1a2efe21e018` before and after integration.
No remote write, provider call, credential use, deployment or settings change
was performed.

A separate worktree and branch preserve the two original candidates. The only
cherry-pick conflict was the package syntax-check command: both the model-delivery
check and the existing official-score/quarantine checks are retained. All other
automatically merged production changes were reviewed together. Four new tests
cover the interaction, with no additional production behavior introduced beyond
the reviewed model-delivery guard.

## Exact retained data

All 40 tracked files under `data`, `.github/workflows`, `package-lock.json` and
`render.yaml` are byte-identical to the quarantine base. Model parameters,
probabilities, raw observations, result records, schedules and workflow triggers
were not replaced or altered.

The retained journal SHA-256 remains
`211b580361072bb121458b42821da6e0b1876343aa4c63337ece1ec94c6ceda4`:
203 snapshots, 31 games and 16 results. The detached read projection contains
194 snapshots, 30 games and 15 results. LV–SF's nine conflicting snapshots and
one result remain in full history, excluded from collection/qualification.
Qualified results remain zero and forward metrics remain unavailable.

The bundled model's canonical artifact identity is
`00d9d9389f7b2764605e9c55b0315510e40ea7290b67f958c653edf387334cf2`.
It was built at `2026-11-06T17:56:40.296Z` through results dated `2026-11-05`.
This describes retained content, not a new trained model or approved promotion.

## Combined boundaries

- The collector verifies fresh health and its exact checked-out artifact before
  its sole paid-intent slate request. The updated receiver rejects a mismatched
  expected-model hash before accessing odds.
- Every available returned projection must repeat the exact model identity.
  A deployment race or unexpected model is rejected, never retried or relabeled.
- A correct model hash does not override a frozen schedule conflict. Unaffected
  games retain their independent admission and result reconciliation paths.
- Every raw retained record is validated before per-game exclusion. Invalid
  model identity metadata in a quarantined game still fails the entire read/write
  admission rather than being hidden.
- Legacy records are not retroactively given an artifact identity. They remain
  unchanged, and publication digests continue to bind full raw journal bytes.

## Verification

- Full offline Node test suite: **978 passed, 0 failed, 0 skipped**.
- Package syntax checks: **63 passed**.
- Independent focused integration review: **108 passed**, including all four
  new combined regressions; no blocking finding.
- `git diff --check` passed; data, workflow, lockfile and configuration preservation
  was verified by hashes and repository comparison.
- Only loopback requests and explicitly intercepted synthetic fixtures were used.
  No new browser/mobile visual pass is claimed. The previous environment-level
  Chromium startup failure remains a visual-QA limitation; this integration adds
  no UI changes.

## Remaining release limits

This is local only. Publication, merging, deployment, production database/auth
configuration, model release and any paid collection still require their applicable
approvals and verification. No runtime or GitHub CI result for this exact new tree
is claimed. Recheck main and preserve any newer data before a future publication.

Identity is an HTTPS runtime assertion, not independent attestation or proof of
forecast quality. Optional-header callers retain their previous cost/auth behavior.
An old rollback receiver can ignore the guard and consume the one authorized
request before the response check rejects it. Daily model updates may intentionally
pause guarded capture until that exact artifact is released. No automatic model
promotion, historical repair or betting-edge claim is added.
