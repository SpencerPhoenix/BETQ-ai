# BETQ.ai Phase 3 — Prospective Evidence Journal

## Purpose

The historical 2025 NFL Elo backtest is separate from actual **forward-recorded predictions**. Phase 3 freezes new independent predictions before NFL kickoff, tracks source timestamps, and joins subsequent final results. It does not record sportsbook orders, private customer data, real-money performance, or raw bookmaker odds.

## Sources and attribution

Independent model: BETQ NFL Elo using nflverse schedules and game results maintained by Lee Sharpe (CC BY 4.0). Results: the same community-maintained nflverse schedules release; not certified as an official NFL scoreboard. Market comparator: The Odds API v4, aggregated from at least three independent, fresh, two-way moneyline books after removal of each book's vig. The published GitHub journal stores only *derived* home-win market consensus, never raw odds, individual book prices or names.

## Scheduled collector and storage

GitHub workflow .github/workflows/capture-evidence.yml invokes scripts/capture-evidence.mjs on a daily UTC schedule and in selected Sunday/early Monday pregame windows. It asks the deployed BETQ API for a live NFL moneyline snapshot, then separately reads nflverse schedules. All provider requests consume the existing Render server quota. Budget limits and credit reserve controls apply per running instance. GitHub Actions schedules can be delayed, and Render Free instances can cold-start; late or unavailable forecasts are skipped rather than fabricated.

Records are stored in the public derived-research journal at data/evidence/nfl-YYYY.json and summarized in data/evidence/summary.json. GET /api/evidence/nfl exposes the summary, not raw provider data. Each snapshot records a unique game, capture UTC day, time window, capture timestamp, model vintage, kickoff time, model home-win probability, and eligible market consensus home probability.

- Captures are rejected if kickoff already passed, the model/source is stale, schedule match is ambiguous, or source is synthetic demo.
- The original forecast is append-only; corrections to final game scores are separately revisioned.
- The earliest frozen pregame forecast per scheduled game is the scored cohort.
- The model-training result vintage cannot be later than the capture.
- No retroactive reconstruction of an uncaptured forecast is permitted.

## Proper scoring and uncertainty

The Evidence Lab shows counts immediately but withholds aggregate performance until at least **30** subsequent completed, non-tied games have a frozen prior prediction. Thirty is a reporting threshold, not evidence of profitability.

When the sample exists, metrics are Brier score, log loss, winner accuracy, probability calibration by ten bins, and paired Brier difference against the **same-time** market median on games with both references. A deterministic 1,200-resample paired bootstrap interval shows uncertainty. Positive market-minus-model Brier difference favors the model on the sample, but alone does not establish financial value.

A separate future comparison can examine early vs near-kickoff consensus probability movement if two genuine snapshots exist. This is *not* executable closing-line value, since BETQ has not stored matching bookmaker prices or real orders. The summary permanently identifies real-money ROI and verified CLV as unavailable.

## Infrastructure limitations

A private, durable raw-odds database is **not connected**. Render free web-service disk is ephemeral. Render's free PostgreSQL expires after 30 days and the existing free instance belongs to the unrelated Trading-AI project. BETQ's derived forecast journal is a research proof of concept, not a historical sportsbook data feed or permanent private pricing store.

To support genuine CLV and realistic after-vig ROI, provision a separate authenticated persistent database, capture source-time-aligned individual book prices within a defined pre-kickoff window, independently verify final scores and fill prices, and measure model calibration, closing prices, transaction costs, variance and drawdown. Never claim a model is profitable using only historical accuracy or the first prospective cohort.


## Phase 4: prospective Elo vs EPA challenger comparison

Beginning with BETQ.ai v0.4, any independently trained EPA challenger is recorded as an **additional immutable pregame observation**, rather than replacing the earlier Elo forecast. Captures require a real NFL game and a source-valid challenger generated before capture and kickoff. If an Elo-only observation already exists in the same UTC day and time window, the challenger receives a distinct deterministic observation ID. Older Elo snapshots remain unchanged.

- The earliest genuine pregame challenger observation for a game is the challenger comparison cohort.
- The Elo forecast recorded **at that same timestamp** is the paired baseline, avoiding a comparison between mismatched model vintages.
- A challenger not available before kickoff cannot be reconstructed after the event, even if its historical feature file exists later.
- The summary reports prospective challenger games and finalized paired challenger games immediately, but suppresses all challenger performance aggregates until at least **30** previously frozen predictions have independently verified non-tie outcomes.
- After that threshold, paired Elo/challenger Brier, log loss, Brier difference, and deterministic 95% bootstrap uncertainty become available. This is outcome probability calibration, **not** sportsbook profitability, CLV, or automatic model promotion.
- The untampered 2025 backtest and the post-v0.4 forward cohort are always labeled separately.

This closes the evaluation loop for a challenger that performed modestly better on a historical 2025 holdout; it does not assume that historical improvement will continue. The current selected game probability remains the original Elo baseline pending multiple forward cohorts and independently verified market-edge evidence.

## Forward roadmap

Add verified injury/starting quarterback feed; lagged EPA, success rate and opponent-strength features; weather/rest/travel provenance; season-forward validation; source freshness monitoring; and a model promotion process requiring holdout tests plus actual prospective market improvements. Real betting and autonomous execution remain disabled.
