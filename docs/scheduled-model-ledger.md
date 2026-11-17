# Scheduled model-only preparation and provisional grading

This is a separate preregistered model-only study, not the existing market evidence
journal. Its policy is fixed: reserve the first eligible official regular-season
fixture 90–45 minutes before kickoff; attempt capture once for that reservation.
Scheduled checks at minutes 7,22,37,52 UTC are best effort, not a wall-clock SLA.
Official nearby-week discovery is bounded and partial failures are reported.
Games whose window ended before activation are marked POLICY_STARTED_AFTER_WINDOW,
not retrospectively predicted. Later missed slots and unresolved capture attempts
remain visible. Existing manual snapshots are not silently imported or promoted.

## Custody protocol

1. Load exact prior dedicated branch ledger, validate it and preserve all events.
2. Confirm deployed capture schema and exact model identity match the collector.
3. Discover official fixtures and append reservations with workflow run/attempt ID.
4. Publish to the ledger-only evidence branch and authenticate exact-byte readback.
5. Only then request the odds-free forecast. Bind provider game ID, kickoff, venue,
   exact model artifacts, evaluation/receive times and the frozen response.
6. Publish capture; verify exact bytes and GitHub HTTP Date before kickoff.
7. Append a separate custody acknowledgment and publish/read back that record too.

A failed reserve publication produces no forecast request. A failed capture
publication never authorizes a new forecast on the next run: the old reservation
blocks recapture and is marked unresolved. Candidates are saved after each capture attempt; the always-run artifact upload provides best-effort recovery, but abrupt runner loss can still prevent upload. Unpublished reservations remain blocked for reviewed operator recovery. Stored model artifacts are
retained by digest so later updates cannot replace the model used originally.
No record is overwritten or deleted. Publisher updates are fast-forward only,
with one fixed concurrency group and exact expected-head checks.

Git author timestamps are not custody proof. The GitHub Date header has second
resolution; its next-second upper bound must precede kickoff. This is explicitly
operator-observed authenticated remote custody, not independent timestamp
attestation. A locally captured or first-push-only record without persisted
custody acknowledgment is not shown as saved pregame or used for grading.
The UI re-reads the fixed public ledger before presenting saved status; missing or
invalid data produces no save claim. A stale scheduler heartbeat is reported.

## Results

Only custody-confirmed original predictions can receive a provisional grade.
The observed official final must match the frozen provider ID, teams, kickoff and
venue, and its scores/date must agree with the public nflverse schedule. Both
source hashes and observation times are retained. Source disagreement, withdrawn
final status or changed kickoff/provider identity withhold the current grade.
Corrections append new final observations; originals remain unchanged.
Ties withhold binary Brier/log loss and win/loss labels. A 50% model has no outright
pick. These grades are provisional because the two public sources may share an
upstream. They do not enter the existing qualified market cohort or establish
market advantage, CLV, fills, ROI, or injury-adjusted probabilities.

## Limits

Regular season only. Automatic final reconciliation covers recent 14-day captures; unresolved older captures require manual reconciliation and are labeled accordingly. No paid APIs or user/bookmaker quotes. No new database or
persistent credentials. Dedicated branch is `evidence/model-only-scheduled`, never
main. Ledger size is bounded 8MiB and events 20,000; reaching a limit fails closed
and requires reviewed archival rather than dropping history. Workflow failures
and unpublished candidates are visible in Actions; publication failures cannot
reliably appear in the public ledger until a later successful write. Model/schema
preflight mismatch blocks reservation rather than silently using another model.
