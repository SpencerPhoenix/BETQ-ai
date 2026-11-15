# Local product safety integration review

Date: 2026-11-07. Local implementation only. No remote publication, merge, deployment, provider request, credential configuration, database migration or quota baseline seeding has been performed.

## Baseline and scope

The preserved product-readiness branch was `86d44eb`, based on PR #14 `c1f0d4c`. Remote main remained `28948b906e1124bae5b5ba0745cc582490296f28` and PR #14 remained `c1f0d4c57513b996274059deeef8e70b3c25ebd9` at the final read-only check. The former temporary durable-budget checkout was unavailable; its code was not assumed recoverable. This work rebuilds that layer in the persistent product checkout.

No `data/` file is changed. The isolated JAX comparison branch and its workflow are not included. Existing forecasts, scoring qualification, model probabilities, and wagering/paper-staging locks remain unchanged.

## Implemented

- Public refresh, score reads and navigation are cache-only. Public code contains no operator credential or paid-intent path. Reload failure retains only the current selection's previous snapshot and discloses failure.
- Paid source access defaults off. HTTP paid access requires the exact paid intent plus a valid server-side operator bearer. HEAD, query arguments, missing/bad auth and bearer-only calls cannot authorize new provider work.
- A PostgreSQL credit ledger commits reservations before upstream requests, holds account locks, retains daily accounting across source restarts, enforces the stricter stored/process cap and floor, and never lowers a large configured reserve.
- Every account requires an explicitly verified operator baseline. Missing/invalid settings, storage failure, malformed accounting and unresolved outcomes fail closed. One unresolved request blocks subsequent spending across days until reconciled. Provider remaining never increases automatically.
- Operator workflow secrets are mapped explicitly. Targets are approved HTTPS origins, redirects are rejected, malformed bearer values are rejected without echoing them, and the browser receives no token.
- Missing token or failed preflight skips capture while preserving public results reconciliation. Run logs identify skipped/zero-eligible capture. Health distinguishes provider prerequisites from actual collection health, which is unknown to this web runtime; the bundled last capture time and age are disclosed without claiming current scheduler success.

## Verification

- Full offline repository test suite: **372 passed, 0 failed, 0 skipped** on Node 24.22.1, with provider/database/operator settings explicitly blanked and private capture disabled for test execution.
- `npm run check` and `git diff --check` passed.
- Paid-path tests use only injected fetch fixtures. SQL transaction tests use an explicitly labeled protocol simulator; these are not real PostgreSQL evidence.
- Independent review checked admission, auth mapping, cache behavior and data/credential boundaries. Its health-labeling and preflight-time-budget findings were fixed and rechecked. The preflight is bounded to 70 seconds, leaving time for results-only reconciliation. No outstanding material code findings remain in that review; external release gates below remain open.
- Browser fixture covers no paid/auth headers and retained-snapshot behavior, but Chromium could not start because the environment denied local socket setup, including an escalated attempt. No browser assertion is claimed passed.

## Release gates and next product work

1. Run the documented isolated PostgreSQL migration, multi-pool/process contention, uncertain COMMIT, disconnect, crash/restart and least-privilege tests. No database setup is authorized by this document.
2. Execute desktop/mobile/keyboard browser QA of empty, fresh, expired, retained-error, rapid-selection and demo flows on an environment that permits the browser.
3. Review the exact final diff and workflow triggers, then obtain explicit publication and deployment approval. Runtime and repository credentials, baseline verification, database access and any live provider run remain separate operator actions.
4. Continue the planned per-game research dossier from existing cached/prospective evidence, preserving the no-verified-edge and missing-source labels. This integration improves safety and clarity, not predictive skill or verified profitability.

Later local update, 2026-11-07: isolated real PostgreSQL verification was subsequently completed while fixing transport and disconnect handling. See [PostgreSQL transport review](POSTGRES_TRANSPORT_REVIEW.md) for the current test coverage and privilege boundary. Historical test counts above describe the earlier slice. Production setup, publication/deployment approval and browser QA remain separate gates.

## Workflow installation follow-up

The publication audit found that 11 existing workflows ran the complete tests without installing dependencies. The new PostgreSQL transport regression imports the locked `pg` dependency, so those jobs would fail on a clean runner. Each affected workflow now runs `npm ci --ignore-scripts --no-audit --no-fund` before tests. The collector's installation step explicitly blanks its inherited operator bearer; later authorized capture steps are unchanged.

A separate clean checkout installed all 14 locked packages from an existing cache with npm's offline mode and an empty credential environment. Syntax checks and **435 tests passed, zero failed/skipped**. Eight focused workflow regressions passed. Parsed-YAML comparison confirms that only the installation step was added to each affected workflow: triggers, schedules, permissions, guards and all existing steps remain unchanged. Data, package metadata and the lockfile stayed byte-identical, including after the clean installation. PostgreSQL runtime code was not changed by this follow-up.

Publishing a feature branch and a draft PR is not a main release. A PR targeting main runs the existing read-only quality/reliability checks. Merging the full combined diff into main matches **13 workflow jobs**, including **10 jobs capable of publishing derived research or dependency changes** and three read-only checks. The two additional writer matches in this follow-up are efficiency training and injury refresh, because their own workflow paths changed. Existing scheduled/manual collection remains separate. Render's main auto-deployment and preview settings must be rechecked before any separately authorized publication or release. No workflow, provider request, publication or deployment was activated by this local verification.
