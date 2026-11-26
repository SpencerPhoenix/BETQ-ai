# Model-only archive: release pin and window audit

Packers–Rams, 2026-11-25 ET: the collector's last verified pre-window run checked out a newer release than the one deployed on Render, and correctly failed its health gate. The Actions listing and authenticated ledger had no in-window run and no durable fixture record at the cutoff audit. These are separate observations; neither establishes why GitHub did not create a visible run in the window.

## Activation (do not merge or deploy during an active window)

1. Use one reviewed application/collector commit, including this change. Check the full suite on the locked Node version. Train/publish later model candidates without changing the binding.
2. Point the GitHub Actions repository variable `BETQ_MODEL_ONLY_RELEASE_SHA` at that exact commit. Do not use a branch name. A missing or malformed pin stops the collector; do not enable the revised workflow without a rollout window and provisioned pin.
3. Roll out that exact commit to Render and read its reported identity. From a clean checkout of the same release, run `node scripts/check-model-only-release.mjs FULL_COMMIT_SHA`. It checks the reported commit, whole canonical challenger digest, existing Elo identity, and health freshness with no odds request. HTTP 200 alone is not readiness. Rerun well ahead of each new slate, before the first capture window. Change the pin only between slates; the workflow does not enforce the operator's slate freeze or grant a fallback.
4. At capture time the collector checks the specific HTTP response's commit and challenger digest again, then applies the existing receipt, identity, clock and publication gates. A diagnostic digest is an HTTPS runtime assertion, not a signature. Rollback requires an exact compatible release and a new passing preflight; never weaken the gate or fill an expired window.
5. A mismatched runtime prevents new reservations. It no longer suppresses recording an elapsed, independently observed window. A run-level mismatch does not by itself prove a fixture-scoped cause.

## Independent observation

An independent host/check can save the official fixture identity and kickoff, a current readable GitHub Actions run listing (with coverage sufficient for the whole window), and a verified copy of the ledger. Feed those snapshots into:

```sh
node scripts/audit-model-only-window.mjs verified-ledger.json actions-runs.json \
  2026_12_GB_LA 2026-11-26T01:00:00.000Z OBSERVATION_UTC
```

The audit only reads files. It distinguishes run creation, run start, a durable run heartbeat, fixture reservation/capture, and custody readback. It will not turn a pre-window mismatch into a fixture cause or say an acknowledgment was visible by cutoff from its readback timestamp alone. A positive in-window heartbeat is not a forecast. No start before the window closed is an observation from the available listing, not proof of GitHub's internal failure mode. For independent timing, record the actual observed start and message acceptance, not the configured schedule alone. Use a separate alert path and a measured time to act before enabling automatic dispatch. This patch does not install a scheduler, enable dispatch, or authorize any production action.
