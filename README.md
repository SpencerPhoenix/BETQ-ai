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

## Prospective forward evidence (Phase 3)

BETQ.ai now separates the historical backtest from *new forecasts frozen before kickoff*. A scheduled GitHub Actions collector calls the existing public, read-only NFL odds endpoint at a controlled cadence, reads nflverse schedule results, and appends derived-only observations to the current NFL season journal. It **never** stores raw bookmaker odds, prices, books, or API keys in the public repository.

After the game, a later nflverse final score is joined to the locked model forecast; corrections are recorded separately, without changing the prediction. An independent multi-book no-vig **median market probability** is stored only when at least three independent fresh books support it. After a minimum of 30 finalized games, the Evidence Lab reports pregame accuracy and proper scoring rules, with paired same-time comparisons and bootstrap uncertainty. Before that, it shows a transparent collecting status. The 30-game threshold is a minimum disclosure gate, **not proof of superiority or profit**.

Important: a same-time market-consensus baseline is **not closing-line value**, and there are no verified real-money betting results, CLV, ROI, or automated orders. The journal cannot establish profitability without full price-time-aligned odds archival, settlement verification, and prospective testing. The server reads the latest derived summary from a fixed public GitHub URL with a five-minute cache, so newly committed evidence can appear without a fresh Render deployment. GitHub serves a derived research journal; durable raw-odds archival requires a separate authenticated database, not the expiring free Render database allocated to another project. See `docs/EVIDENCE.md`.

## Phase 4: Independent NFL EPA challenger and sourced injury reports

The Prediction Lab includes a **separately backtested, unpromoted challenger** using lagged offensive/defensive EPA, success rates, and rest days. nflverse PBP data is processed as a streaming source, retaining only complete-game derived statistics. Source-vintage reporting and a 2025 untouched holdout are visible in the read-only API.

On 284 untouched 2025 NFL games, the original Elo scored Brier 0.22235 and the EPA challenger Brier 0.21935 (paired improvement 0.003; deterministic bootstrap 95% interval +0.00025 to +0.00567). This is evidence of a **modest historical probability-scoring improvement**, not a validated bookmaker edge or forward-season betting profit. Automatic promotion and real wagering remain disabled.

A separate nflverse weekly injury-status report includes an upstream source timestamp, game-week matchup matching, and honest unavailable/stale flags. Player status is **not confirmed starting QB status** and makes no adjustments to model probabilities. Current 2026 CSV supplies source vintage but does not include individual player update timestamps; BETQ will never invent them.

New metadata endpoints: `GET /api/model/efficiency` and `GET /api/injuries/nfl`. In live NFL moneyline mode, per-game results include `efficiencyChallenger` and `injuryContext`. Two new GitHub Actions jobs refresh the research model weekly and public reports daily, without consuming paid Odds API credits. The paid production odds probe is now **manual-only**.

See `docs/INTELLIGENCE.md` for methodological details, uncertainty, credit safeguards and remaining validation.

## ROI & Closing Line Value (v0.5)

The terminal now includes an **ROI & CLV Lab**. It illustrates how American prices are converted into decimal odds, how to compute matched price movement and an optional two-sided no-vig closing reference, and how WIN/LOSS/PUSH/VOID change net profit per stake.

**Never interpret an illustrative price difference as verified CLV or an example settlement as verified ROI.** BETQ does not yet have an authenticated sportsbook fill ledger, certified matched closing quotes, or independently confirmed real-money settlements. Its existing derived-probability evidence journal cannot reconstruct them. The UI separates real metrics (unavailable) from local manually graded **paper-only** ROI.

The calculator is a read-only, rate-limited same-origin endpoint; it does not consume Odds API credits or record user entries. The underlying engine validates identical event/market/side/period/handicap and chronological quotes before even labeling a closing-price proxy. Details and worked examples: [Price Validation contract](docs/PRICE_VALIDATION.md).

## v0.7 — Industry-style conservative market calibration

BETQ.ai now runs a **strictly earlier-season calibrated market-versus-Elo competition** using the nflverse historical closing moneyline references. It does not blindly promote the independent Elo win probabilities or false-positive model EV selections. See [full nested annual analysis](docs/MARKET_CALIBRATION.md).

On 2022–2025 historical tests the closing market had lower Brier loss in all four years; the prior-year-calibrated model residual therefore received **0% weight** each season. The independent model has not established incremental profitability. BETQ's live research-only market reference uses at least **three fresh two-sided sportsbooks** and a no-vig median; this is a market-derived estimate, **not** independent BETQ predictive accuracy.

Higher winner rates were possible by selecting obvious favorites: market favorites rated ≥65% had a **75.29%** historical hit rate, but **−3.32%** conditional hypothetical stake ROI at closing prices. Favorites rated ≥70% hit **79.56%**, but still had **−1.67%** hypothetical ROI. These prices are not verified accessible entries. A high win ratio is not itself a valid gambling edge.

The session-level Market, Probability, Market Calibration, Historical Audit, and Risk agents evaluate the shared live snapshot without extra paid odds calls. The system displays a PASS/no-proven-edge decision when the independently tested model has not outperformed the closing market. **No real wagers, historical CLV, or audited real-money ROI are claimed.**

## Deploy

`render.yaml` describes an optional Render Node web service. Link the repository in Render, then enter `ODDS_API_KEY` in the service environment. Deployment is managed separately in Render; a GitHub commit does not guarantee that the service successfully redeployed. Verify the production version at `GET /api/health`.

## Documentation

See `docs/ARCHITECTURE.md` and `docs/MODEL.md` for data lineage, caveats, reproducibility, and next-phase milestones.
