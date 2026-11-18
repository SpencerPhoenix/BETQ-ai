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

The current source separates quota accounting from the odds cache:

- Public reads are cache-only. Paid refresh requires explicit paid-request intent and operator authentication; the browser does not receive the operator credential.
- The production-default budget adapter requires an account-bound PostgreSQL ledger with verified TLS. Missing configuration, an unavailable ledger, or an absent/stale verified quota baseline blocks paid provider access; there is no in-memory budget fallback.
- The default configured limits are 12 credits per UTC day and a 50-credit provider reserve. These are code defaults, not verified live settings. Ledger reservations precede provider requests, and unresolved reservations block further spending until reconciled. Database-backed accounting is designed to survive application restarts; it does not automatically provision a database, migrate its schema, or seed quota.
- The odds-response cache is in memory by default (five-minute default TTL) and is separate from durable credit accounting. The optional PostgreSQL snapshot adapter is preparation, not automatic production wiring; restoring a snapshot never seeds or refreshes provider quota.

These statements describe source capabilities, **not a verified live deployment, connected database, or enabled paid refresh**. Deployment version, operator configuration, ledger readiness and current account quota must be checked before activation. See [provider budget setup and recovery](PROVIDER_BUDGET.md) and [private odds snapshot operations and activation prerequisites](../ODDS_SNAPSHOT_OPERATIONS.md).
