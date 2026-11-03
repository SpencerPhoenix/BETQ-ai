# Synthetic BALLDONTLIE and nflverse cross-check

This is an offline, default-disabled adapter experiment. Its one checked-in
example is fabricated, including IDs, scores, clocks and source bytes. It is not
a record of an actual game or provider response. No production module imports
the adapter, and no workflow activates it.

## Verified schema basis

The [official NFL documentation](https://nfl.balldontlie.io/#games), inspected
November 3, 2026, documents a games response with nested home/visitor teams,
season, kickoff, numeric scores, `status_state` and `updated_at`. The lifecycle
value `final` is distinct from scheduled, interrupted and unknown states.
`updated_at` means the record was written; it does not establish source freshness
or original score-publication time. The documentation lists games on the free
tier but still requires an API key. This adapter contains no transport or key
handling and makes no claim about upstream data independence.

## Local-only commands

- `npm run research:synthetic-balldontlie` reports disabled status.
- `npm run research:synthetic-balldontlie -- --synthetic-fixture` checks only the
  fixed repository fixture after verifying its pinned SHA-256. It accepts no
  alternate file, URL, live mode or write option. Output goes to stdout.

The source bytes use a fabricated nflverse CSV and a fabricated BALLDONTLIE-shaped
JSON page. The adapter validates canonical UTC receipt times, bounded payloads,
complete-page metadata, distinct provider IDs, team orientation, season/phase,
exact kickoff, both integer scores and explicit consistent final lifecycle.
It reuses the existing nflverse delayed-finality and frozen-game identity checks.
Ambiguous source records are rejected before choosing a score or lifecycle.
Duplicate CSV headers, inconsistent row widths and conflicting provider team IDs
are rejected. One physical event cannot count under multiple frozen game IDs.

The accepted example's local gameday is November 2 while kickoff is November 3
UTC; dates are not equated merely by truncating the UTC timestamp. Provider
record-write time is retained separately from fabricated collector receipt time.
Raw-byte hashes are consistency fingerprints, not evidence of authentic sources,
independence, trusted clocks or final-score authority.

## Deliberately nonqualifying output

Every matching result is labeled
`CROSS_CHECKED_FINAL_INDEPENDENCE_UNVERIFIED`, with
`sourceIndependenceVerified: false`,
`qualifiesForExistingCorroborationGate: false`, `syntheticOnly: true`,
`officialLeagueCertification: false` and `publicationAuthorized: false`.
It is not an existing finality attestation or a settlement record.

Tests explicitly show that the unchanged attestation and settlement gates reject
this output, reconciliation appends nothing, the publication guard rejects an
attempted promotion, and qualified metrics remain withheld. A tied fixture can
match but gains no scoring eligibility. Agreement between provider-shaped
records does not establish independent origins or predictive advantage.

## Bounds and future decisions

This conservative experiment requires canonical millisecond UTC timestamps and
an explicit terminal `next_cursor: null` page. It rejects ambiguous same-season
home/visitor rematches in a single page rather than selecting one. These are
adapter restrictions, not claims that all real responses use those forms.
Frozen dates and seasons must match the repository's Eastern NFL gameday and
season-boundary rules for the kickoff instant.
Actual endpoint compatibility remains untested.

No signup, API credential, provider request, source activation, raw real-source
archive, paid use, journal change, deployment or publication is included. Future
live use requires a separate source-rights and provenance review, explicit
authorization and reviewed transport/collection changes. Independence must not
be inferred from two different service names. Existing qualifying gates and
the ESPN adapter are unchanged; this is not an activated replacement.
