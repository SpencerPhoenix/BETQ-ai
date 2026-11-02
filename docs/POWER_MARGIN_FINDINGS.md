# BETQ.ai — Power and Margin Experiments: Results & Decisions

**Research date:** November 2, 2026. **Protocol committed before running real historical outcomes:** [RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md](RESEARCH_PROTOCOL_POWER_MARGIN_2026_11_02.md), commit `3fd15fb1bfbf8cf874cb70c96ff088d46ee4ad46`.

**All results are exploratory and source-attributed.** The 2022–2025 NFL seasons have been repeatedly inspected. Historical closing spreads and moneylines are NOT authenticated decision-time betting offers. There is no verified return, closing-line value, account access, automatic staking, or authorization to promote a model.

## P1. Gate power measured on 14,000 synthetic worlds

Generated **2,000 independent simulated worlds for each of seven fixed scenarios**. Game dates, season/week groupings and market probabilities came from the historical source frame, but all results and synthetic residual features were newly simulated; **real historical outcomes were not used in this power experiment**. The simulator fitted the same two-prior-year ridge market-only and market-plus-residual logistic models as the existing production research and applied the same conservative evidence criterion: three of four test seasons show positive Brier + log loss improvement and the pooled 95% week-block intervals for both improvements lie entirely above zero.

Computational sensitivity: **300** pooled week-bootstrap draws per synthetic world (rather than the source research's 2,000); the criterion is otherwise unchanged. The outcome is a fixed-sample **gate-power diagnostic**, not a new production approval rule.

| Fixed scenario | Synthetic observation | Strict gate approvals / 2,000 | Detection or false-approval frequency | Simpler pooled-only diagnostic |
|---|---|---:|---:|---:|
| Efficient-market null, no increment | s=0, rho=.8 | 5 | **0.25%** | 0.40% |
| Weak signal | s=.05, rho=.8 | 9 | **0.45%** | 0.55% |
| Moderate signal | s=.10, rho=.8 | 29 | **1.45%** | 1.85% |
| Stronger, high observation quality | s=.20, rho=.8 | 248 | **12.40%** | 14.55% |
| Stronger but noisy observation | s=.20, rho=.5 | 69 | **3.45%** | 3.90% |
| Stronger plus shared week shocks (sd .15) | s=.20, rho=.8 | 268 | **13.40%** | 15.35% |
| Stronger in 20% of events | s=.20, rho=.8, active in .20 | 64 | **3.20%** | 3.70% |

**Interpretation:** The original strict gate is very conservative under the efficient-market null but also frequently misses known genuine incremental signals, even when they are fairly strong. Under the high-quality stronger condition its 12.40% detection rate is well below the stated goal of 70% power. The simpler pooled-only diagnostic remains low-power and does not have multiple-hypothesis control. **Neither is suitable for automatic wagering-model promotion.**

The injected signal's strength is a shift on the **logit scale**, not a 5%, 10%, or 20% win-probability gain or expected ROI. In the stronger, high-observation-quality case, the simulated oracle's mean **expected** log-loss gain was **0.004226 per game**, while the mean improvement of the refitted, measured residual model was **0.002059**. An unattainable oracle is not an executable trading edge.

The 0.25% null result is conditional on a single simulated candidate and one Bernoulli market-efficient null. It does **not** establish a universal Type-I error bound across many researched models. Realistic model comparison would require accounting for all tried variants and repeated monitoring. The 95% Wilson sampling interval for the 5/2000 null rate was approximately **0.11%–0.58%**.

Code: `src/promotion-power.mjs`, `scripts/run-promotion-power.mjs`. Frozen artifact: [data/promotion-power/summary.json](../data/promotion-power/summary.json).

## P2. Real historical NFL score-margin residual versus closing spread

Source: nflverse/Lee Sharpe schedules, CC BY 4.0, source SHA256 `7bf3e1d9bcf0805fd0fdd1b95a5f016798a3705beebfea9240689c14a0270f8c`. The game margin was always `home_score - away_score`. Closing spread sign was checked **only** using 553 games from 2020–2021 and validated as **positive = home team expected to win by that many points**; pretest correlation with home margin was **+0.45359**. Sign convention was not tuned on 2022–2025 outcomes.

Frozen challenger: `home predicted margin = closing spread + intercept + beta*(logit(p_Elo) − logit(p_no-vig closing market))`. Each test year Y fitted coefficients using seasons Y−2 and Y−1 only, with fixed ridge penalties (2 on intercept, 20 on beta).

| Season | Games | Closing-spread MSE | Ridge-corrected MSE | Baseline − correction MSE | 95% week-block interval for improvement |
|---|---:|---:|---:|---:|---:|
| 2022 | 284 | 131.95687 | 132.25882 | −0.30195 | [−1.38087, +0.67158] |
| 2023 | 285 | 173.55351 | 173.37636 | +0.17715 | [−0.48030, +0.79274] |
| 2024 | 285 | 161.81140 | 161.27872 | +0.53268 | [−1.50083, +2.74517] |
| 2025 | 285 | 149.93509 | 149.05979 | +0.87530 | [−2.04653, +3.89014] |
| **Pooled** | **1,139** | **154.33385** | **154.01251** | **+0.32134** | **[−0.57827, +1.27782]** |

Pooled closing-spread RMSE **12.4231 points** versus correction **12.4102 points**; pooled **MAE was worse**, 9.536 versus 9.5457. The interval on MSE improvement includes zero, and all annual intervals also include zero. **The preset exploratory evidence gate failed**. Thus the margin target did not demonstrate reliable incremental information in this specific Elo-only correction.

Code: `src/margin-research.mjs`, `scripts/run-margin-study.mjs`. Artifact: [data/margin-research/summary.json](../data/margin-research/summary.json).

## What this changes — and what it does not

- **Finding:** The absence of prior model promotions does not prove that genuinely useful information is nonexistent. This gate is not powerful enough under our specified small-to-moderate signal settings.
- **Finding:** Simply switching from win/loss to a continuous final-margin target did NOT rescue the same weak Elo residual under these fixed tests.
- **Decision:** Do **not** loosen the current production gate based on already-inspected 2022–2025 results. Do **not** automatically promote Elo, EPA, the market blend, or margin correction. Risk controls and automatic wager lock remain unchanged.
- **Next:** Design **prospective timestamped research** on one narrow event type, e.g. confirmed starting-QB change or a verifiable sudden weather forecast revision, using timestamped source publication, actual contemporaneous book-specific odds and later prices. Test a model against matched-time market baselines, not only the retrospective close.
- **Next:** Separately preregister a **power-calibrated shadow-model advancement gate**, including an explicit minimum meaningful log-score gain, false-positive control across all experimental models, and a predeclared number of prospective events/weeks. Sequential e-process methods require careful assumptions and are research candidates only.
- **Operational:** Preserve all source inputs, SHA256, timing, exclusions and the entire experiment ledger. Do not present statistical power as model skill.

## Timestamped data feasibility (no API credits consumed here)

The Odds API's official v4 historical feature provides sportsbook snapshots from **June 6, 2020** (10-minute intervals, improving to 5-minute intervals in September 2022). **Historical odds access requires a paid plan**, and the advertised historical featured-market rate is **10 credits per region per market per request**. These cost and historical availability details are provider documentation, not an account-plan entitlement claim: https://the-odds-api.com/historical-odds-data/ .

Their August 31, 2026 terms explicitly allow retention and analytical use but **prohibit redistribution as a standalone raw-data service**: https://the-odds-api.com/terms-and-conditions.html .

At BETQ's previous conservative daily allocation of 12 paid odds credits, unplanned bulk historical testing is inappropriate. No backfill was purchased or run in this research. Before selecting an access plan or collector, validate plan entitlement, quota, exact event/book availability, timestamp precision, legal use and secure private storage. An archived quote is not a verified accepted bookmaker transaction.

## Audit

- Two isolated GitHub workflows run the experiments and automatically require the full Node regression suite and source-integrity gates.
- No Odds API provider key is used by either experiment; the input is public source material and deliberately synthetic outcomes for P1.
- The exact simulated seed `20261102`, fixed 2,000 paths per cell, 300 pooled bootstrap draws, full parameter grid and both experimental artifacts are preserved.
- Research results are not a new pristine independent holdout because the model ideas arose after investigating earlier historical NFL data.
