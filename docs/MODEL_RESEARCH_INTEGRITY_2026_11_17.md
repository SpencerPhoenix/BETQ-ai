# Model-research integrity audit, November 17, 2026

## Corrected in this change

The score-margin research previously trusted caller-supplied season partitions and silently kept the last conflicting source row for a game. This could make invalid data appear to satisfy a prior-season evaluation.

The research now rejects conflicting source records (including malformed duplicates), duplicate replay seasons/games, cross-season joins, invalid calendar dates and numeric values, duplicate direct-frame identities, and training/test calendar overlap. Identical source duplicates remain harmless. Next-calendar-year playoff dates are permitted when chronology is valid. Direct evaluation callers receive the same frame validation as ingestion callers.

These are defensive research checks, **not evidence that published research was contaminated**. They cannot authenticate publication time, historical source revisions, QB identity, or availability. Final scores remain labels, never pregame inputs.

## Revalidation

An offline replay of the existing local public schedule snapshot (7,548 source records, SHA256 `5e1f14fe5b37df03d7ef9c3662402cc4e4fb6055bede8940cc2fc5af46cb3f01`) produced exactly equal frames and reports before and after these guards. This is not the original pinned source revision, so no frozen artifact was overwritten. The 2020–2025 season frame counts were 268, 285, 284, 285, 285 and 285.

The same 1,139 evaluation games reproduce the existing margin finding: market-only MSE 154.33385 versus corrected MSE 154.01251; improvement interval [-0.57827, 1.27782]. MAE worsens from 9.536 to 9.5457. This is repeated historical research, not a new holdout. No reliable margin advantage or calibrated cover probability is established.

## Remaining model gap and next experiment

- Live Elo/efficiency forecasts do not become QB-adjusted by adding injury display context. A challenger built on Elo is correlated evidence, not independent confirmation.
- The separate 2017–2024 QB report study predicts schedule-listed starter continuity. Known label errors and non-immutable historical reports prevent promotion as verified availability or game-outcome evidence.
- Preserve original forecasts for every game. Do not tune a Chargers/Ravens-specific coefficient or backfill postgame starter corrections into pregame input history.
- The next QB experiment needs independently verified starter labels, timestamped pregame evidence with cutoff rules, explicit missingness/conflicts, and chronologically separated training/calibration/evaluation. Postgame participation can audit labels but cannot become a pregame feature.
- Any score-distribution challenger must separately validate outright win, push and spread-cover probabilities against contemporaneous price baselines. A straight-up win probability is not a cover probability.
- Predeclare variants and advancement criteria before new prospective outcomes. Report calibration and paired losses with uncertainty, including underdog subsets without selecting them after seeing wins.

No production weights, prediction receipts, source access, paid API calls, wager permissions, or promotion gates were changed.
