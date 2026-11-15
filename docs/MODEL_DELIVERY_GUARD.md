# Bundled model delivery guard

## Observed fault, not a new model-performance claim

Read-only inspection on 2026-11-09 found the production deployment still on
`607366752c0d32410caf23fc068335acb06f858e` (live since November 5). Its bundled Elo
artifact was generated November 3 through results dated November 2. The inspected
main revision `9157f19ae43430f9f79af8aafc9c1a2efe21e018` held a November 6 artifact
through November 5. The source server loads its bundled artifact once on startup;
the collector obtains predictions from that server, not from GitHub's newer file.
Consequently subsequent retained captures honestly identify the older live build.
The training workflow publishes a Git commit but does not deploy that commit.

Render reported commit-triggered automatic deployment enabled, but no newer deploy
or relevant deployment/build event was returned. That observation does not establish
why automatic deployment did not fire. Provider-connection/webhook troubleshooting
and an explicitly approved release remain separate operational work. No provider
request or deployment was made to diagnose this mismatch.

References:
- [Deployed artifact](https://github.com/SpencerPhoenix/BETQ-ai/blob/607366752c0d32410caf23fc068335acb06f858e/data/nfl_elo.json)
- [Inspected main artifact](https://github.com/SpencerPhoenix/BETQ-ai/blob/9157f19ae43430f9f79af8aafc9c1a2efe21e018/data/nfl_elo.json)
- [Render deployment behavior](https://render.com/docs/deploys)

## Exact identity, explicit trust boundary

`NFL_ELO_CANONICAL_ARTIFACT_V1` identifies the entire parsed JSON artifact with
SHA-256 of recursively key-sorted objects (array order preserved, finite JSON
values only). This is a canonical-content hash, not a hash of file whitespace or
a Git blob. Version, canonical build timestamp, result cutoff, fixed source
project, existing model readiness and freshness are checked. A cutoff must be a
real date whose entire day precedes the build. Future builds fail closed.

The runtime holds a private clone of its bundled artifact and supplies the same
identity through public health, the model report, live NFL-moneyline slate metadata
and each available Elo projection. This is an assertion by the contacted HTTPS
runtime. It is not an independent signature/attestation, historical publication
proof, source independence, model approval, or proof of calibration/profitability.
A compromised endpoint could lie; the collector still trusts its checked-out code,
artifact and explicitly approved operator origin. No credentials enter metadata.

## Collector behavior

1. Existing operator origin/token validation runs locally. It does not transmit a
   credential yet. The collector reads its checked-out `data/nfl_elo.json`.
2. Public `/api/health` is requested at the same approved HTTPS origin with no
   authorization header or paid intent, no redirects/cookies/cache, a 20-second
   timeout and 32-KB response bound. Health must have a canonical timestamp no more
   than 60 seconds old and not in the future, compatible runtime, ready paid-capture
   prerequisites and the identical model identity.
3. Only after a match does the existing single authorized NFL moneyline request
   carry `x-betq-expected-model-sha256` alongside the existing operator bearer and
   paid-intent header. The updated receiver rejects an invalid, unavailable or
   different hash with HTTP 409 `MODEL_DELIVERY_MISMATCH` **before** `getOdds`.
   The optional header is valid only for live NFL moneylines. Other public/cache
   and non-collector paths retain their existing authentication/cost behavior.
4. The response must repeat the expected aggregate identity and every available
   projection's exact identity/version/build/cutoff. Nonboolean availability is
   rejected. Direct observation derivation also rejects inconsistent claimed
   identity. No retry, relabeling, or fallback to a different model occurs.
5. New snapshots retain the canonical artifact hash and policy. Old records without
   them stay unmodified and are not retrospectively upgraded. Result qualification,
   cohort selection, model probabilities, training and promotion remain unchanged.

The workflow's existing metadata-only preflight also compares the checked-out
artifact; the collector repeats the check so calling the script directly cannot
skip it. Existing schedule/CSV result reconciliation still runs independently when
model capture is blocked. This guard does not claim zero other public source reads.
It does not create another paid request or alter schedules, limits or credentials.

A deployment race to another updated server fails before a provider request. A
rollback to old software that ignores the header can still consume the one
previously approved request; the response recheck prevents its forecast capture.
That residual limitation is explicit, not a zero-cost guarantee across arbitrary
old/compromised receivers. Health clock skew can deliberately block capture rather
than weaken freshness. Daily training can intentionally pause capture until that
exact artifact is released; no automatic download or hot promotion is introduced.

## Verification and release prerequisites

All tests are synthetic/local; live providers and real keys are neither needed nor
used. Dedicated tests cover canonical hashes, modified parameters/ratings, stale
and future metadata, invalid dates, missing/wrong identity, same-origin unauthenticated
health, bounds, zero paid fetch on preflight failure, receiver race rejection,
post-response rollback detection, strict availability, private artifact immutability,
and legacy evidence preservation. Existing producer/admission fixtures are adjusted
only to supply explicit synthetic source metadata and valid chronology.

The original guard was developed on local integration `2107bd7`. It is now
combined locally with data-preserving schedule quarantine `1aa17bcd`, which retains
the verified main `9157f19` data. The integration preserves all data, schedules,
configuration and lockfile bytes; exact integration verification is recorded in
`DELIVERY_QUARANTINE_INTEGRATION_20261109.md`. Before publication/release, recheck
main for newer evidence/model data, preserve any additions, and rerun tests/review. After separately authorized deployment, verify exact deployment revision and
public health/model identity against the chosen artifact before permitting collection.
Do not run the old model-production probe: it contains a live-odds request. Do not
rewrite historical snapshots to the newer model or imply either model beats the market.
