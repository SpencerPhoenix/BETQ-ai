# BETQ.ai NFL Prediction Lab — independent research baseline v0.2

## Source and attribution

Historical game results: nflverse's published [schedules release](https://github.com/nflverse/nflverse-data/releases/tag/schedules), maintained by **Lee Sharpe**. Data credit: **nflverse / Lee Sharpe (CC BY 4.0)**.

Source CSV: https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv

The independent model trains on games and results, **never sportsbook prices**. Bookmaker comparisons occur only after predictions are generated. The versioned artifact records data lineage, source checksum, team ratings, and holdout performance.

## No-lookahead protocol

- For every game, record the probability from *pregame* Elo ratings, then update ratings after the final outcome.
- Regress previous season Elo toward 1500 between seasons.
- Select the K and home advantage parameters using 2018–2022 data.
- Calibrate forecast probability scaling on 2023–2024 games.
- Evaluate untouched 2025 outcomes only after tuning and calibration.
- Advance current ratings with already-completed 2026 games only.
- Tied games update Elo at 0.5, but are excluded from binary classification metrics.

Fitted parameters: K=40, home-field adjustment=25 Elo points, seasonal regression=0.35, probability-logit scale=1.1. Exact model metadata is in [the versioned artifact](../data/nfl_elo.json).

## Verified historical baseline metrics

| Evaluation split | Games (excluding ties) | Brier | Log loss | Winner accuracy | Expected calibration error |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2018–2022 parameter tuning | 1,365 | 0.22538 | 0.64264 | 62.78% | 2.88% |
| 2023–2024 calibration | 570 | 0.22262 | 0.63705 | 64.91% | 3.78% |
| **2025 untouched holdout** | **284** | **0.22235** | **0.63596** | **65.85%** | **5.30%** |

A constant 50% probability has a Brier score of 0.25. These values have **not** been compared to time-aligned sportsbook closing probabilities, and do not establish a wagering advantage or a profitable return.

## Reproduction and production controls

- Node.js runner: scripts/train-nfl.mjs
- GitHub refresh workflow: .github/workflows/train-nfl.yml
- Source artifact: data/nfl_elo.json
- Runtime model metadata: GET /api/model/nfl
- Live NFL pregame moneyline only: the /api/slate payload contains a separate independentModel research section.

A model older than 14 days, a source that fails validation, a missing team mapping, started games, and all synthetic demo events are blocked from live model output. Market WATCH/PASS indicators are still market-derived and are not upgraded to betting picks.

## Phase 3 prerequisite work

1. Add verified, timestamped injury and confirmed-quarterback feeds.
2. Incorporate lagged NFL play-by-play metrics (EPA and success rate) and retest from scratch.
3. Preserve immutable odds snapshots and verified results, to measure closing-line value and outcome ROI using prices that were truly available before kickoff.
4. Benchmark the independent model versus source-time-aligned no-vig sportsbook prices rather than the constant 50% benchmark.
5. Add weather, rest days, venue and neutral-site factors and evaluate each on untouched seasons.
6. Require model-change review, test passing, security audits and user-controlled execution before using any real capital. The current application does not place real bets.

## API quota safety

BETQ.ai no longer automatically requests paid odds every two minutes. It uses manual refresh plus a five-minute server cache, a 12-credit UTC daily server budget, and a 50-credit provider reserve when the API quota headers are available. These safeguards are in memory and **do not survive a Render restart**. A durable quota ledger and authentication are necessary for commercial/public usage.
