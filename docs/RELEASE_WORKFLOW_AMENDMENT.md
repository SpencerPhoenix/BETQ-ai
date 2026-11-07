# Separate code release from research publication

Local amendment prepared on 2026-11-07 against tested candidate `a259adc`, whose exact tree was published in draft PR #16. The existing public PR, main branch and production service are not changed by this preparation.

## Change

Remove the `push` event from these ten research/dependency writers: margin research, market challenge, NFL replay, promotion power, residual research, risk stress, shadow lock, NFL training, efficiency training and injury refresh. Their existing manual dispatch is retained; jobs remain guarded to execute only on main. Every existing job, permission, concurrency policy and schedule is retained.

Scheduled operation remains:

- NFL training: daily 11:17 UTC.
- Efficiency training: Tuesday 10:37 UTC.
- Injury refresh: daily 10:24 UTC.
- Evidence collection, unchanged: daily 11:41 UTC; Sunday 16:15, 17:15, 21:15 and 22:15 UTC; Monday 00:35 and 01:35 UTC.

The quality gate, independent reliability audit and prospective-direction audit remain byte-identical to PR #16, including their read-only push/PR/manual events. No CI skip marker or blanket workflow disabling is introduced. Unrelated production-probe workflows are unchanged.

The lockfile's two root package-version fields are corrected from `0.9.0` to the package's existing `0.11.0`. No dependency version, resolved URL, integrity value or transitive dependency changes. This removes the known root-metadata mismatch without running the dependency publisher.

## Verification

- A separate clean checkout installed the same 14 locked packages entirely offline with lifecycle scripts disabled and an empty credential environment.
- **442 tests passed, zero failed/skipped**, plus syntax and whitespace checks. Fifteen focused workflow tests passed.
- Parsed-YAML comparison confirms that each affected workflow differs only by removal of its push event. All other workflow files remain byte-identical.
- Regression tests enforce the full writer event allowlist, exact complete workflow/schedule inventory, main-only guards, unchanged read-only CI and unrelated probes, absence of provider/database/operator credentials in research writers and matching root lock metadata. Mutation cases reject added push/indirect events, duplicate event keys and altered schedules.
- Every data file, runtime source file and existing forecast/result remains unchanged. The dependency graph is identical after ignoring only the two corrected root version fields.

## Remaining boundaries

An eventual merge no longer starts these ten writers. The three existing read-only main checks still match the combined release diff. Scheduled/manual writers can still run independently and may alter main; this amendment does not serialize or redesign those jobs.

Render's automatic-deployment setting is separate and unchanged. Publication, merge, deployment, production configuration, database setup and provider use still require their respective approvals. This amendment does not fix missing collector terminal receipts, add outcomes, activate paid capture or establish predictive performance. Mobile/browser review remains a separate release gate.
