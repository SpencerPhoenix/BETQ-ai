# Outcome scoring qualification

The v2 receipt-binding amendment changes local collector receipt handling and
read/write validation, but not the source journal, schedules, source eligibility
or statistical reporting threshold. It does not activate a feed or grant archival
rights. No new source is requested. See `FINAL_RESULT_RECEIPT_READINESS.md`.

`SOURCE_CORROBORATED_SETTLEMENT_V2` distinguishes recorded scores from scores
eligible for descriptive outcome metrics. The historical `settledGames`,
`pairedMarketGames` and `pairedChallengerSettled` fields retain their raw
non-tie counts. New `sourceCorroborated*` counts drive every outcome cohort:
forward Elo, paired market, paired challenger, and sequential market evidence.
Recent uncorroborated scores remain visible with a null Brier value.

Eligibility requires the retained ESPN/nflverse source contract plus explicit
`FROZEN_RESULT_RECEIPT_V1` binding metadata:
a community source hash and receipt time, an explicit matching cross-source
final-status attestation and hash, a canonical reconciliation timestamp, and
valid positive revision. The primary terminal and community receipts must bind
the same full frozen game identity and scores, and use identical source digests
and observation times. Both must be at least 24 hours after kickoff and within
one hour before / one minute after reconciliation. The ESPN attestation has the
same 24-hour floor and one-hour freshness limit, with two minutes of future skew. Receipt freshness is relative
to that historical reconciliation, so legitimate historical evidence does not
age out. All frozen snapshots for a game must agree on identity. The result's
game ID and date must match the frozen game. The highest unambiguous revision
is selected before eligibility is checked. Conflicting revisions or provenance,
and histories with unknown or invalid revisions, fail closed. Valid revisions
may be stored out of order without changing the selected result.

This recognizes the draft ESPN/nflverse receipt format only; it does not fetch
or archive ESPN. BALLDONTLIE/nflverse cross-checks with unverified lineage do not
qualify. Cross-source agreement is not proof of upstream independence, an
official NFL certification, calibrated probabilities, or a profitable edge.
Thirty qualifying games only unlock descriptive reporting. Existing sample and
model selection rules, likelihood calculations and market-movement diagnostics
are unchanged. The sequential result now explicitly carries this additional
outcome-safety policy; old and newly gated counts must not be pooled.

## Public-summary compatibility

The feed and browser reject v1 or older summaries, missing v2 policy/count contracts, inconsistent
cohort counts, or per-result scores for uncorroborated records. An older remote
summary therefore leaves the safely recomputed bundled-journal fallback (or
last valid cached summary) in place and marks publication unavailable/invalid.
This can temporarily show an older snapshot count until a new compatible summary
is generated through an approved publication path. This local change deliberately
does not rewrite the existing checked-in summary or journal. The browser also
withholds scores from older cached summaries and separates recorded results
from source-corroborated outcomes.

Unit fixtures are fabricated to exercise the gate and are not evidence. The
checked-in real journal test verifies that existing community-only records stay
unqualified and that reading them leaves their bytes unchanged.

## Compatibility of previously retained records

Missing or contradictory binding metadata never gets filled in by a reader. A
previously structurally accepted but unbound record stays visible and becomes
unqualified under v2. A later genuinely bound receipt can append a revision; it
cannot rewrite the old record or reuse a contradictory score receipt. All current
real journal records already have zero qualified outcomes, so their counts and
bytes are unchanged. V1 and V2 scoring cohorts must not be pooled or compared as
if their qualification rules were identical. Hash formatting and internally
consistent metadata are not proof of authentic or durably archived source bytes.
