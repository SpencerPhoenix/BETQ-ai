# BETQ.ai — Pre-registered Research Protocol: Market Residual + Disagreement (2026-11-02)

## Research intent and reproducibility

This file is committed **before the real-data experiment is executed**. The purpose is to distinguish genuine model information from the winner's curse caused by selecting the most extreme disagreements. This is a retrospective research exercise, not proof of historical bet availability, CLV, future profitability, or a new untouched model test. The NFL seasons discussed here have been repeatedly inspected by the development team.

**Frozen data:** nflverse/Lee Sharpe CC BY 4.0 schedules release (games.csv) with final NFL results and historical home/away moneyline **closing price references**, not timestamped pregame offers. All records remain research-only.

**Fixed evaluation years:** 2022, 2023, 2024, 2025. For each target season Y, train both nested logistic models on years Y−2 and Y−1, never target-year outcomes. Model probabilities are Elo from a season-before-fitted, day-frozen historical replay; game results of the current date do not enter that day's forecasts. 2020 and 2021 are generated only as earlier replay-training examples.

## Research hypothesis H1 — Does Elo contribute incremental information beyond closing market?

- H0: P(home win | p_market, p_Elo) = P(home win | p_market) — Elo contributes no useful additional information.
- Baseline A: raw proportional no-vig closing-market probability. Baseline B: market-only calibrated logistic P = sigmoid(a + b·logit(p_market)).
- Challenger C: market-offset residual logistic P = sigmoid(a + b·logit(p_market) + c·(logit(p_Elo) − logit(p_market))).
- Both market-only calibration (a,b) and incremental residual (a,b,c) are fitted with the same ridge-regularized Newton solver, fixed penalties and same two prior years. Log-loss is the fitting objective. The residual is **not** a market-independent probability model.
- No hyperparameter search on target outcomes. Fixed prior: a near 0, b near 1, c near 0. Fixed ridge weight=20 against these priors, with a smaller intercept penalty=2. Maximum Newton iterations 35. Coefficients constrained to finite and bounded for numerical safety.
- Report model coefficients, per-season Brier and log loss, accuracy as secondary, proper-score improvements relative to raw and calibrated market, and 95% week-grouped paired bootstrap confidence intervals (2,000 resamples per test year).
- The market-derived closing probabilities are the forecasting reference, **not historically documented executable entry prices**.
- A post-evaluation 'evidence flag' requires (i) Brier and log-loss improvement versus calibrated market, (ii) week-grouped 95% lower bounds of improvement >0 for both scores, and (iii) positive improvement in at least 3 of 4 evaluation years. **No flag allows real betting or model promotion.**
- If results are negative or mixed, publish all years and a reject/insufficient-evidence verdict, not a selected winning subset.

## Research hypothesis H2 — Is the largest disagreement predominantly model error?

- Include **every non-tied, priced game**; do not filter by selected plays or profitability.
- For each game, define the model-favored side as home if p_Elo > p_market, otherwise away. Record that side's model forecast, closing-market no-vig forecast, and realized win indicator.
- Magnitude = absolute probability-point difference |p_Elo − p_market|; freeze 10 quantile thresholds using only target-year prior two seasons. Report every decile: count, model-favored-side predicted win %, market reference win %, observed win %, model-minus-actual miscalibration, market-minus-actual miscalibration, and observed model/market Brier. No decile-specific refitting or threshold optimization.
- For low-sample bins, include sample counts prominently, and refrain from confidence claims based on a single bin.
- Diagnostic-only: If high-disagreement bins have larger model prediction errors while the market reference stays closer to observed frequencies, reject the claim that large disagreement itself constitutes an edge. This **does not** imply a legal or executable strategy from closing prices.

## Research hypothesis H3 — How often do our promotion gates falsely approve a no-edge model?

- Use the same real historical market/model feature rows but generate deterministic synthetic outcomes with Bernoulli(p_market). Here the market contains the true probability by **construction**.
- Refit both nested models using only the synthetic two previous seasons for each target season; apply the same fixed scoring gate on each synthetic target season.
- Run exactly 400 independent null simulations with a published seed (20261102), each evaluating 2022–2025. Report the number and proportion of simulated worlds that pass the conservative promotion evidence gate. This estimates false approvals under a **specific simulated efficient-market null**, not every possible real-world false-positive probability.
- No post-hoc changes to gate thresholds to improve this benchmark in this research run. If the false-approval rate is surprisingly high, record failure and propose a **separate, newly versioned** future experiment rather than changing the current criteria silently.

## Explicit exclusions

- No realized betting ROI or verified closing-line value: original entry prices, availability, timestamps and settlement transactions were not available.
- No automatic model promotion, paper staking or real-money orders.
- No reusing outcome-dependent 2025 candidate searches to claim an untouched 2025 holdout. Treat all measured results as retrospective exploratory comparisons.
- No paid Odds API calls or external API credentials in model training, tests, or research workflows.

## Required deliverables

Publish a versioned source-fingerprinted JSON report and a concise negative-or-positive research summary showing every target season, all disagreement deciles and the null-gate stress. Add synthetic tests for chronology, coefficient stability, quantile bins and false-positive source labels. Do not substitute a visually appealing leaderboard for proper statistical evidence.

## Rejected interpretation

Even if the residual lowers Brier or log loss on these already inspected seasons, this is **not** proof of a profitable bet, an independently generated market advantage, or genuine prospective validation. The independent forward journal must test new frozen model versions and observed, source-timestamped prices before any betting recommendation can be considered.