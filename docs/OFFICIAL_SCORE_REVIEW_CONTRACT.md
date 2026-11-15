# Official public-score review contract V1 (local draft)

This is an **offline, disabled, nonqualifying metadata contract**, not an official-site feed. No actual page observation receipt was created by this implementation. The existing settlement policy, captures, results, scores and statistical cohorts are unchanged.

## Why a separate evidence ledger

The November 9 audit of main 9157f19 reports 203 snapshots, 31 games and 16 raw results with 0 qualified outcomes. Its one-time official-page comparisons are useful exploratory evidence, but do not contain original response archives or per-page observation timestamps. A report's review date/final clock check is not a substitute for when each source was inspected. Do not generate observation receipts from that report.

The audited main 9157f19's same-result-hash deduplication does not provide a general official evidence-amendment path. This contract gives official reviews their **own evidenceRevision**, separate from settlement revision and resultHash. The same score can receive a genuinely new observation without counting another game or changing its forecast. An exact repeat is idempotent. Neither legacy ESPN receipts nor their fields are manufactured or relabeled.

The original implementation used verified local integration 2107bd7 (159 snapshots/3 raw results). The separate local integration documented in `CURRENT_DATA_INTEGRATION_20261109.md` preserves main 9157f19's newer data exactly. The subsequent `SCHEDULE_CONFLICT_QUARANTINE.md` read boundary keeps unaffected games readable while preserving and excluding the unresolved LV–SF frozen-kickoff conflict. Neither this draft ledger nor its tests authorize rewriting the journal, resolving that conflict, collecting from official sources or qualifying a result.

## Contract and qualified claims

`OFFICIAL_PUBLIC_SCORE_REVIEW_V1_DRAFT` remains `DISABLED`. Pure functions in `src/official-score-review.mjs` create/validate an in-memory ledger, derive a target, append a review and report dispositions. No filesystem, network, credentials, workflow, HTTP route or collector integration is included.

A target binds the exact earliest stored forecast (capture then code-point ID tie-break), frozen game identity, current highest settlement revision and complete settlement SHA256. Canonical NFL teams, encoded season/home/away, valid calendar season, provider continuity and duplicate-event identity must agree. Existing legacy result fields remain unchanged; missing identity is not written into the old result.

Receipt observations require:
- Method distinguishes `HUMAN_PAGE_INSPECTION` from `INTERACTIVE_AGENT_PAGE_INSPECTION`. These declarations do not authenticate a reviewer or establish permission. Automated and prior-audit-reference modes cannot create a current observation.
- One to four distinct canonical HTTPS URLs on the explicitly reviewed NFL, Seahawks, Jaguars or Commanders hosts. No credentials, query, fragment, alternate ports or arbitrary subdomains. A team source must belong to a participating team. Host checks do not authenticate page contents, license use, or establish independent lineage.
- Page type, season, source **game** date, normalized home/away teams and source-displayed team labels with unambiguous mappings. The game date is not the page's publication date. Unrecognized shortened names, ambiguous orientation or date mismatches require review.
- Explicit ordered numeric score claims and an explicit `FINAL` observation. These may come from separate pages; every supplied score must agree with the retained result. A score in an article title alone does not establish explicit finality.
- A canonical `observedAt` for each actual inspection. `recordedAt` is distinct and must be current relative to the append clock (default system clock; tests inject a deterministic clock). Supplied recorded time can be at most 60 seconds old, never future. Observations must be no more than 1 hour before recording, never future, at least 24 hours after frozen kickoff and not before the retained result's original verification time. New evidence revisions cannot backdate behind prior review recording. Replay uses each original recording time, so legitimate historic reviews do not age out. A trusted clock and external witness are still absent; clock metadata is not publication proof.

The version deliberately does not accept `sourcePublishedAt`, `sourceUpdatedAt`, raw-source hashes, rights grants or independence claims. Unknown publication time remains unknown. In particular, “12:33 AM” without a source timezone is not converted into a UTC timestamp. `receiptSha256` hashes the supplied metadata, **not** source bytes. `sourceContentSha256` stays null; no immutable archive is implied.

A structurally valid receipt supports only a declared review that the referenced pages showed matching final scores at the stated inspection times. It remains unauthenticated observation metadata. It cannot establish historical as-of availability, original source vintage, official league certification, source endorsement, independent upstream origins, licensed commercial data, betting eligibility or profitability.

## Append integrity and corrections

The ledger baseline binds all original snapshots and ordered settlement records; snapshots may reorder but their payloads must not change. Every evidence entry commits the baseline digest, previous global entry digest and previous per-game evidence digest. Strict shape/uniqueness checks reject ambiguous baseline bindings. Appends return detached copies; validation functions return their input. The API never returns or mutates a revised journal.

The caller must provide the expected current result SHA256. A concurrent new settlement revision requires a fresh target/review. Old review entries remain preserved and are reported as superseded, never silently transferred to corrected results. An unchanged score hash does not suppress new declared observation metadata, while the exact same receipt cannot manufacture revisions by changing its recording timestamp.

Keep the previous complete ledger externally and call `assertOfficialScoreReviewExtension(previous,next,journal)` when accepting an update. This catches truncation/rollback relative to the known prior state. Self-consistent hashes alone cannot detect a fully rewritten ledger or prove its origin; `completeHistoryVerified` remains false. No durable or authenticated checkpoint store is implemented.

Existing scoring gates are not extended. Every new review returns `scoringEligible:false`, `qualifiedOutcomes:0`, unknown upstream independence and no historical-as-of/source-publication/archive verification. Existing genuinely qualifying records retain their prior status because the journal is untouched. A new source policy, with rights and authentic evidence requirements, would need separate versioning and review before use; a boolean cannot activate this draft.

## Source-rights review, November 9 2026

Official public access is not a commercial collection license. User authorization to develop local code is separate from source-owner permission. Manual mode and metadata-only storage do not circumvent terms.

- NFL: https://www.nfl.com/legal/terms/ . Sections 1.3, 8 and 11 restrict commercial/systematic collection, commercial harvesting and certain non-homepage links absent permission.
- Seahawks: https://www.seahawks.com/about/terms-and-conditions/ (displayed update September 24, 2026). Sections 1.3 and 11(f) restrict commercial/systematic collection; Section 8 addresses linking/third-party terms; Section 12 restricts NFL-wagering use.
- Jaguars: https://www.jaguars.com/appterms (displayed effective November 6, 2017; expressly includes jaguars.com). Personal/noncommercial limitations and prohibited-use provisions address both automated access and manual monitoring/copying without prior written consent. Manual inspection is not an exemption.
- Commanders: https://www.commanders.com/about-us/terms-and-conditions (displayed update August 26, 2026). Personal/noncommercial intended-use limitations and copying/redistribution restrictions apply. Absence of an explicit robot clause in the retrieved text is not a grant of automated ingestion rights.

These are rights-review flags, not conclusions about enforceability or every possible use. A qualified review must resolve the precise collection, retention, commercial use, publication, linking and betting-related purposes before production automation or public redistribution. No contact, consent request, agreement acceptance, game-page request, API key or paid call occurred here. Terms pages alone were read for this review.

## Reproduction and next decision

`node --test tests/official-score-review.test.mjs`, direct `node --test`, and the direct Node syntax checks listed in package.json exercise metadata binding, same-score amendments, idempotency, stale/future/backdated receipts, conflicts, identity aliases, unchanged scoring, and ledger tampering. Fixtures are explicitly fabricated and remain in-memory test data, never actual observations.

The next decision is a rights-compatible source and a separately approved actual observation procedure. Existing official links can remain prior-audit references; this implementation cannot turn them into fresh receipts. No production automation should be enabled until rights and source contracts are resolved. Retain the full 16-game exploratory scorecard, including misses and market benchmarks, separately from any future qualified cohort.
