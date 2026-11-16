# Reviewed BDL result grading V1

`BDL_NATIVE_FINAL_NFLVERSE_SCORE_REVIEWED_V1` is an **operator-reviewed,
retrospective descriptive model-grade policy**, not wager settlement, official
league certification, independent source authentication, or proof of model edge.
It does not replace `SOURCE_CORROBORATED_SETTLEMENT_V2` and never enters that
aggregate cohort, its sample count, confidence gates, ROI or promotion decisions.

## What the policy requires

- Exact season, teams, canonical game ID and frozen kickoff. Existing schedule and
  provider-identity conflicts remain quarantined; no historical record is repaired.
- BDL native game/team IDs, explicit final status, matching date-list/detail fields,
  and agreement with the contemporaneously retrieved nflverse score row.
- Original collector observations at least 24 hours after kickoff, in the original
  one-hour review window. Both observations must be at least as new as the latest
  prior result and strictly newer than any previous BDL review receipts. A newer
  review wrapper cannot revive older observations after a correction. A provider
  `updated_at` is not a final-publication time.
- Full original source-byte hash replay privately, the immutable first forecast's
  ID/digest, all retained target snapshots and the prior result digest. A changed
  whole journal baseline cannot be silently rebased by the offline importer.
- Original receipt timestamps, exact allowlisted public record fields, and a
  GitHub run/commit plus encrypted-artifact/ledger/entry hashes. These references
  are operator provenance assertions, not signatures from the provider.

The importer has no transport, credential access, decryption, logs or filesystem
writes. A trusted operator first verifies the successful run and encrypted artifact,
then decrypts in memory and calls the importer with that verified context. It
replays one original sample and emits only the derived public journal revision.
The private ledger's disabled flags are not flipped. Original response bodies,
list payloads, secret values and private keys must never be published.

A reviewed result can add model direction, Brier loss and log loss against the
**absolute first frozen pregame forecast**. Later forecasts cannot replace a missing
or invalid first baseline. Ties remain excluded from binary grades. Market metrics
require the original market provenance contract; no historical quote fields are
inferred or filled in.

## Revisions, corrections and honest scope

The highest result revision across all policies wins. An actual later correction
appends a new record and withholds a previously available grade until its own
provenance qualifies. The reader must never fall back to an older reviewed score.
Routine same-score lower-provenance polling does not erase the stronger descriptive
review; an exact reused receipt does not create another revision. A later V2 receipt
can qualify on its own terms. All original snapshots and result rows are retained.

The table and game dossier identify this separate cohort and show it apart from
V2-qualified grades. `sourceIndependenceVerified`,
`sourceAuthenticityIndependentlyVerified`, `providerPublicationTimeVerified`,
`historicalAsOfVerified` and `officialLeagueCertification` remain false. BDL and
nflverse could share upstream sources. Encryption proves private transport integrity,
not those stronger claims. The observation is not asserted to have been known at
final whistle or to remain current at publication.

## Initial reviewed observation

[Manual sample run 43860121640](https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/43860121640)
ran on commit `9e8442002c32b9813f764c691d34b95957b6b2a0`. Its original review time is
`2026-11-16T11:43:10.057Z`. One NYG–PHI result revision is appended; 347 snapshots,
44 tracked games and all 18 previous result records are preserved. Eight kickoff
conflicts remain quarantined. The first NYG–PHI forecast assigned home win
probability 0.572526; the observed 11–19 final gives model Brier loss 0.327786020676
and log loss 0.8498618111683054, with incorrect direction. Market metrics are absent.
This is one descriptive game grade, not evidence of overall performance.

## Publication scope and rights limitations

The owner's request covers this app's derived analytic display. [BDL's terms,
reviewed November 16, 2026](https://www.balldontlie.io/terms.html), permit own-app
analytics and display, but prohibit substitute sports-data API feeds and disclaim
third-party rights clearance. We publish only this app's allowlisted factual result
and analytic provenance, not an upstream response archive or standalone data feed.
The ledger's `sourceUseRightsEstablished:false` and
`publicRedistributionAuthorized:false` remain unchanged: it cannot certify legal
rights. This change does not claim blanket rights clearance or authorize wager
acceptance, grading or settlement. nflverse attribution remains intact.

## Activation and verification

No provider calls, credential settings, scheduled collection, workflow permissions,
subscription or production refresh controls are activated by this policy. New
samples still require a separately scoped manual run and review. The first retained
sample was decrypted/replayed locally without another provider request. Public CI
uses fabricated fixtures; it cannot independently reproduce private source custody.
Unit and offline-browser tests cover unknown-field rejection, tampering, chronology,
first-baseline binding, corrections, quarantine, UI agreement and closed aggregate
gates. Exact release CI and post-deploy read-only checks are still required.
