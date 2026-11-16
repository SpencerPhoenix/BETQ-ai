# Future market provenance: local correction and operational plan

## Scope and evidence baseline

This patch is local preparation, not a live-data activation. It makes no paid provider requests, uses no credentials, changes no production settings or schedules, and does not touch BALLDONTLIE integration. It changes no retained data, forecasts, outcomes or kickoff identities.

The starting tree is `8ab2c965bea7121c4b16b002bfc3a975de7540f4`, shared by local `5525705` and observed remote main `6163130ecd6b7bdee090e01fbbac5a29e5f1cd1f`. Integrators must re-read fresh main and preserve intervening evidence, injury and results-pipeline changes before publication.

The [retained-evidence audit](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/43823325006) is reproducible against this baseline at 2026-11-16T07:21:56.000Z:

- 347 retained snapshots across 44 games; all 347 lack the absolute oldest quote timestamp, so none passes market pairing.
- 44 games have missing required market provenance, 17 have an uncorroborated result, and 8 have a kickoff conflict. These reasons overlap, not 69 different games.
- 18 recorded results, 0 qualified game grades, 26 pending games. Missing market proof alone does not prevent an independent model grade after its separate outcome and identity requirements are met.
- Journal SHA-256 remains `9ddc1b612e3a2620213d1d0149670f26a087b4ce43d742eab6dbcf7297a2f199`.

This is a dated baseline, not a claim about future main or the live service.

## What was already implemented

`market-consensus.mjs` already used each constituent h2h market's original timestamp, not the bookmaker timestamp. The producer returned absolute oldest/newest times with the original provider receipt. Response analysis followed awaited injury/private-capture work. Collector admission rechecked the oldest quote at actual capture time with a strict 600,000 ms limit and at least three books. Legacy records could not be made eligible by a newer quote.

## Corrections in this patch

1. **Explicit capability contract.** `/api/health` advertises a detached static descriptor. Collector preflight requires exact freshness, original receipt, minimum distinct books, immutable-history and unambiguous bookmaker-identity semantics. Capability does not imply configured authentication, budget readiness, live freshness, source authenticity or successful collection.
2. **Deployment race binding.** The collector pins model identity plus market freshness and composite market-contract identity. Supporting runtimes reject mismatches before source access. The returned real NFL h2h descriptor is checked again; a mismatch is rejected without retry. A genuinely older runtime may ignore new headers and consume the one request before response rejection, so this is not an absolute zero-spend guarantee against old code.
3. **Unambiguous constituent identities.** All repeated valid bookmaker keys are excluded before quote/price filtering; a stale or malformed duplicate cannot be ignored to select a favorable copy. Duplicate h2h entries reject that bookmaker. Padded, control-containing, absent or oversized keys are not repaired. Bounded, fully enumerable collections are required. Three unaffected valid books may still qualify. Distinct bookmaker keys do not prove independent upstream sources.
4. **Honest capture diagnostics.** `derivedMarketDiagnostics` counts model-eligible observations before identity admission and reports allowlisted failure reasons, never raw provider text. `marketCapture` counts only new snapshot IDs in the resulting journal, not all attempted recaptures. It distinguishes paired, partial, model-only and no-new-market evidence, and reports same-ID improvements that were deliberately not written. These counts are not independent source attestations or proof of durable disk publication.

`captureStatus: SUCCESS` retains its existing model-capture meaning. It must not be read as evidence of successful market pairing; consult the new market-specific status and counts.

## History and scoring remain immutable

No oldest quote can be inferred from the newest timestamp, relative age, bookmaker timestamp, current odds, or a later collection. A fresh candidate with the same deterministic snapshot ID never replaces its old model-only row. A later paired snapshot for an existing game remains later evidence, not that game's original baseline.

The per-game grading/forward-summary absolute-first baseline is unchanged. The separate sequential/direction reports use their existing earliest-market-eligible cohort; this patch does not silently unify or redefine those selection rules. Kickoff conflicts remain quarantined. No new grades, ROI, CLV, betting permission or validated edge are established here.

## Provider contract and next bounded verification

The [current Odds API v4 guide](https://the-odds-api.com/liveapi/guides/v4/#more-info) now documents market-level `last_update` and deprecates bookmaker-level updates. Older examples on that page still show bookmaker-level fields. This supports retaining the bulk route, not adding per-event requests solely from the old examples. Actual payload support for this account remains unverified. The [documented cost formula](https://the-odds-api.com/liveapi/guides/v4/#usage-quota-costs) gives one usage credit for one region and one market, such as US h2h. Account tier, remaining quota, and dollar cost are not established by this code review.

After a separately authorized rollout:

1. Run exact-commit Node 22 CI and verify the deployed descriptor and expected model through read-only health first. Deploy producer and collector compatibility changes together. Older producer health will intentionally stop market capture but still allow the collector's independent public-results reconciliation.
2. Verify operator authentication and a durable shared credit ledger with valid TLS, a current verified quota baseline, explicit daily credit cap and reserve, and no unresolved reservations. Do not substitute an in-memory limiter or invent a baseline. Reuse an approved database if available; a new paid database needs a provider/plan/total spending decision.
3. Obtain a bounded one-time scope for the existing NFL h2h bulk route, one US region, at most one refresh, no retries, no historical/per-game expansion, no new subscription or charge, and the account's known remaining quota. Prefer no new dollar spend within an already approved quota. If this cannot be assured, clarify the total monetary limit first.
4. **Do not accidentally activate recurring spending.** `capture-evidence.yml` already has scheduled runs and shares `BETQ_OPERATOR_REFRESH_TOKEN` with manual probes. Supplying that shared secret and making the server ready can arm scheduled refreshes. Keep that scheduled path unarmed for a one-off probe, or get explicit recurring cadence, quota and dollar limits before enabling it. This patch changes no workflow or secret.
5. For the one approved response, inspect whether original h2h timestamps and three unambiguous books are actually present. Retain only existing approved derived fields publicly. Do not place raw prices, bookmaker identities, provider response bodies or secrets in Actions logs/artifacts. Any new private raw-retention mechanism requires its own reviewed storage/access/retention scope; this patch does not create or claim one.
6. Accept only future pregame observations satisfying source receipt and capture chronology. If no eligible pair is available, report model-only capture and its reason. Do not keep spending to obtain a preferred result. Re-audit after a genuinely new game's first forecast; the historical 44 missing first-baseline proofs will not disappear.

Result corroboration and kickoff reconciliation are separate work streams. This patch cannot supply independent final-result receipts or resolve immutable kickoff conflicts.

## Verification

- Full local suite: **1,235 passed**, 0 failed/skipped, Node 24.22.1, empty credential environment. No real provider calls were made; transport tests use mocks and loopback fixtures.
- `npm run check` and `git diff --check` passed. Independent read-only review found no blockers; 159 scoped offline tests passed and six changed/new runtime modules passed syntax checks.
- New tests cover bookmaker/market permutations and malformed duplicates, original timestamp boundaries, latency downgrade to model-only, pre-spend mismatches, old-runtime response rejection without retry, actual collector output, non-replacement of immutable baselines, and safe count-only diagnostics.
- Data, workflow, dependency/lockfile and BDL implementation files are unchanged. Node 22 remote CI and live runtime verification are not performed for this local-only task.
