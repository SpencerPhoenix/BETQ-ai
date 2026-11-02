# BETQ.ai — Pre-registered Market Residual & Winner's-Curse Findings

**Research only.** Real-world betting ROI: unavailable. CLV: unavailable. No production model promotion or real betting authorization.

## Study scope and reproducibility

- Research protocol committed before the actual data run: [pre-registration](RESEARCH_PROTOCOL_RESIDUAL_2026_11_02.md) (commit `c6069bb7f309be3861f8f733dc8dbfd690bfea2d`).
- Research code: `src/residual-research.mjs` and `scripts/run-residual-research.mjs`.
- Data: nflverse / Lee Sharpe NFL schedules with historical closing moneylines, CC BY 4.0. Source file fingerprint (SHA256): `deff36dd02444aede71027b06469fc428dbec0159468a8acb8298a332ac08f01`.
- 2022–2025 evaluated, **1,136** matched non-tie NFL outcomes. 2020–2021 included as earlier training data. Each year fitted using only its preceding two completed seasons.
- The model regressors: `logit(p_market)` and `logit(p_Elo) − logit(p_market)`. Same fixed ridge objective and prior-year training for both calibrated market and residual challenger. No optimizing on test-year results.
- The historically reconstructed market input is a **closing price, not a verified wagerable price at the decision time**. Thus comparisons reflect forecasting consistency relative to the close, NOT an ability to beat the line or fill a bet earlier.
- The 2022–2025 seasons have been repeatedly inspected during BETQ development, so this retrospective exercise does not establish new untouched validation even if the internal fit is past-only.

## H1: Incremental-information regression

| Test year | Closing-market Brier | Calibrated-market Brier | Elo residual Brier | Residual coefficient c | Residual Brier gain vs calibrated market |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2022 | 0.209287 | 0.210620 | 0.210347 | −0.05521 | +0.000273 |
| 2023 | 0.218638 | 0.219111 | 0.218398 | −0.10419 | +0.000713 |
| 2024 | 0.200975 | 0.200552 | 0.201853 | −0.16667 | −0.001301 |
| 2025 | 0.210906 | 0.211454 | 0.211420 | −0.01134 | +0.000034 |
| **Pooled, 1,136 games** | **0.209953** | **0.210433** | **0.210504** | — | **−0.000071** |

**Pre-registered promotion-evidence flag: FAILED.** The residual did not improve aggregate log loss or Brier relative to market-only calibrated regression. Pooled calibrated market log loss 0.608212 versus residual 0.608381; residual-minus-baseline is worse by 0.000169. A fixed 2,000-resample season/week-clustered paired bootstrap returned baseline-minus-residual Brier improvement 95% interval **[−0.000512, +0.000355]** and log-loss interval **[−0.001165, +0.000828]**. Both include zero.

Residual coefficients were negative in all four target-year fits. That is a diagnostic of the prior-window regression, not proof that reversing Elo creates a profitable strategy. In 2023 the residual slightly improved even on the raw market reference; this was not consistent across the pooled four-year sample.

Notably, unmodified no-vig closing-market probabilities outperformed both calibrated-market regression and residual regression on the pooled sample. Additional calibration **can worsen performance** and must always be compared to the raw market reference.

## H2: Disagreement-conditional calibration

All 1,136 priced non-tie games were assigned to 10 disagreement-magnitude bins, with each target year's bin thresholds fixed using only the two prior seasons. Side evaluated: the one BETQ Elo favored relative to the historical market. The probability of that side winning is compared against market expectation and the eventual result.

| Pooled prior-year-normalized disagreement bin | Games | BETQ model-favored side forecast | Closing market reference | Observed wins | Model overconfidence |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lowest disagreement decile | 124 | 48.88% | 48.09% | 48.39% | +0.49 percentage points |
| Highest disagreement decile | 101 | 53.59% | 31.24% | 34.66% | **+18.93 percentage points** |

The largest disagreement group is much closer to the market than to Elo. This supports a **selection-on-noise / winner's-curse** diagnosis for the current BETQ strategy. The annual highest-bin counts (18, 19, 34, 30) are small; do not claim each individual year conclusively establishes a monotonic causal relationship.

Large disagreement was not evidence of a positive betting edge. The true price at any earlier decision time is unavailable in this historical dataset.

## H3: Synthetic efficient-market null and false-promotion check

- Exactly **400** synthetic worlds, fixed seed `20261102`, constructed by drawing game outcomes independently from each historical closing-market probability. Under this specified synthetic null, Elo has **no incremental predictive information by construction**.
- In each world, both models were refit on prior two synthetic seasons and tested on four later synthetic seasons. The same preregistered multi-season/paired-week evidence gate was evaluated.
- **1 of 400 synthetic worlds (0.25%)** passed the historical evidence gate.
- The result suggests the tested gate is conservative under this one idealized null, but 0.25% is a noisy Monte Carlo sample fraction, **not a guaranteed real-world false-positive rate**.
- An essential next experiment is **power analysis** under known synthetic incremental signals. A gate that rarely approves false signals could also fail to recognize genuine small advantages. That study must be newly preregistered rather than tuned against the current results.

## What changed in production?

**Nothing was promoted.** There are no production probability, bet-selection, or money-management changes from this research. The existing central risk veto, market-first comparison and disabled real betting controls remain in force.

## Recommendations from these negative results

1. **Stop treating extreme Elo–market disagreement as a validated opportunity.** Use disagreements as a diagnostic for potential model bias and source errors.
2. Use the unmodified, trusted, source-timestamped market probability as a challenging reference and require demonstrated incremental information before adding residual corrections.
3. Pre-register a **synthetic power study** to determine whether our false-approval controls are too conservative to detect realistic improvements.
4. Prioritize true decision-time, book-specific historical odds (not only closing prices) and verified, timestamped QB/availability observations; compare accepted prices with subsequent closing quotes.
5. Continue forward prediction tracking; reserve future uninspected seasons for genuine, fixed-protocol out-of-sample evaluation.

## External methodological background

- [Walsh & Joshi 2023 — accuracy versus calibration for sports betting](https://arxiv.org/abs/2303.06021) (NBA experiments, not an NFL-edge proof).
- [Scikit-learn calibration](https://scikit-learn.org/stable/modules/calibration.html): proper scoring rules combine calibration, resolution and uncertainty.
- [Andrews, Kitagawa & McCloskey — Inference on Winners, QJE](https://doi.org/10.1093/qje/qjad043): general statistical winner's curse and selective-inference remedies, not NFL-specific.