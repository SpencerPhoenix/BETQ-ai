# BETQ.ai v0.7 — Why we stopped promoting independent Elo value

## Historical evidence, not a profitability claim

BETQ.ai’s original 2022–2025 NFL replay (pre-season frozen Elo, closing-price hypothetical) produced 307 wins, 572 losses and a −10.24% hypothetical ROI at a fixed 3% modeled-EV threshold. The predictions averaged 47.33% on the chosen sides, but the sides won only 34.93% of the time; this selection-bias failure must be addressed before automated model-driven bets.

The new market challenge uses nflverse's source-attributed historical closing moneylines, but cannot demonstrate historical bookmaker fills or price availability at decision time. It replays 2020–2025 annual model forecasts from earlier data. For each 2022–2025 test year, it selects the market/model blend weight from **the previous two seasons only**, scoring Brier and log loss and requiring a positive week-clustered bootstrap lower bound. It never uses target-year outcomes for selecting the weight.

## Results: Nested market-versus-Elo benchmark

| Test season | Elo Brier | Closing-market Brier | Robust model contribution | Gated blend Brier |
| --- | ---: | ---: | ---: | ---: |
| 2022 | 0.22604 | 0.20929 | 0% | 0.20929 |
| 2023 | 0.23529 | 0.21864 | 0% | 0.21864 |
| 2024 | 0.21163 | 0.20097 | 0% | 0.20097 |
| 2025 | 0.22235 | 0.21091 | 0% | 0.21091 |

**The model did not contribute a statistically defensible incremental edge on these historical closing-market references.** This means our market-anchored research signal is presently just the margin-adjusted market price, not an independent superior win-probability model. It should not be sold as a new BETQ betting advantage.

## Why raw win ratio does not equal return

Favorite-only strategies illustrate the distinction between hit rate and price quality:

| Rule | Historical W–L | Hit rate | Hypothetical stake ROI at source closing prices |
| --- | ---: | ---: | ---: |
| Closing-market favorite ≥60% | 529–201 | 72.47% | −2.16% |
| Closing-market favorite ≥65% | 393–129 | 75.29% | −3.32% |
| Closing-market favorite ≥70% | 292–75 | 79.56% | −1.67% |
| Closing-market favorite ≥60%, Elo also picks same side | 496–178 | 73.59% | −1.31% |

These are not playable historical entries. Only recorded closing prices are available, with no quote timestamps. Annual outcomes vary and thresholds are sensitivity tests, not proven strategy optimizations. A higher winner hit rate can still produce a negative return when the price is expensive.

## Production model governance

- A live NFL market reference is available only after at least three fresh, independent, two-sided books yield an identical-contract margin-free consensus.
- It is labeled `FRESH_THREE_BOOK_NO_VIG_CONSENSUS`, **market-derived and not an independent BETQ model**. No verified model residual is added; weight stays at zero while independent edge has not been proven.
- The on-activation deterministic agent stages are Market Data, Probability, Market Calibration, Historical Audit, and Risk & Execution. Their shared snapshot does not incur extra odds calls.
- The engine issues `PASS_NO_PROVEN_MARKET_EDGE` when independent predictive superiority has not been shown. It never authorizes real-money orders.
- Source timestamps, underpowered sample sizes, missing lineup verification, and a stale historical research artifact must not be interpreted as positive evidence.
- GET /api/research/market provides source-labeled historical validation with `verifiedROI=null`, `verifiedCLV=null`, `bettingAuthorized=false`.
- The Historical Replay tab shows four-season scorecards, the nested market-weight gate, and the favorite hit-rate-versus-return comparison.

## Limitations and next industry-grade work

1. **Do not mistake the closing line for an available bet price**. Genuine CLV requires source-time-matched opening/entry and closing quotes from the *same exact contract*, ideally individual sportsbook prices with terms and limits.
2. Fit an independently calibrated residual using data available prior to market movement, with a strict rolling window and no future/holdout leakage. The model must beat both the raw market reference and a calibrated market-only baseline on proper scoring and a prospective sample.
3. Investigate underdog selection bias (large positive model EV concentrated on sides the market rates poorly). Evaluate calibration conditional on selected side, not only aggregate game-winner accuracy.
4. Only promote a model after independent rolling tests, meaningful positive uncertainty lower bound, fresh injury/starting QB verification and full provenance. If no edge is demonstrated, the correct output is **PASS**, not forced bets.
5. A true business-grade platform requires authentication, durable private price history and audit-retained settlement records; the current GitHub artifacts are derived-research proof of concept.

The underlying schedules and moneylines come from nflverse/nflverse-data, credit to Lee Sharpe, CC BY 4.0. The historical results and candidate-selection policy have been repeatedly inspected; they are not a pristine prospective holdout.