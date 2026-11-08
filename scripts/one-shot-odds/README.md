# Isolated Odds API transport diagnostic (one fresh approved attempt)

This branch is not an application release. Do not merge it. It changes only this
directory and the existing registered `.github/workflows/live-probe.yml` path.
All application code, journal data, schedules, other workflows and dependencies
remain byte-identical to main `69ca969eeef474b379a0b8bc729a1cdde348dc6e`.

## Local configuration and approval boundary

The user confirmed the existing repository secret name `ODDS_API_KEY` from their
GitHub screenshot. No secret value was accessed. Only the final request step
references it. This revision pins workflow run number **70**.

Run **69**, ID **42496052178**, attempt 1, used the correct published revision on
November 8, 2026 at 15:41:08 UTC. Its supplied 15:30 UTC expiry had already passed.
Preflight failed and the provider-request step was skipped: this diagnostic made
zero provider requests and used zero quota credits. The user explicitly approved
one fresh attempt afterward. This is not permission to use Re-run jobs.

The latest read-only history check found run 69 is still the most recent run of
registered workflow **403983910**. The next number is therefore **70**, but this is
not a reservation. Recheck immediately before publication and when the user is
ready to dispatch. Do not send a fixed expiry while preparation is still underway;
coordinate a fresh timestamp with the user only when they are ready to run.

The script accepts only the exact branch and reviewed SHA, actor and triggering
actor `SpencerPhoenix`, the same workflow SHA, canonical UTC expiry within 15
minutes, explicit one-request/account approvals, run number 70 and attempt 1.
Null or placeholder configuration fails closed before contacting the provider.

The user authorized publishing this isolated update for one fresh attempt. They
will dispatch it manually; publication does not authorize us to dispatch, retry,
create secrets, deploy or merge. Before publication and execution respectively:

1. Recheck current main and the existing registered workflow's latest run number.
   Keep its path and name unchanged. Any intervening run consumes the approved
   number and this diagnostic must stop. Do not automatically adjust the number
   to retry; first establish whether the earlier request occurred and obtain a
   fresh decision if needed.
2. Recheck the complete reviewed tree, branch-push triggers and Render branch /
   preview settings. Keep main and production unchanged. Publish this isolated
   branch only with permission, without merging it or creating a release PR.
3. After publication, the user can open the existing Actions workflow and select
   this exact branch. **The current default-branch workflow has no inputs, so the
   web form might not expose this branch's approval/SHA/expiry fields.** This has
   not been tested on the signed-in UI. If fields are missing, do not run the form,
   change main, or weaken guards. An explicitly approved user-operated GitHub CLI
   or REST dispatch with the exact branch and all inputs is the supported fallback.
4. The user must supply this revision's published full SHA, a freshly coordinated
   canonical UTC expiry at most 15 minutes ahead, and true values for the one-request and intended-account
   approvals. Never select main, enable debug logging, or use Re-run jobs.

GitHub assigns a new run number for every new run of a particular workflow and
retains that number for reruns. This guard permits only one run number and attempt
for the unchanged registered workflow and reviewed revision. It is **not**
provider-side idempotency or a durable one-use token. Someone who changes or
recreates the workflow/configuration can rearm it, which is outside this approval.
A failed, cancelled or uncertain first attempt is not permission to run again.

Verified workflow page:
https://github.com/SpencerPhoenix/BETQ-ai/actions/workflows/live-probe.yml

GitHub's documented manual branch selection and CLI/API inputs:
https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow

GitHub's run-number / attempt semantics:
https://docs.github.com/en/actions/reference/workflows-and-actions/variables

## Request and output boundary

The isolated script makes one GET directly to the official Odds API v4 NFL odds
endpoint with one region (`us`) and one market (`h2h`). It never imports application
code, calls Render, captures evidence, reads odds bodies, creates files or artifacts,
changes repository data, installs dependencies, follows redirects, or retries.
It aborts after ten seconds. An ambiguous network outcome is not permission to retry.

Output is limited to fixed status enums and bounded numeric HTTP/quota values.
No URL, key, arbitrary header, response body, error message, quote or team data is
printed. A successful HTTP response is not evidence that the data is current or
correct, nor an independent prediction, bet or qualified outcome.

The fixed one-market/one-region request is expected to cost at most one existing
quota credit. It does not purchase credits. Actual provider accounting remains
the provider's responsibility: zero or one can be reported, unavailable headers
are labeled unverified, and an unexpectedly larger reported cost is flagged.
The diagnostic cannot establish a reserve balance before spending without another
provider request. That would require a separate decision, not a hidden preflight.

Standard public-repository Ubuntu runners are used, with no artifact/cache uploads.
The runner checks main twice and verifies all non-diagnostic files against the
pinned baseline. There remains an unavoidable race if main advances after the
last check; the code itself remains pinned to the reviewed SHA and does not use main.

## Offline verification

Run `node --test scripts/one-shot-odds/diagnostic.test.mjs`, `npm run check`,
and `npm test` with no provider credentials and external networking forbidden.
All diagnostic tests use synthetic keys and mocked transports. Incomplete configuration and missing approval are tested. `verify.mjs` exits
unsuccessfully without exact approved GitHub context by design.
