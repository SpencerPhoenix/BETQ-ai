# Isolated Odds API transport diagnostic (local preparation, not published)

This branch is not an application release. Do not merge it. It changes only this
directory and the existing registered `.github/workflows/live-probe.yml` path.
All application code, journal data, schedules, other workflows and dependencies
remain byte-identical to main `69ca969eeef474b379a0b8bc729a1cdde348dc6e`.

## Local configuration and approval boundary

The user confirmed the existing repository secret name `ODDS_API_KEY` from their
GitHub screenshot. No secret value was accessed. Only the final request step
references it. The reviewed local configuration pins workflow run number **69**.
A read-only GitHub check found registered workflow ID **403983910** last ran as
number **68**, run **42022137361**, on November 5, 2026. These are preparation facts,
not a reservation of the next run number. Recheck immediately before publication.

The script accepts only the exact branch and reviewed SHA, actor and triggering
actor `SpencerPhoenix`, the same workflow SHA, canonical UTC expiry within 15
minutes, explicit one-request/account approvals, run number 69 and attempt 1.
Null or placeholder configuration fails closed before contacting the provider.

Preparation does not authorize publication, secret creation, deployment, merging,
dispatching or retrying. Before any separately authorized publication:

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
4. The user must supply the published full SHA, canonical UTC expiry at most 15
   minutes ahead, and true values for the one-request and intended-account
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
