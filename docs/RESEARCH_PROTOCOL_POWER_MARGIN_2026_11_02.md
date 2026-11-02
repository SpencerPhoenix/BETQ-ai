# BETQ.ai — Frozen Protocol: Gate Power & Margin Residual Experiments

**Preregistered November 2, 2026. This file must be committed BEFORE executing these new experiments against historical game outcomes.**

## Purpose / hypotheses

**P1 (Power):** Can the current BETQ residual-model evidence gate (two preceding NFL seasons for training, paired Brier + log loss, >0 gains in >=3 of 4 years, positive week-clustered pooled 95% bootstrap lower bounds) detect modest *true* incremental signals without approving null models too often?

**P2 (Margin):** Does the Elo-versus-market disagreement from a pregame-frozen model predict signed game margin *residual to historical closing spread* out of sample?

The 2022–2025 data have been repeatedly studied. Results must remain **exploratory, retrospective research, not a fresh untouched holdout, verified betting edge, actual ROI or CLV**. No real wagers, autonomous staking, production model promotion or changes to existing risk gates follow from this study.

## P1: Frozen synthetic power design

- Source design: use the existing public, source-fingerprinted NFL schedules replay for seasons 2020–2025 **only as a fixed covariate frame** (market probability, year and week), then replace the observed game outcomes entirely with synthetic Bernoulli outcomes.
- True synthetic home win probability `sigmoid(logit(p_market) + s*z + w_week)`, where latent independent information `z ~ Normal(0,1)` and weekly shock `w_week ~ Normal(0,sd)` shared by a week's games. At **null s=0 and sd=0**, the market probability is correct by construction.
- A candidate observes `z_obs = rho*z + sqrt(1-rho^2)*noise`; encode its candidate odds scale as `p_model=sigmoid(logit(p_market)+z_obs)`. This feature represents *synthetic observed information*, not actual BETQ Elo performance. No outcome information is used to create the input feature.
- Fixed cells: null `(s=0,rho=0.8,sd=0)`; weak `(.05,.8,0)`; moderate `(.10,.8,0)`; stronger `(.20,.8,0)`; stronger-but-noisy `(.20,.5,0)`; stronger with a correlated week shock `(.20,.8,.15)`; sparse context `(.20,.8,0)` observed in only 20% of games, with the same fraction receiving a true signal. All other games use zero observed signal. No post-hoc cell changes.
- Exactly **2,000 independent simulated worlds per cell**, fixed seed `20261102`, derived reproducibly for each cell and world. RNG streams for different cells/worlds are independent via deterministic seeded substreams. All samples and seed values included in report.
- On each simulated world, refit the **exact same** two pre-target-season ridge logistic components as `src/residual-research.mjs`: calibrated-market and market plus residual. Train only on preceding two synthetic seasons, evaluate 2022–2025, then compute paired week-clustered bootstrap intervals. The existing promotion-evidence rule is evaluated unmodified. Use **300 paired bootstrap resamples per world** to bound simulation cost (not the original research's 2,000); thus results approximate the same gate and must be labeled reduced-resample **gate-power sensitivity**, not an exact reproduction of the 2,000-resample test.
- Also record a simpler *alternative diagnostic* on the identical simulated outcomes: pooled week-clustered 95% log-loss interval lower bound positive with pooled proper-score gain, without the >=3 positive-season rule. It is **not** proposed as a production gate and has no multiplicity control across candidate models.
- Report observed pass rates, Monte Carlo 95% binomial intervals, pooled average score gains, and whether the synthetic signal is observed in only a fraction of games. No target 70% power claim unless actually met.
- Fixed success criterion for a candidate gate: familywise false approval <=5% on null after multiple candidate accounting (one candidate per world here, so cannot establish familywise validity), and >=70% power at a separately pre-specified practically important signal. This report cannot establish familywise validity across untested candidates.

## P2: Fixed retrospective NFL margin experiment

- Re-fetch the public nflverse schedules CSV and **check the SHA256 against the frozen residual-research input**. Refuse to combine source revisions without rerunning and versioning the prior baselines.
- Parse `spread_line` as a historic *closing* line and `home_score-away_score` as the outcome margin. **Do not assume the sign convention.** Establish the reference direction by cross-checking source documentation and a pre-2022 training-period covariance with home margin; reject unexpected/missing signs, do not select the sign on test-year outcomes.
- Baseline: home expected margin = source closing `spread_line` in validated sign convention, which is a strong historical market-only estimate, not a verified decision-time offer.
- Challenger: baseline + `intercept + beta * [logit(p_Elo)-logit(p_market_no-vig)]` where intercept and beta are fitted to final-margin residuals via ridge regression **using the two preceding seasons only**. Fixed ridge slope penalty=20 and intercept penalty=2, no hyperparameter search.
- Evaluate 2022, 2023, 2024 and 2025 by MSE, MAE and week-clustered 2,000-resample paired 95% interval of baseline-minus-challenger *squared error*. The model input Elo forecasts are season-fitted prior to each target season (existing replay); bookmaker margin odds are *closing reference* and not historical entry prices.
- A margin correction only qualifies for an exploratory positive label if pooled MSE improvement >0 and week-group 95% lower bound >0 and at least 3 of 4 target seasons improved. This does not imply executable spread EV/ROI.
- Report every year, games excluded and why, source sign validation and price provenance.

## Reproducibility / governance

- Research scripts must be offline with respect to paid The Odds API; public nflverse CSV download is allowed in GitHub Actions.
- Publish source SHA, exact seed, bootstrap repeats, world counts, code/test versions and all null/negative outcomes.
- Use documented actual simulated pass counts; never invent results.
- No new production confidence claims or model promotion from this protocol.
- Any adjustments to this protocol after seeing results must be versioned as a separate **new experiment**, not silently edited into this one.
