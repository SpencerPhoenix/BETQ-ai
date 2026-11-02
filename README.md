# BETQ.ai — Quant Sports Intelligence Terminal

BETQ.ai is a self-hosted, data-first sports odds research terminal. It compares sportsbook prices with a **leave-one-book-out, no-vig market consensus**, reports market-implied win probability, price edge, indicative EV, risk-limited theoretical sizing, source freshness and explicit PASS/WATCH gates.

**Model boundaries:** NFL moneyline research includes an independently fitted, walk-forward tested Elo baseline sourced from nflverse results. It does not include verified current QB/starter status, injury adjustments, EPA, travel or weather. NFL model-derived EV is research-only and has not shown a profitable edge against market closing prices. Other leagues and spreads/totals remain market-only. BETQ.ai never places wagers or guarantees returns.

## Quick start

Requires Node.js 22+; no npm dependencies.

```bash
cp .env.example .env  # optional; environment variable loading described below
ODDS_API_KEY=your_the_odds_api_key npm start
```

Open http://localhost:3000. Without the key, use **Demo** to explore synthetic, clearly labeled sample events. The `.env` file is not auto-loaded; Node 22 can use `node --env-file=.env src/server.mjs` or set environment variables in your hosting platform.

Run `npm test` for the offline quant and HTTP/security tests. Run `npm run check` for syntax validation.

## Live configuration

Set `ODDS_API_KEY` as an **environment variable of the running web service**; a GitHub Actions secret does not automatically become a production runtime secret. The supported source is [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/). NFL, NBA, MLB, NHL and NCAAF are selectable. The standard odds feed supports moneyline, spreads and totals when the operator's plan provides them. Requests are cached to conserve credits.

`PORT` (default 3000), `CACHE_TTL_MS` (default 300000), `ODDS_MAX_AGE_MS` (default 600000), `ODDS_DAILY_CREDIT_LIMIT` (default 12) and `ODDS_MIN_CREDITS_RESERVE` (default 50) are optional. Paid odds data refresh is **manual only** from the terminal to avoid depleting credits. A per-day, in-memory upstream budget is enforced; this guard resets if Render restarts, so it is a safeguard rather than durable accounting. No API key is embedded in client code, logs, or repository files.

## Decision policy

- Convert prices to decimal / implied probability.
- Remove vig separately inside each qualifying two-way bookmaker pair.
- Match **identical handicap/total lines**; never average prices at different lines.
- Estimate a median baseline from **other** books, excluding the offered book.
- Show EV, edge, Kelly-based *theoretical* sizing and quality.
- Block executable labels when games started, quotes stale, comparators insufficient, data inconsistent or price advantage unconvincing.
- Mark all model-free opportunities as **WATCH / market-only**, not validated picks.
- Show injury, weather and first-half analysis as unavailable until verified sources are connected.
- Present NFL Elo historical outcome win probabilities in **Prediction Lab**, separately from market-derived price discrepancies, with visible 2025 holdout accuracy and Brier/log-loss metrics.

All demo events are fictitious and marked `DEMO`. User-created paper tickets remain on that device in localStorage (not a sportsbook or a synced account).

## Independent NFL Elo baseline (Phase 2)

The reproducible runner `node scripts/train-nfl.mjs` reads the CC BY 4.0 nflverse schedules release maintained by Lee Sharpe, including historical game results, never betting odds. It tunes Elo parameters on 2018–2022 games, calibrates on 2023–2024, and evaluates once against untouched 2025 games. Only completed games up to the training date advance current ratings. Ties are excluded from binary metrics. Model probabilities are shown **only** for actual upcoming NFL moneylines, never synthetic demo games. The `NFL historical model research refresh` GitHub Action checks for result changes daily and commits a small versioned JSON artifact. It does not use your Odds API key.

The baseline's 2025 holdout performance, sources, parameter choices, last-game date and warnings are available through `GET /api/model/nfl` and the Prediction Lab. Treat these statistics as a backtest, not proof of a market-beating system. See `docs/MODEL.md`.

## Deploy

`render.yaml` describes an optional Render Node web service. Link the repository in Render, then enter `ODDS_API_KEY` in the service environment. Deployment is managed separately in Render; a GitHub commit does not guarantee that the service successfully redeployed. Verify the production version at `GET /api/health`.

## Documentation

See `docs/ARCHITECTURE.md` and `docs/MODEL.md` for data lineage, caveats, reproducibility, and next-phase milestones.
