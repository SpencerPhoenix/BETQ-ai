# Selected-side calibration, research only

Run `npm run audit:calibration` to print a JSON report of the existing local
`data/evidence/nfl-2026.json` journal. The command accepts no arguments, makes no
provider or database calls, writes no files, and is not connected to the server,
UI, collectors, workflows, model promotion or decision policy.

This is descriptive analysis of an already-inspected journal, **not a new
untouched holdout or a preregistered confirmatory result**. It does not establish
confidence in a future pick, profitability, executable prices, CLV or ROI.

## Fixed selection and source qualification

Protocol `betq-selected-calibration-v1` reuses the existing sequential report's
source qualification, rather than inventing a weaker outcome set:

1. Choose the first qualifying pregame snapshot per distinct game using actual
   timestamp order, with snapshot ID as the deterministic equal-time tie-break.
   Qualification retains the independent research model, valid result cutoff,
   three-book no-vig benchmark and fresh receipt/quote requirements.
2. Use the highest unambiguous settlement revision. Both original source
   receipts must pass the existing corroboration gate. Legacy community-only
   records are not silently upgraded. Same-revision contradictory scores or
   conflicting qualification status fail closed, even in an older revision
   superseded by a later result. This is independent of record-array order.
3. Exclude ties and games without qualifying final results. Select HOME when
   the first Elo home probability is greater than 0.5 and AWAY when it is less
   than 0.5. Exactly 0.5 has no selected side and is counted as an exclusion.
4. For AWAY selections, transform model and market probabilities to `1-p`, and
   transform the home outcome to `1-y`. A later stronger/opposite forecast, a
   challenger, or the result cannot change that initial side.
5. Put the unrounded selected probability into the fixed, disjoint bands
   `[0.50,0.60)`, `[0.60,0.70)`, `[0.70,0.80)`, `[0.80,0.90)`, `[0.90,1.00]`.
   The final endpoint includes floating-point rounding of `1-p` to exactly one;
   it is not a claim of certainty.
   These are probability ranges, not confidence tiers. There is no parameter
   for optimizing a cutoff against outcomes.

Counts describe distinct qualifying games, never repeated snapshots. The
report lists exclusions, calendar weeks and model-version counts. Pooled model
versions are not treated as a validated current model. Selection conditions on
the model, source availability and non-tie results, so conclusions cannot be
extended automatically to every forecast or future game.

## Disclosure and uncertainty

The existing 30-game disclosure floor is retained **separately for the overall
cohort and each band**. Below 30, the cohort reports
`INSUFFICIENT_QUALIFIED_DATA`, its sample count and games needed; performance
metrics and interval endpoints are null. Thirty overall games cannot unlock a
band with only 29. A cohort above the floor is still only
`DESCRIPTIVE_RESEARCH_ONLY`, not adequately powered or proven calibrated.

For a displayed cohort, the report gives the actual mean predicted selected-side
probability, observed win fraction, observed-minus-predicted gap and mean market
probability for the **same selected side**. The mean prediction is not a band
midpoint, and the market comparator is not an executable offer.

Two clearly separated uncertainty summaries are available:

- **Wilson 95% binomial reference interval** for the observed win fraction.
  This is a pointwise, nominal descriptive interval under a binomial reference
  model. NFL outcomes can share teams/week shocks and have heterogeneous
  probabilities. It is not a dependence-adjusted, simultaneous or sequentially
  valid guarantee, and it is not an interval for any individual future game.
- **Calendar-week block sensitivity:** after at least 30 games and eight
  Monday-UTC kickoff weeks in that specific cohort, 2,000 deterministic draws
  resample whole weeks and recompute observed rate and calibration gap. Each
  draw retains the games within a sampled week and uses its full game count.
  This preserves within-week dependence but does not correct recurring-team,
  cross-week or repeated-inspection effects. A narrow or degenerate bootstrap
  interval is not proof of certainty. Before those floors, the sensitivity
  endpoints are null with an insufficient-games-or-weeks reason.

No interval crossing or band result can set `calibrationEstablished`,
`marketBeatingEdgeEstablished`, `independentProfitabilityProven`,
`modelPromoted` or `bettingAuthorized` to true. Verified ROI and CLV remain null.
Neither method establishes that a high predicted win probability is a good
price or a profitable wager. Adequate prospective precision/power and any
confirmatory protocol must be planned separately, before inspecting the new
evaluation outcomes.

Method references: [NIST on Wilson binomial intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
and [scikit-learn on calibration curves](https://scikit-learn.org/stable/modules/calibration.html).

## Reproduction and tests

The CLI includes the SHA-256 of the exact source journal bytes. It is a
reproduction identifier, not proof of authentic publisher timing. The report
contains derived aggregates only and does not reconstruct private bookmaker
prices or missing source payloads.

Run `npm run check`, `npm test`, `npm run audit:direction` and
`npm run audit:sequential`. Focused coverage in
`tests/selected-calibration.test.mjs` checks empty/sparse cohorts, the exact
29/30 floor, away-side orientation, fixed bin boundaries, outcome-independent
selection, duplicate forecasts, settlement revisions, stale/missing provenance,
timezone ordering, clustered synthetic outcomes, all wins/losses and unchanged
source bytes. Synthetic examples are tests, never collected NFL evidence.
