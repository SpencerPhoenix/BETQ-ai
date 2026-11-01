# BETQ.ai — Quant Sports Intelligence Terminal

BETQ.ai is a self-hosted, data-first sports odds research terminal. It compares sportsbook prices with a **leave-one-book-out, no-vig market consensus**, reports market-implied win probability, price edge, indicative EV, risk-limited theoretical sizing, source freshness and explicit PASS/WATCH gates.

**Price discrepancies are not independently validated predictive edges.** BETQ.ai does not place wagers and never claims guaranteed returns. A verified injury/weather feed, independent calibrated prediction model and backtesting must be added before model-backed plays can be represented as such.

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

`PORT` (default 3000), `CACHE_TTL_MS` (default 90000), and `ODDS_MAX_AGE_MS` (default 600000) are optional. No API key is embedded in client code, logs, or repository files.

## Decision policy

- Convert prices to decimal / implied probability.
- Remove vig separately inside each qualifying two-way bookmaker pair.
- Match **identical handicap/total lines**; never average prices at different lines.
- Estimate a median baseline from **other** books, excluding the offered book.
- Show EV, edge, Kelly-based *theoretical* sizing and quality.
- Block executable labels when games started, quotes stale, comparators insufficient, data inconsistent or price advantage unconvincing.
- Mark all model-free opportunities as **WATCH / market-only**, not validated picks.
- Show injury, weather, model-validation and first-half analysis as unavailable until verified sources are connected.

All demo events are fictitious and marked `DEMO`. User-created paper tickets remain on that device in localStorage (not a sportsbook or a synced account).

## Deploy

`render.yaml` describes an optional Render Node web service. Link the repository in Render, then enter `ODDS_API_KEY` in the service environment. Deployment is not automatically created by this repository.

## Documentation

See `docs/ARCHITECTURE.md` for data lineage, caveats, and expansion milestones.
