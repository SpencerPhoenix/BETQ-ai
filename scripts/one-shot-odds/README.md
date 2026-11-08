# Isolated Odds API transport diagnostic (one additional approved request)

This branch is not an application release. Do not merge it. It changes only this
directory and the existing registered `.github/workflows/live-probe.yml` path.
All application code, journal data, schedules, other workflows and dependencies
remain byte-identical to main `69ca969eeef474b379a0b8bc729a1cdde348dc6e`.

## Local configuration and approval boundary

The existing repository secret is named `ODDS_API_KEY`. The user reports updating
its value after the rejected request, but no value was accessed and the replacement
key has not been tested. Only the final request step references that existing name.
This revision pins workflow run number **71** for one additional approved test.

Run **69**, ID **42496052178**, attempt 1, stopped in preflight because its supplied
expiry had passed; the provider step was skipped and this run made zero requests.
Run **70**, ID **42496867864**, attempt 1, passed preflight and all 315 tests, then
made exactly one approved provider request. At 15:51:06 UTC on November 8, 2026,
it returned HTTP 401. Remaining/used/last-cost quota headers were absent, so the
actual charge is unverified. It supplied no odds or provider-source timestamp.
No retry, redirect, production request or journal write occurred.

The earlier one-request authorization was used by run 70. After updating the
existing secret, the user explicitly approved updating this isolated branch and
one new test using that key over HTTPS to api.the-odds-api.com, with up to one
additional quota credit and the risk of key exposure disclosed. The user will
start it manually. No automatic dispatch, deployment or retries are authorized.
Do not click Re-run jobs.

Read-only history still shows run 70 as the most recent run of registered workflow
**403983910**. The next number **71** is not reserved. Recheck history, main, published branch
and deployment boundaries immediately before publication and execution. Coordinate a
fresh expiry only when the user is ready, not during local preparation.

The script accepts only the exact branch and reviewed SHA, actor and triggering
actor `SpencerPhoenix`, the same workflow SHA, canonical UTC expiry within 15
minutes, explicit one-request/account approvals, run number 71 and attempt 1.
Null or placeholder configuration fails closed before contacting the provider.

The approved scope is publication of this isolated update and one additional
fixed NFL h2h US diagnostic request using the updated existing secret and at most
one expected quota credit. Follow these separate publication and user-operated
execution steps. No deployment, merge, secret creation, automatic dispatch or
retries are included.

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
