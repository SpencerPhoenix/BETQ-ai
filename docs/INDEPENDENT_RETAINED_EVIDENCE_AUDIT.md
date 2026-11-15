# Independent retained evidence audit

The collector's GITHUB_TOKEN commits do not start ordinary push-triggered workflows. `retained-evidence-audit.yml` therefore runs on its own six-hour clock (00:53, 06:53, 12:53 and 18:53 UTC) and supports manual dispatch. GitHub schedules can be delayed and run only after this workflow reaches the default branch. This is an independent audit schedule, not an independently verified outcome source.

Each run records the exact checked-out commit and SHA-256 of the journal, computes per-game grades or explicit missing-evidence reasons, computes the existing forward and sequential reports, and runs regression checks. Outputs are Actions artifacts, not commits. The workflow has only contents-read permission, checkout does not persist credentials, and no provider secrets or paid calls are used. Journal bytes are checked before and after. A successful audit with zero qualified grades is not proof of collector health or usable outcome evidence.

The source receipt adapter hashes actual received schedule bytes. It does not invent FINAL status, canonical kickoff, or cross-source corroboration. When those fields are missing, results remain blocked. This audit cannot recover absent pregame forecasts or certify every league game, and it does not lift model promotion, ROI, or wagering gates.

Run locally: `node scripts/audit-retained-game-grades.mjs`. Read `audit-output/retained-game-grades.json`, particularly `status`, `reasonCounts`, and `grades.games`. Retained history is never rewritten.
