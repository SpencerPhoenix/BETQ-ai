# BETQ.ai Phase 4 — EPA intelligence and injury source reports

## What changed

BETQ.ai v0.4 includes a second independent NFL research model which uses lagged offensive and defensive EPA/play, success rates, and rest-day differences extracted from nflverse play-by-play. It also displays public weekly injury reports with source timestamps. This is research infrastructure, **not an automatically promoted pick model**. The Elo baseline remains the selected projection until there is stronger prospective, source-aligned verification.

## Sources and attribution

- nflverse/nflverse-data [GitHub releases](https://github.com/nflverse/nflverse-data): PBP, injuries, schedules; CC BY 4.0. Play-by-play EPA originates in nflfastR.
- Historical schedule results maintained by Lee Sharpe, also published under nflverse data.
- Full original source files are read by GitHub Actions, not committed to BETQ. Only compact derived team trends, historical validation statistics and limited reported injury metadata are written to versioned artifacts.
- A 2026 nflverse injury CSV lacks the individual player date_modified column even though earlier documentation lists it. BETQ therefore uses the GitHub release asset update time as **file vintage only**, not a player's last injury update time. Conflicting duplicate statuses without a timestamp are excluded.

## No-lookahead feature design

For each completed historical NFL game, the engine first records the pregame Elo win probability and rolling efficiency features from the preceding eight completed games. At least four prior qualifying games per team must be available. It then appends current-game EPA and success statistics to team histories. EPA is averaged only over verified NFL PBP rushes and dropbacks with valid EPA, with a minimum of 25 offensive plays per team, source game-ID matching and a completed schedule result. Team net EPA is offense EPA minus opponent EPA allowed. Rest is derived from prior game dates, with its differential bounded.

The feature model is tuned using 2018–2022, scaled on 2023–2024 calibration games and evaluated on the **untouched 2025 season**. It is separate from the Elo baseline training, and is not fit to sportsbook odds.

| Untouched 2025 comparison | Elo baseline | EPA challenger |
| --- | ---: | ---: |
| Completed games | 284 | 284 |
| Brier score (lower better) | 0.22235 | 0.21935 |
| Log loss (lower better) | 0.63596 | 0.62950 |
| Winner accuracy | 65.85% | 66.20% |

Paired Brier improvement on the same games: **0.00300**, with deterministic 2,000-resample paired bootstrap 95% interval **0.00025 to 0.00567**. These are one-season historical results, not proof of profitability or prospective superiority. Bootstrap bounds are sensitive to game correlation and model selection.

The historical challenger gate passed, but BETQ does not auto-promote the model or use its probabilities to create real-money orders.

## Source-vintage gates

- The per-game efficiency challenger is suppressed when missing, incomplete or older than seven days.
- Reported injuries are restricted to the matched game week and fixture, from a source no older than 72 hours.
- Missing injury report, missing QB player entry and unavailable injury timestamps never imply a healthy or confirmed starter.
- All injury reports are informational; **no QB-starter assumption, injury adjustment, or player-specific point spread is applied**.
- Real sportsbook data and market-only WATCH/PASS remain separate from all model predictions.

## APIs and schedules

Read-only metadata paths: GET /api/model/efficiency and GET /api/injuries/nfl. Live NFL moneyline responses include per-game efficiencyChallenger and injuryContext, with unverified fields explicitly false.

Training code: scripts/train-efficiency.mjs, src/pbp.mjs and src/nfl-efficiency.mjs. Source injury validation: src/injuries.mjs and scripts/update-injuries.mjs.

Workflows update EPA research weekly on Tuesday (10:37 UTC) and injury reports daily (10:24 UTC). These source downloads do not consume paid Odds API credits. The production live-odds diagnostic is manual-only to avoid spending credits on each code push.

## Remaining scientific and product work

Independently verify NFL starting quarterbacks through timestamped team/league sources; add opponent-adjusted features and weather; compare challenger to actual pregame bookmaker closing prices and a full forward cohort; evaluate model calibration, uncertainty, drift and economic performance after realistic transaction constraints. Keep predictions and confidence separate from execution.

No real wagers are placed. No ROI or closing-line-value advantage has been established.
