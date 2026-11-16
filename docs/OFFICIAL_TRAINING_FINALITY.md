# Scoped official-page training finality receipts

## What is implemented

- A fixed-source observer for https://www.nfl.com/scores/SEASON/week-WEEK.
  One explicit credential-free GET, no redirects, 30-second/8-MB bounds. No
  scheduler or private endpoint. Fetched HTML is parsed as JSON, never executed.
- Strict recognition of the public page's weekly game-data query. The game
  summary must say `FINAL` **and** `END_OF_GAME`; its game/team IDs must match
  the schedule entity. The schedule entity's own status commonly remains
  `SCHEDULED`, so it is not a completion signal. Unknown/changed structures fail.
- Scores, Eastern game date derived from kickoff, home/away, season/week and
  explicit neutral-site flag are matched to every selected training row.
- Bidirectional reconciliation finds both training rows not observed final and
  official finals missing from training. Per-team counts are scoped to the
  requested weeks, not inferred whole-season completeness.
- Both trainers accept optional paired flags `--finality-receipts FILE`
  and `--finality-weeks 9,10`. Failure stops before training/output (and before
  efficiency PBP downloads). Successful artifacts include the scope, observations
  and source-body digests. Current default scheduled workflows are unchanged.

## Boundaries

This is an observation of official-page data, not proof that the NFL and nflverse
have independent upstream statistical suppliers. All upstream independence,
independent authenticity attestation, historical availability, complete league
coverage and aggregate settlement eligibility flags remain false. It does not
activate V2 grading or establish betting performance.

Observation time is not publication time. Receipts newer than training `asOf`,
older than six hours by default, missing or ambiguous weeks, inconsistent scores,
venue mismatches and incomplete final coverage block the scoped gate. A current
receipt cannot be backdated to certify an earlier model build. Raw HTML is not
published in the repository; its digest alone is not an independently archived
or signed receipt. Local receipt JSON is trusted caller input, not a cryptographic
proof of the fetch. The observer establishes a bounded HTTPS observation only.

The gate is opt-in. Earlier seasons and unrequested weeks remain outside its
coverage, explicitly counted in the report. A safe next step is prospectively
collecting the required current-season week range before a trainer runs, retaining
observations privately and blocking publication on missing coverage. Do not
silently turn this into a new production schedule or represent all historical
training rows as verified. Source rights/operating reliability must be reviewed
before recurrent or broad automated collection. No external terms or new accounts
were accepted by this implementation.

## Commands

```
node scripts/observe-official-training-week.mjs 2026 10 > week10.json
node scripts/audit-training-finality.mjs schedules.csv week10.json 2026 10 2026-11-16T21:20:00.000Z
node scripts/train-nfl.mjs --input schedules.csv --output /tmp/reviewed-model.json --finality-receipts week10.json --finality-weeks 10
```

Use actual current observation/as-of times, not the illustrative timestamp above.
Do not write a published artifact until the selected scope and exclusions have
been reviewed. No coefficient change or automatic challenger promotion is made.

## November 16 read-only check

The observed Week 10 official page contained 14 fixtures, 13 explicit finals and
one pregame fixture. All 13 final scores, identities and venue flags matched the
contemporaneous nflverse scored rows in that week. Chargers–Ravens stayed pregame
and out of the completed-training cohort. This is one scoped observational
cross-check, not whole-season or source-independence certification. No new model
was fitted, no old forecast/grade changed, and no paid API was called.
