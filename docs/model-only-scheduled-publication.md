# Scheduled model-only publication boundary

The `model-only-scheduled` workflow runs on main only, manually or at UTC minute
7, 22, 37 and 52 each hour. GitHub schedules are best-effort, not a kickoff SLA.
The fixed concurrency group queues rather than cancels running work.

Application code always comes from checked-out main. Only `ledger.json` is
published to `evidence/model-only-scheduled`, initially as an orphan one-file tree.
No application code, main branch, paid odds, bookmaker credentials, or production
deployment is published or requested by this workflow.

Sequence:
1. Read the exact prior dedicated branch commit and ledger without publisher credentials.
2. `run-model-only-cycle.mjs reserve <path>` discovers official fixtures and reserves
   eligible games under the current GitHub run ID and attempt, without capturing forecasts.
3. Publish and verify exact reservation bytes before allowing any forecast capture.
4. `run-model-only-cycle.mjs capture <path>` captures only reservations owned by
   this exact run attempt. Older reservations never authorize recapture.
5. Publish captured evidence, then read back exact bytes with authenticated GitHub
   Git Blob REST (8 MiB decoded ledger limit; no record dropping). The HTTP response Date is the server observation, not author commit time.
6. Invoke `confirm-model-only-publication.mjs <path> <commit> <serverDate>` without
   the publisher token, then persist and verify any custody acknowledgments.

Git ref updates explicitly use `force:false`. A changed prior branch SHA, unexpected
file tree, missing server time or mismatched bytes stops publication. The final
custody write must itself persist; a local acknowledgment alone is not durable.
Only the two publisher steps receive `GITHUB_TOKEN`; checkout does not retain git
credentials. The workflow requests only `contents:write`, not actions/admin scope.

Failure is not permission to replace a forecast. If reservation publication fails,
capture does not run. If capture publication fails, the durable reservation bars
later run attempts from recapturing that game. If the capture persisted but custody
did not, the original may be acknowledged only under the confirmation module's
remaining pregame window; otherwise it stays unqualified. Candidate files and the
last publication checkpoint are uploaded even on failure for explicit operator
recovery. These are not silently re-imported or overwritten by later forecasts.

The ledger remains model-only research, not market evidence, trading history,
verified CLV/ROI, independent timestamp attestation or automatic cohort promotion.
Raw provider feeds and secrets must never be admitted into this public ledger.
