# Scheduled model-only run diagnostics

The final reporting step runs **after** reservation, capture and custody publication. It exits nonzero for degraded collection while preserving the published ledger and recovery artifact. A green run with `HEARTBEAT_NO_CAPTURE` is not a captured forecast or a game grade.

The JSON log and Actions step summary separate current-run RESERVED, CAPTURED, CUSTODY, FINAL, CAPTURE_FAILED and MISSED events. Each new capture must have its own matching custody acknowledgement; a custody repair for an older capture cannot satisfy it. New missed windows degrade the run, while games already outside the window when the policy began do not.

`productionHealth` persists only compatibility, a bounded reason code and numeric HTTP status. It distinguishes HTTP failure, timeout, invalid/oversized body, unsupported capture schema, stale/future health time, unavailable runtime delivery identity, artifact mismatch and unavailable expected artifact. Raw bodies, headers and exception text are never stored. A transient failure cannot be retrospectively relabeled an artifact mismatch.

Unavailable official weeks, unavailable final source, result conflicts, truncated discovery scope, capture failures and missing capture custody also degrade the report. Inspect the summary before retrying. Do not loosen compatibility, timing or custody checks to make a run green; do not backfill a pregame record after kickoff. No retry, new schedule, paid request or wager is introduced by these diagnostics.
