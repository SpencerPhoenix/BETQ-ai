# BETQ product and release plan

Status: local proposal and implementation slice, 2026-11-07. No publication, deployment, provider request, credential use, or settings change is authorized by this document.

## Product decision

Build a trustworthy sports research workspace first, not a betting recommendation service. The immediate user job is: **see what real data is available, inspect a game and its model assumptions, and understand whether the evidence supports any conclusion.** The current evidence does not establish profitable predictions. A higher favorite hit rate is not the same as an edge at the offered price.

Working audience assumption: the owner and small research collaborators. Willingness to pay, acquisition channels, and broader customer demand are untested. Do not add billing, accounts, a marketplace, more model families, or promotional performance claims before validating the core research workflow.

This plan reuses the repository's completed market, residual, power, margin, historical replay, and prospective evidence work. Historical seasons that have been inspected repeatedly remain development evidence. It does not reinterpret them as clean holdouts or repeat a best-score search.

## Verified implementation baseline

Read-only repository snapshot on 2026-11-07:

- `main`: `28948b906e1124bae5b5ba0745cc582490296f28`.
- [PR #14](https://github.com/SpencerPhoenix/BETQ-ai/pull/14): draft integrity, refresh-cost and UI bundle; head `c1f0d4c57513b996274059deeef8e70b3c25ebd9`. This product slice is based on that head, not an overwrite of main.
- Durable provider-budget and authenticated operator-refresh work is being reviewed separately. It is a release dependency, not claimed as part of this slice. Public cache-only behavior must be tested together with it.
- [PR #12](https://github.com/SpencerPhoenix/BETQ-ai/pull/12): immutable 29-game checkpoint, separate from current operational data.
- [PR #15](https://github.com/SpencerPhoenix/BETQ-ai/pull/15): isolated refreshed JAX–BAL comparison, head `fad3cd7f086f1a573b6a723254c6c96343e46e55`. **Exclude this branch from the product release.** Its branch-only `live-probe.yml` replacement must not be merged or run from main. A provider run needs separate exact approval.
- Earlier stacked drafts are not independent releases. Review overlapping or superseded content before any merge; opening a draft does not authorize merging it.

These identifiers are an audit snapshot, not an instruction to ignore subsequent main/data changes. Recheck before integration or release. No production state is inferred from a local test or draft PR.

## Narrow MVP and acceptance criteria

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| R1 | The overview distinguishes market data availability, NFL prospective evidence, and decision readiness. | All three remain visible when no odds are cached; links open Games, Evidence, and Model. |
| R2 | A recorded result is not counted as a qualified outcome merely because a score exists. | Valid scoring-policy summary required; raw and source-corroborated counts labeled separately; legacy, malformed, contradictory and error summaries cannot show qualified counts. |
| R3 | Meeting a 30-game reporting threshold cannot imply an edge, independent sources, profit, or permission to bet. | Explicit no-verified-edge and locked-execution text remains even for 30+ source-corroborated outcomes. Missing compatible metrics keep the reporting gate closed. |
| R4 | Demo, non-NFL and spread/total views cannot imply an independent model for the selected market. | Demo is fictional; evidence card explicitly says NFL; selected market is separate. Existing capability labels remain. |
| R5 | Cached, stale, future/invalid-time and retained views are not relabeled as live validated data. | Receipt time displayed; expired/retained distinction; bundled or failed journal refresh disclosed; no invented publication time. |
| R6 | Ordinary public navigation is credential-free and cannot authorize provider spend. | New panel has no network code, secret fields or spend control. Budget-owner integration must verify all existing public refresh paths are cache-only. |
| R7 | Mobile and keyboard users have direct supported next actions. | Semantic buttons, named section, single-column narrow layout, 44px action targets, no new animation; existing keyboard navigation retained. Real-browser QA remains a separate gate. |
| R8 | No data mutation or model promotion is caused by a readiness view. | No server, source, journal, model, workflow or settlement files changed in this slice. Existing evidence and execution gates are reused, not replaced. |

Implementation trace: `public/index.html`, `public/app.js` (`renderResearchReadiness`), `public/styles.css`, `tests/product-readiness-ui.test.mjs`. Reuses the existing `evidenceScoringView` and current evidence endpoint. No new dependency, database schema, endpoint, or background fetch.

## User journey and UI decisions

1. Open Overview. First answer: what can BETQ support right now?
2. Inspect the selected market's snapshot and receipt time. Absence of current odds must not hide the historical or prospective research.
3. Inspect frozen NFL evidence: recorded scores versus source-corroborated counts, reporting gate, source independence caveat, and retained/bundled status.
4. Open Prediction Lab for model limitations, not a suggested wager. Keep all attempted models and negative results visible in research artifacts.
5. If a source is unavailable, keep the current useful research accessible. Do not ask a public visitor to enter a provider key or imply that a button will buy data for them.

The readiness panel uses existing dark-theme tokens, semantic headings, native buttons, and a responsive three-column-to-single-column grid. It adds no decorative motion. Marketing copy changes from “See the edge” to “Inspect the price. Demand the evidence,” and “Historical proof” to “Historical research.” This is an internally reviewed design, not a user-validated design.

## Architecture and operating boundaries

Keep the existing Node service and static frontend. Public clients consume server-managed cached snapshots and versioned derived evidence. Operator-only authenticated jobs own any explicitly authorized provider refresh. Never place a bearer credential in browser code or localStorage.

The forthcoming durable budget must reserve spend atomically across instances and restarts, preserve configured reserve floors, and fail closed on invalid settings, unavailable storage, ambiguous accounting, or missing authentication. Real database tests are required; mocks alone cannot verify transaction behavior. This plan neither provisions storage nor approves migrations, secrets, or paid calls.

Keep source records, frozen forecasts, result receipts, code revisions, and current operational state distinct. A newer operational SHA must not rewrite the immutable checkpoint. Matching score receipts can cross-check a result without establishing upstream source independence.

## Ordered delivery gates

### Phase A: safe, useful research workspace

Combine reviewed PR14 code, durable-budget fixes, public cache-only refresh UX, and this readiness slice in a separate local integration branch. Preserve latest main data. Do not combine the isolated JAX workflow or historical prototype branches.

Required exit checks:
- Full offline suite, syntax, data-file diff, and independent review of the combined tree.
- Actual PostgreSQL transaction/concurrency/restart verification before claiming durable spending protection.
- Mobile/desktop browser checks for empty, loaded, expired, retained/error, demo, non-NFL, keyboard and rapid-selection flows. Verify visible content and navigation, not just string fixtures.
- Exact release diff and workflow-trigger review; no unintended live collection or preview deployment.
- Explicit publication and then merge/deployment authorization. Verify exact deployed revision, health, configuration, cached-only behavior and evidence policy without provider calls.

### Phase B: qualified prospective evidence

Preserve the 29-game checkpoint; accumulate and audit outcomes under the fixed protocol. A separately approved, bounded JAX comparison is an operational check, not an accuracy study or a source-independence proof. Decide lawful source lineage, rights, coverage and durable archival before activating a broader collector. Do not substitute a convenient postgame model, backfill forecasts, or optimize a subgroup after observing results.

Exit: recoverable frozen inputs and revision receipts, known source/time boundaries, trustworthy label handling, a fixed sample plan, paired same-time market comparator, and explicit uncertainty/multiplicity accounting. Thirty games is only the current disclosure threshold; do not redefine it as proof of superiority.

### Phase C: model improvement with promotion discipline

Choose one distinct hypothesis from the retained research ledger. Freeze features, as-of availability, exclusions, splits, metric hierarchy, market benchmark and materiality thresholds before new evaluation. Distinguish margin-distribution quality, win probability, cover/push/loss probabilities, and economic returns. Preserve every attempt. A model that repairs push probabilities is not automatically better at choosing a side.

Exit: independent reproduction; no leakage or retrospective source substitution; adequate prospective power; confidence intervals and calibrated probabilities; same-time actionable-price comparison where lawful. Profitability needs fees/vig, accepted-price availability, timing, and verified outcomes. No model promotion or wagering is authorized by an attractive historical score.

### Phase D: product validation before commercialization

With separate outreach permission, run a small task-based usability pilot: can a new user distinguish a raw result from a qualified outcome, explain why the app is not a betting recommendation, and inspect one game's evidence without entering a key? Set the test rubric before sessions and retain all observations. Internal review is not demand validation. Define pricing and distribution experiments only after these basics work.

## Measurement and honest status

For engineering, measure critical-flow test coverage, integrity rejections, cache-only request behavior, failure recovery, and revision consistency. For research, retain coverage/missingness, raw/qualified counts, paired proper scores, calibration and uncertainty. For usability, measure task completion and misconception rates from actual sessions. No analytics or tracking has been added; a measurement plan is not collected data.

Current implementation slice is local only. It improves clarity, not predictive performance. A zero-qualified-outcome dataset remains zero-qualified after this change. Provider access, credentials, paid storage, publication, production release, third-party outreach and ongoing collection permissions are separate decisions.

## Verification of this local slice

- Full repository suite: **336 tests passed, 0 failed, 0 skipped**, Node 24.22.1.
- Focused readiness, evidence and existing UI suite: **33 passed**.
- Syntax checks and whitespace validation passed; independent code/spec review passed after fixing a timer-driven focus-loss issue.
- No changes to `data/`, `src/`, `scripts/`, or `.github/` relative to the PR14 baseline.
- Chromium visual/interaction QA could not launch because the environment rejected its socket setup (`Operation not permitted`), including the permitted escalation attempt. The DOM/unit tests do not substitute for visual certification or assistive-technology testing.
- No provider, credential, production or public-write action was performed. Integration with the separate budget branch and CI on the exact combined tree remain required.
