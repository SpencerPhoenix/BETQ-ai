# Data-to-card-to-outcome alignment

Local work based on combined candidate `3db383e5805f375ab965971769d5f0c735fbacc7`. Prior candidates and their publication state are unchanged.

## Verified source state

Read-only GitHub verification returned main `69ca969eeef474b379a0b8bc729a1cdde348dc6e`. Render still reports live revision `607366752c0d32410caf23fc068335acb06f858e`. Safe app reads at approximately November 7, 23:58 UTC showed:

- Live model built November 3, through November 2; live injury file November 4 with 244 team/week reports and unavailable by age.
- Live evidence: 159 snapshots, 31 games, 3 raw results, zero source-qualified outcomes. Health still reported two results and an available injury source.
- Latest repository injury file: November 7, 272 team/week reports. The earlier local injury-delivery repair is already included in this candidate.

Only metadata and safe read endpoints were inspected. No live slate/score/provider request was made.

## Implemented alignment

1. The validated journal reader supplies one detached internal snapshot: journal, recomputed summary and publication metadata/digest. Evidence, retained game index/detail and cached health use that same accepted state. Dossier requests may coalesce with the fixed public BETQ journal read; they do not call an odds/outcome provider. No HTTP route exposes the internal full journal.
2. Invalid or regressing reads retain the same prior history across views. Later outcome corrections withdraw qualification consistently. An invalid startup bundle is unavailable rather than a fabricated empty successful view; a subsequently accepted public journal can recover it.
3. Both feed and dossier reject all observation timestamps after the actual reader clock. A capture 30 seconds ahead can no longer appear in evidence while causing the dossier to fail. Source/model/market and final-result receipt timestamps use the same strict gate. Existing relative provenance tolerances and scoring policy are not loosened. Cached reads and the HTTP handler recheck the shared identity/chronology gate with their actual reader clock, so clock rollback or a mismatched injected clock cannot expose future records or pre-kickoff results. Invalid appended identities, orphan results and receipt chronology are rejected before they can poison the append-only retained baseline.
4. Dossier UI labels bundled versus public-retained source, requires the public digest contract and warns when the last read failed. Response/read timestamps are not presented as new captures or verified original publication.
5. Health/config use the same existing Elo/EPA readiness checks as their model routes. Bundled build/cutoff and reference-matchup scope remain explicit. This neither retrains a model nor substitutes current probabilities for frozen forecasts.

## Verification

Tests replay the unchanged real 159-snapshot journal through concurrent evidence/index/detail requests, verify identical digests and counts, preserve original forecast values, exercise rejected refreshes and appended result corrections, distinguish missing/empty/recovered source, test detached copies, reject sub-minute future observations and invalid appended history, handle clock rollback and differing reader clocks, align stale model flags, and validate public-retained UI provenance and failure warnings. Existing paid-intent, authentication, budget, strict scheduling and wager controls remain in the full suite.

The original data, model artifacts, workflows, lockfile, odds/budget modules, schedule modules, producer and scoring/qualification policy files are unchanged. Tests use mocked repository responses, synthetic fixtures or loopback; no fictional test record is written into research data. Installed dependencies were reused locally after byte-identical lockfile verification. This is not a new clean registry-install or production database test.

## Prioritized remaining actions and blockers

1. **Finish the two confirmed capture-boundary fixes.** The audit reproduced an oldest quote aged 599 seconds at analysis but 609 seconds at capture remaining eligible, and a provider-event ID change being admitted without quarantine. Both are offline-fixable. Preserve old records and their missing provenance; retain absolute quote time on new records and explicitly quarantine ID changes/reuse.
2. **Complete the separate forecast-display alignment.** Latest retained forecasts, the deployed model and current market consensus have different provenance. Never use a pending preview as a latest snapshot or relabel a current recomputation as a frozen capture. Display work is separate from this patch.
3. **Choose and validate an actual final-outcome source contract.** The retained nflverse CSV lacks explicit terminal status and canonical UTC kickoff required by the current receipt policy. More CSV refreshes cannot qualify the three raw results. BDL's alternative policy is disabled; ESPN collection/retention rights are unresolved. Approved source access/retention, replayable bound receipts, correction handling and independent policy review are required before activation.
4. **Make the service usable without implying continuous live odds.** Retained browsing is durable, but live quotes use a five-minute process-local cache and are absent after restart or outside authorized refresh windows. Persistent quote storage or increased cadence requires rights, budget/setup and authorization. Do not silently buy data or relabel stale quotes fresh.
5. **Align model delivery without rewriting history.** The combined bundled Elo build is November 6, through November 5; the latest retained forecasts use November 3, through November 2. No retained tuple matches that newer bundle. Delivery/version receipts can be designed offline, but updated artifacts and new forward captures are separate operations.
6. **Resolve protocol and schedule lineage before claiming measured forward advantage.** The future comparison draft `279a45f` is separate and deliberately unregistered. Actual pre-registration needs approved publication before a genuinely future cohort. LV–SF's frozen 21:05 kickoff and later 21:25 observation remain quarantined; no silent identity rewrite or tolerance is authorized.
7. **Release only the exact reviewed combined tree.** Real browser/mobile/keyboard QA, exact-head CI and approval for publication/merge/deployment remain open. Pending publication of an older candidate does not authorize releasing this newer tree.

These are delivery, integrity and measurement tasks, not evidence of predictive edge, source independence, verified ROI/CLV or permission to wager.

## Final local verification

- **705 full offline tests passed**, zero failures or skips. Syntax and whitespace checks passed.
- Independent final review passed 110 focused tests and found no remaining blocker within the shared-reader, dossier, health and time-gate scope. Reported acceptance poisoning, future-time, clock-rollback and differing-handler-clock cases were fixed and retested.
- The production full-journal reader is aligned. Explicit offline/bundled-only embedding can omit publication/digest metadata; legacy summary-only test injection is not a full-journal synchronization contract and must not be used as a production substitute.
- Prior `3db383e` worktree remains clean and unchanged. No publication, deployment, credentials, paid-provider request or data rewrite was performed. Browser/mobile and exact-head CI remain unverified for this local tree.
