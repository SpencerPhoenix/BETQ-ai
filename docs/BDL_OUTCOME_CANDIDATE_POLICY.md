# Disabled BALLDONTLIE-native outcome candidate

Policy identifier: `BDL_NATIVE_FINAL_NFLVERSE_SCORE_CANDIDATE_V1`.
Status: **offline candidate only, disabled, never qualifying under the current scoring policy**.
Base: receipt-hardening commit `740400acbda58f5debf04fde08de5c1bdfd6bcca`, based on PR18.

## Source contract reviewed

On November 7, 2026 the official [NFL OpenAPI](https://www.balldontlie.io/openapi/nfl.yml)
and [NFL documentation](https://nfl.balldontlie.io/) describe a single-game response
with a `data` object, native game/team IDs, scheduled `date`, season, postseason
flag, scores, textual `status`, normalized `status_state`, and `updated_at`.
The schema requires the last two fields. The normalized final state is `final`.
`updated_at` denotes record-write time, not confirmed source freshness, publication,
a player-stat revision, or the instant the final status became known.

Those are source assertions, not independently authenticated league facts. Other
identity/score fields are required by this conservative candidate even where the
OpenAPI does not mark them required. This adapter is intentionally a stricter
supported subset, not a generated validator for every legal API response.

This work read public documentation only. It did not call the games API, use a key,
retrieve a new schedule, create an account, purchase a plan, or collect a real sample.

## Proposed meaning

A match means only: **a supplied BALLDONTLIE single-game payload declares a final
for the exact frozen event, and a supplied nflverse row agrees on teams, season,
schedule date and scores.** The two observations are kept distinct:

- BALLDONTLIE supplies the native game/team IDs, exact scheduled kickoff and final
  declaration. It is never relabeled as an nflverse or ESPN terminal receipt.
- nflverse supplies its own game ID, schedule date, season phase, teams and scores.
  It does not acquire an invented final-status or UTC-kickoff field.
- The original frozen game identity is copied into its own candidate context, not
  presented as a missing provider observation. No forecast/model is recomputed.

Source lineage is unverified. Agreement cannot demonstrate upstream independence,
league certification, profitability, calibrated predictions, or historical as-of
availability. A provider might have corrected or backfilled this response later.

## Pure adapter boundary

`assessBdlOutcomeCandidate` accepts existing in-memory bytes, a frozen journal,
BETQ game ID, an expected native provider game ID, two collection timestamps and
an evaluation timestamp. It has no URL, key, HTTP client, environment switch,
write path, database, workflow, or production consumer. It cannot turn itself on.

The native ID is supplied by the caller and checked against the response plus
exact event identity. That is internal consistency, not proof that the mapping was
independently reviewed. Future integration must establish that mapping without
using a different provider's numeric identifier as though it were BALLDONTLIE's.

Each output always includes disabled activation, zero qualified outcomes, false
current-scoring eligibility, false source-independence/official-certification,
false archive verification, and false historical-as-of/source-freshness claims.
A successful candidate is deliberately incompatible with the current result writer
and `SOURCE_CORROBORATED_SETTLEMENT_V2`. There is no “enable” parameter; caller flags
cannot change this boundary. Errors return fixed reason codes, never provider text.

## Frozen acceptance rules for this prototype

1. Validate the existing journal; require the target's full frozen identity and no
   conflicting same-game or duplicate-event identities. Validate the structured
   nflverse ID's season and teams. NFL season attribution uses the calendar year
   except January/February, which belong to the previous season. Dates must match
   the existing NFL game-date convention; no observed kickoff is inferred from it.
2. Match exactly one community row by its ID and frozen season, teams and date.
   Support REG/WC/DIV/CON/SB only. Native postseason must agree with the community
   phase. Current-game scores must be integers from 0 through 100. No status is
   derived from score presence. A tied playoff final is held for review.
3. Accept one single-game `data` object, not arrays/pages. Require the caller's
   expected positive safe-integer native game ID and distinct positive safe-integer
   home/visitor team IDs. Match canonical team codes, with explicit known aliases
   including LAR to LA. No fuzzy names, kickoff tolerance or rescheduled substitution.
4. Require `status_state=final` plus compatible bounded `Final`, `Final/OT`, or
   `Final/nOT` textual status. Unknown, suspended, postponed, canceled, abandoned,
   scheduled, in-progress, contradictory, or missing states fail closed.
5. Require canonical millisecond UTC timestamps and exact native/frozen kickoff
   equality. Both supplied retrieval times and evaluation must be at least 24 hours
   after frozen kickoff. Retrieval must be no later than evaluation and no more
   than one hour earlier. These are conservative review windows, not proof of
   finality or source publication. The pure function cannot verify the caller's clock.
6. Keep `providerRecordUpdatedAt` and `collectorRetrievedAt` separate. The former
   must fall between kickoff and its retrieval time; it is not used to establish
   current freshness, revision type, or historical availability. Status-change time
   remains null and publication time remains unverified.
7. Compute each SHA-256 from its original supplied bytes. Reject invalid UTF-8,
   malformed CSV, inconsistent row widths, duplicate headers, duplicate decoded
   JSON keys, oversized JSON (>256KiB), and nesting beyond 32. Schedule byte limits
   follow the shared 12MB reader. Unknown fields are ignored in the derived output,
   though their original bytes remain covered by the digest. No raw body is saved.
8. Return either a nonqualifying candidate or a fixed rejection reason. Do not
   append results, increment outcome counters, update forecasts, or report metrics.

These rules are testable design choices, not a claim that every real payload is
already supported. For example, a valid ISO timestamp using a different spelling
is conservatively rejected until compatibility is reviewed rather than guessed.
The single-game contract avoids pagination inference; it does not request a game
or select an endpoint automatically.

## Corrections, provenance and future activation

This version stores no state and cannot decide whether a supplied response is a
correction to a previous observation. A future reviewed path must preserve complete
source bytes (where authorized), retrieval receipts, code/policy versions and hashes,
then append revisions without altering prior forecasts or result records. A hash
with no recoverable underlying source is not replayable archival proof.

Before a real integration, decide lawful retention and sharing, native-ID mapping,
exact request/response contract, authentication and budget, durable receipt storage,
clock trust, correction/retraction handling, replay, independent review and cohort
separation. Tests with real samples require an approved read-only request or a
separately authorized source upload. Any secret transmission requires its own
approval. Publishing a sanitized response, recurring capture, persistent credentials,
provisioning, merge or deployment are separate actions.

Only after that review could a *new* qualification policy be proposed. It must not
silently satisfy the ESPN/nflverse gate, relabel source lineage as independent,
retroactively make older records qualified, mix unlike cohorts, or use the most
favorable source/result after observing performance. Current reporting thresholds,
market comparison rules and wagering locks stay unchanged.

## Verification scope

All fixture games, native IDs, scores, bodies and receipt times in
`tests/fixtures/bdl-outcome-candidate.mjs` are fabricated and explicitly labeled.
They test parsing, source attribution, time/ID/score conflicts, conservative finality,
immutability, output sanitization and the disabled/current-gate rejection boundary.
They are not results from a real BALLDONTLIE request or new evidence of model quality.
The existing data, collector, workflows, server and scoring policy remain unchanged
relative to the local receipt-hardening base.

Local verification on Node 24.22.1: **564/564 full tests passed**, zero failures or
skips, with a cleared environment and external fetch blocked. The candidate suite
passed **62/62**. Independent review passed **132/132** combined candidate/receipt/
qualification tests; syntax and whitespace checks also passed. No production
integration, data or workflow change is included. No real source sample has been
validated; local test success does not establish runtime/API compatibility.
