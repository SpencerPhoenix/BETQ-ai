# Private offline result receipt preparation

Status: **local engineering preparation, disabled for production and scoring**.
This is an offline import/replay path around the existing
`BDL_NATIVE_FINAL_NFLVERSE_SCORE_CANDIDATE_V1` adapter. It is not a provider client,
result collector, authorization to acquire data, or a new active qualification policy.

No runtime server, scheduled workflow, result writer, data file, or current scoring
policy is changed. The existing `SOURCE_CORROBORATED_SETTLEMENT_V2` gate still rejects
these candidates. The CLI never reads credentials or environment secrets, calls a
provider, changes the research journal, or publishes a file. No real source response
or result receipt was collected during this implementation; tests use explicitly
fabricated data.

## What is preserved and checked

`src/bdl-receipt-ledger.mjs` adds a separate private ledger with:

- A versioned disabled policy, canonical full-journal baseline digest, and bound
  original first frozen forecast. The baseline covers parsed JSON values, not its
  original whitespace. A growing or changed journal requires a separate deliberate
  review; this preparation does not silently rebase existing receipts.
- Deduplicated original supplied BDL JSON and nflverse CSV bytes, encoded as base64
  with SHA-256 and byte length. Replay verifies those bytes and reruns the unchanged
  adapter. The source bytes are not reconstructed from selected fields.
- Ordered global and per-game evidence revisions. Same-score observations can add
  evidence without adding a game. An exact observation repeat is idempotent. A
  changed matching score is retained as a correction for review, not silently applied
  to the public result or model performance.
- Strict native-game/team continuity, frozen identity, exact kickoff, final-status,
  score, chronology, and source-content consistency checks. Both source receipts must
  follow kickoff by at least 24 hours and be within the adapter's one-hour review
  window. Conflicting kickoff identities are never resolved by selecting one version.
- Explicit false scoring, source-authenticity, source-independence, official league,
  historical-as-of and source-publication claims. An operator-declared native ID and
  retrieval time are not independent proof of mapping or collection.

The archive verifies **integrity and replay of supplied bytes only**. It does not
authenticate a remote server, prove source acquisition occurred, verify the clock,
establish licensing, or certify independently sourced results. Provider `updated_at`
is record-write time, not the time final status became available.

The receipt chain is not an external trust anchor. Retain a prior ledger/checkpoint
separately and use extension verification to detect rollback or truncation. A
self-consistent replacement of all files and hashes cannot be authenticated by itself.
This local directory is not a managed immutable archive, backup service, or production
durability certification.

## Offline CLI

Prepare local source files only after their acquisition and retention are authorized.
Do not include credentials, authorization headers, URLs or personal information in the
manifest. The following is a **structural example**, not a real observation receipt:

```json
{
  "schema": 1,
  "journalPath": "frozen-journal-input.json",
  "bdlPath": "authorized-single-game-response.json",
  "nflversePath": "authorized-schedules-response.csv",
  "gameId": "2026_10_LV_KC",
  "expectedProviderGameId": 9999001,
  "bdlRetrievedAt": "2026-11-09T18:01:00.000Z",
  "nflverseRetrievedAt": "2026-11-09T18:02:00.000Z"
}
```

The sample ID and times are fabricated. They must not be used to represent a real
request. Relative paths resolve from the manifest's directory. For an extension,
include `previousLedgerPath` pointing to the prior private `ledger.json`.
Unknown manifest keys, remote URLs, symlink inputs, malformed/oversized files and
duplicate JSON keys are rejected. The CLI records the actual current machine clock;
there is no historical-time override. Old files remain replayable through an existing
bundle. They must not be represented as newly observed by inventing retrieval
timestamps; this tool cannot detect that deception because retrieval times are
operator declarations, not authenticated collection receipts.

```sh
npm run results:offline -- --manifest /private/input/manifest.json --output /private/output/new-bundle
npm run results:offline -- --verify /private/output/new-bundle
npm run results:offline -- --verify /private/output/new-bundle --previous-ledger /private/output/prior-bundle/ledger.json
```

The output parent must already exist. The new output directory must be **outside this
repository** and must not exist. Creation is exclusive, with directory mode `0700`
and files `0600` on the tested POSIX filesystem. Existing files and prior bundles are
never overwritten. It contains:

1. `frozen-journal.json`: the preserved parsed journal payload, reserialized as JSON.
2. `ledger.json`: private evidence metadata and exact source bytes.
3. `report.json`: deterministic review-only summary, not a new observation.

Each file is synced before successful completion. Ordinary write failures remove only
the newly created incomplete output. A process crash can still leave an incomplete
directory; verification must succeed before it is treated as a usable bundle. Start
with a fresh destination rather than overwriting a partial or existing bundle.

Terminal output contains counts and hashes, not source bodies. Errors expose only a
sanitized code, not source content, local paths or URLs. Input source bytes may include
unrecognized or sensitive provider fields; **no secret-free or public-publication claim
is made**. Keep these bundles private and out of Git, public assets, CI artifacts and
public APIs. Local filesystem permissions do not provide encryption.

Limits include a 16 KiB manifest, 5 MB journal, 256 KiB single-game response, 4 MB
CSV, 20 MB serialized ledger and 5 MB report. The raw archive total is capped at
8 MB, and canonical data at 16 MB.
The shared parser now uses single-pass field slicing, with 256-column and one-million-cell bounds in addition to its existing byte and row limits. The receipt layer remains more tightly bounded. Do not truncate or rewrite an original response to fit. Larger sources require separate review. Output sizes are checked before creation so an emitted
bundle fits replay limits. All inputs are supplied files; this is not a URL downloader or credential tool.

A separate [manual encrypted sample workflow](BDL_MANUAL_SAMPLE.md) can exercise authorized current transport. It does not activate this ledger for scoring.

## Remaining activation decisions

The official [NFL API documentation](https://nfl.balldontlie.io/#account-tiers), reviewed
November 15, 2026, lists Games on the free tier at five requests per minute. Its
[terms](https://www.balldontlie.io/terms.html) describe lawful analytics and retention
permissions, while preserving third-party-rights and non-official-source limitations.
Documentation is not evidence that an account exists, credentials are authorized, an
actual response is compatible, or upstream sources are independent. This tool accepts
no credentials and does not create an account or subscription.

Before production collection or grading, separately approve and review:

1. Provider account/key handling, bounded collection and cadence; any paid plan or
   storage cost; intended retention and public derived-data use.
2. Real native event-ID mapping and one bounded, authorized response, without claiming
   a current observation reconstructs missing historical availability.
3. Private durable source storage, independent checkpoints, timestamp provenance,
   concurrency, recovery and least-privilege access.
4. A new versioned scoring policy, compatible writer/readers, append-only result
   revisions and clearly separate cohorts. Do not relabel BDL finality as ESPN or
   nflverse finality.
5. A separately designed schedule-evidence amendment for the eight retained kickoff
   conflicts. This tool preserves them and cannot remove quarantine.
6. Exact-commit release checks and deployment approval. No environment flag in this
   change can activate the adapter or start scheduled collection.

Qualifying outcomes would still not repair missing paired-market provenance, satisfy
the 30-game reporting threshold automatically, establish ROI/CLV, or authorize bets.

## Verification

Run `npm test -- tests/bdl-receipt-ledger.test.mjs tests/bdl-receipt-cli.test.mjs`
and the normal `npm run check` / `npm test` aggregate gates. The CLI tests run in a
child process with HTTP, HTTPS, TCP, TLS and fetch calls disabled and an explicitly
synthetic test clock. These are offline engineering tests, not live-provider checks.

Local verification on November 15, 2026: Node 24.22.1 syntax checks and all **1,082
tests passed**, with zero failures or skips and credentials absent from the test
environment. The 67 new ledger/CLI tests cover archive replay, chronology, corrections,
mapping continuity, immutable baselines, private file handling and disabled production
boundaries. Independent targeted review passed 223 tests after closing global native
team-mapping and inert-array-input findings. Node 22 CI, actual provider compatibility
and managed production storage have not been tested for this local preparation.

The bounded-input regression also prepared and replayed an exactly 2 MB fabricated
CSV in a 256 MB Node heap. Malformed 2 MB inputs and oversized 2 MB + 1 byte / 12 MB
inputs failed with sanitized errors and no partial output or process crash.
