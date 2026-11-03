# Qualified prospective outcome collection: activation checklist

Observed November 3, 2026, 16:02 UTC. This is a review plan, not authorization
to merge, deploy, buy data, call paid providers or write live outcomes.

## Current bottleneck

- Main is `b0f324b2ffbe86863cf7947a46aafa812ba10451` and does not contain the
  independent `settlement-only.yml` workflow. That workflow exists only in the
  unmerged draft stack. PR validation intentionally skips the writer.
- The immutable journal contains 33 snapshots of 17 distinct games. PR #5's
  calibration report finds zero qualified settled outcomes: one community-only
  result and 16 games with no settlement record. A successful dry run computes
  a candidate in memory; it does not make that candidate a persisted outcome.
- Even if all 17 tracked games eventually qualified as non-ties, at least 13
  additional genuinely prospective games would still be needed for the overall
  30-game descriptive floor. Each calibration band needs its own 30-game sample;
  30 overall is neither sufficient per band nor proof of predictive advantage.
- The [latest observed scheduled collector run](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/41523116447)
  succeeded on November 2 at 20:52 UTC. It reported 16 eligible captures, zero
  newly appended forecasts and one new community-only result. Existing daily
  forecast identities were already present. This run does not support a claim
  that credit exhaustion caused the lack of new forecasts.
- The journal's latest frozen capture is November 2 at 01:38 UTC. As of this
  inspection, no later scheduled collector run appears in the returned main-
  branch run history. This does not establish why a scheduled run was absent.

## Smallest consequential next step, requiring approval

1. Review the existing source permissions and finality limitations, including
   whether the secondary source permits the intended derived use. The current
   unofficial scoreboard adapter is not official league certification. Do not
   extend it into raw-source archival without a separate rights decision.
2. Review the settlement/writer changes in draft PRs #2 and #3 as an operational
   subset. The offline archive and calibration reports do not themselves start
   collection. Include the shared append-only guard before any activation.
3. Only after approval, plan one controlled settlement-only run and inspect its
   exact append-only diff before any authorized publication. Keep original
   forecasts and previous revisions unchanged. Independently verify the final
   status, both score receipts, hashes and resulting qualified-game count.
4. Keep paid forecast collection separate. Confirm its actual run schedule,
   provider entitlement/budget and successful new-game captures before assuming
   the cohort is growing. Do not raise refresh frequency or purchase credits as
   a shortcut. Future games must be captured before kickoff; missing forecasts
   cannot be reconstructed after outcomes.
5. Establish the operational collection cadence across multiple weeks only after
   these approvals. Existing thresholds remain fixed and every under-threshold
   performance result remains withheld.

## Safe preparation completed without activation

The shared `verify-evidence-append-only.mjs` command compares each season journal
to the checked-out HEAD. Both draft writers invoke it before staging or pushing.
It rejects rewritten/deleted/reordered historical records, altered metadata,
untracked game settlements, missing corroboration and nonconsecutive revisions.
It checks final-result dates against the frozen game identity. Settlement-only
mode also forbids new forecasts and newly created season journals.
It permits unchanged legacy records and valid append-only corrections. Tests
exercise the pure validator and a temporary synthetic Git repository.

No live result, source payload, workflow schedule, write permission, service or
deployment configuration was changed by this preparation.
