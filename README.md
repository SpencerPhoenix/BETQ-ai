# BETQ.ai — Quant Sports Intelligence Terminal

BETQ.ai is a self-hosted, data-first sports odds research terminal. It compares sportsbook prices with a **leave-one-book-out, no-vig market consensus**, reports market-implied win probability, price edge, indicative EV, risk-limited theoretical sizing, source freshness and explicit PASS/WATCH gates.

**Model boundaries:** NFL moneyline research includes an independently fitted, walk-forward tested Elo baseline sourced from nflverse results. It does not include verified current QB/starter status, injury adjustments, EPA, travel or weather. NFL model-derived EV is research-only and has not shown a profitable edge against market closing prices. Other leagues and spreads/totals remain market-only. BETQ.ai never places wagers or guarantees returns.

## Quick start

Requires Node.js 22+. Run `npm ci --ignore-scripts` to install the locked PostgreSQL client dependency.

```bash
cp .env.example .env  # optional; environment variable loading described below
ODDS_API_KEY=your_the_odds_api_key npm start
```

Open http://localhost:3000. Without the key, use **Demo** to explore synthetic, clearly labeled sample events. The `.env` file is not auto-loaded; Node 22 can use `node --env-file=.env src/server.mjs` or set environment variables in your hosting platform.

Run `npm test` for the offline quant and HTTP/security tests. Run `npm run check` for syntax validation.

## Live configuration

Set `ODDS_API_KEY` as an **environment variable of the running web service**; a GitHub Actions secret does not automatically become a production runtime secret. The supported source is [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/). NFL, NBA, MLB, NHL and NCAAF are selectable. The standard odds feed supports moneyline, spreads and totals when the operator's plan provides them. Requests are cached to conserve credits.

`PORT` (default 3000), `CACHE_TTL_MS` (default 300000), and `ODDS_MAX_AGE_MS` (default 600000) are optional. Public page loads, navigation, refresh and scores controls **only read the existing fresh cache**. On an empty or expired cache the API returns `409 PAID_REFRESH_REQUIRED` without a provider request. The browser has no paid refresh permission or credential field. A failed reload preserves the prior snapshot for the same selection and marks it retained; it does not relabel it fresh.

Paid refresh requires **both** `x-betq-paid-request: true` and a matching `Authorization: Bearer …` using the server-only `BETQ_OPERATOR_REFRESH_TOKEN`. Tokens must be 32–512 characters from letters, digits, `.`, `_`, `~` and `-`. No credential is shipped in browser code or localStorage. `HEAD`, query parameters, a paid-intent header alone and a bearer alone cannot authorize upstream calls. The default source API is also cache-only unless an authenticated server path opts in.

A paid request also requires a dedicated configured PostgreSQL ledger (`BETQ_BUDGET_DATABASE_URL`, `BETQ_BUDGET_ACCOUNT_ID`) with an explicitly seeded, verified provider balance. Database URLs must be TCP PostgreSQL URLs without query or fragment options. The application supplies verified TLS explicitly; URL SSL modes, certificate-file overrides and socket-host overrides are rejected before a connection is attempted. There is no process-local fallback and no automatic migration or quota discovery. `ODDS_DAILY_CREDIT_LIMIT` defaults to 12 only when absent; explicit zero disables paid requests, and malformed or fractional settings fail closed. `ODDS_MIN_CREDITS_RESERVE` defaults to 50 only when absent. Large valid reserve floors are never lowered by a clamp. The stored account policy can only tighten the process cap/floor. All instances using one provider account must share the same ledger and account identity.

Reservations commit before provider requests, survive restarts, and stay charged on failure. An unresolved request blocks further spending even after midnight until its outcome is reconciled; missing or malformed quota cannot silently release it. Remaining balance never automatically increases. See [durable budget setup, recovery and verification boundaries](docs/PROVIDER_BUDGET.md). **Isolated PostgreSQL 17.11 transport, concurrency, crash/recovery and uncertain-COMMIT checks passed; production configuration and deployment remain unverified.** See [transport hardening and verification](docs/POSTGRES_TRANSPORT_REVIEW.md). These changes are local implementation, not a configured production rollout.

The three operator workflows explicitly map the repository secret `BETQ_OPERATOR_REFRESH_TOKEN`; configuring it and the corresponding runtime secret is a separate operator action. The collector skips paid capture when its token or preflight is unavailable and still reconciles public schedule results. Operator requests default to `https://betq-ai.onrender.com`, require HTTPS, and reject redirects. An alternate `BETQ_PRODUCTION_URL` needs the exact bare HTTPS origin also set as `BETQ_OPERATOR_APPROVED_ORIGIN`; changing a URL alone does not authorize a credential destination.

`/api/health` distinguishes a running web server from blocked provider refresh prerequisites. `captureReadiness` covers only authentication and budget readiness; `collectionHealth` separately reports that the web service does not observe scheduled attempts, plus the latest bundled capture time/age. Bundled evidence may lag the collector and does not establish that collection is healthy. Collector logs explicitly report skipped or zero-eligible capture runs. No API keys or operator tokens appear in these diagnostics.


## Per-game retained research dossier

The Game Monitor includes a **retained NFL dossier index** that works without a live odds cache. Each dossier reads the complete bundled derived journal, not the aggregate summary preview. It shows the original first frozen forecast separately from the latest retained observation, model versions and build/result-cutoff dates, same-capture market consensus, source receipt and quote timestamps, missing fields, and retained result qualification. Market-derived consensus is not an independent BETQ model. A source-corroborated result is not official league certification or proof of independent sources; ties remain excluded from binary model scoring.

`GET /api/research/games` lists retained games. `GET /api/research/game?gameId=…` or `?providerEventId=…` reads exactly one unambiguous retained game. These routes do not request odds, refresh a remote journal, recompute forecasts, or write outcomes. The response generation time is separate from the actual bundled capture time. Missing, contradictory, malformed, ambiguous or future-dated evidence fails closed. Opening a dossier never unlocks paper staging or wagering.

The view is specifically archived NFL full-game moneyline research, separate from current sport/market/demo filters. Starting-quarterback, injury and weather adjustments remain unverified. Comparable games are explicitly unavailable because no validated comparability method is implemented; no similar-game win rate or profitable edge is invented. See [dossier contract and verification boundaries](docs/GAME_DOSSIER.md).

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

## v0.8 — One risk authority across agents, pricing, and paper actions

Before v0.8, a market-only WATCH price discrepancy could offer automatic paper staking even while the model risk agent said PASS_NO_PROVEN_MARKET_EDGE. This was misleading. The server now applies a **central post-analysis risk veto** to every live or demo opportunity: raw market WATCH remains audit-visible as PRICE WATCH · NOT A BET, while recommended units and automatic paper staging are disabled until a genuinely verified predictive edge and execution source exist. Existing locally saved paper histories remain manually auditable, but no new automatically sized positions are authorized.

Every `/api/slate` activation now reports Market Data, Probability, Market Calibration, **Selection Bias Guardian**, Historical Audit and Risk & Execution stages using one shared odds request. The historical bias warning reports that 720/879 original modeled 3% EV selections (81.91%) were closing-market underdogs, with material selected-side overconfidence. These retrospective closing prices were not verified actual entry offers.

Read-only `/api/risk/nfl` provides 10,000-path **conditional week-block bootstrap** stress scenarios for the original losing strategy, including median, 5th/95th outcome percentiles, drawdowns, and frequency of touching a user-understandable 50%-of-starting-bankroll threshold. This is **not** a true risk-of-ruin estimate or a forecast of real betting performance; it relies on hypothetical closing-price decisions. The dashboard loads the risk report on activation without another Odds API request.

Reference results: at 1% stake per position, the historical-conditional simulator produced median −62.47% bankroll change, with 82.33% of paths touching the defined half-bankroll threshold. At 0.5% stake, median −37.46%, with 18.76% touching the same threshold. Smaller stakes do not correct an unprofitable selection model. Full assumptions and known limitations: [Central Decision and Risk Governance](docs/RISK_GOVERNANCE.md).

## Pre-registered independent research — residual information and winner's curse

Following an independent research review, BETQ ran a **frozen, retrospective** nested market-offset logistic regression, selected-side disagreement deciles and 400 efficient-market null simulations. The actual market-only benchmark remained stronger on pooled Brier/log loss. In the highest model–market disagreement decile the Elo-selected side was projected at **53.59%** but won **34.66%**, versus a **31.24%** historical closing-market reference. The residual did **not** pass the preregistered promotion-evidence gate.

The efficient-market synthetic null produced **1 false approval in 400 simulated worlds (0.25%)** under its specified assumptions. This is not a universal false-positive rate, and it does not show that the gate has enough power to detect a real small edge.

**No model was promoted, and no betting was enabled.** The historical records use untimestamped closing odds and repeatedly inspected seasons, so they cannot establish achievable entries, CLV or a new pristine holdout. See [pre-registration](docs/RESEARCH_PROTOCOL_RESIDUAL_2026_11_02.md) and [full results](docs/RESIDUAL_RESEARCH_FINDINGS.md). The research can be reproduced with `npm run research:residual`, which uses publicly attributed nflverse schedules and no paid Odds API credits.

## v0.10 — Prospective evidence, not manufactured profitability

The QB Latency Lab now includes a **model-vs-later-market movement diagnostic** computed from the existing append-only forward journal. It asks whether BETQ's **first independently dated pregame Elo disagreement** predicted the **direction of subsequently observed** derived market consensus changes. The protocol is fixed at a 3-percentage-point original model disagreement, 0.5-point later material market move, 15-minute separation and 30 independent qualifying games before reporting even a descriptive hit rate.

The initial forward audit used 33 pregame snapshots across 17 games. Only 9 games had eligible timestamp-separated observations; 3 qualified for direction scoring, with 1 aligned and 2 opposed movements. **The sample is insufficient to claim a predictive advantage, CLV, profitable trading, or real-money ROI.** The audit does not invoke paid The Odds API calls or expose bookmaker-identifiable raw quotes. The separate true sportsbook-entry/CLV archive still requires dedicated private durable storage and evidence of actual executable quotes.

See [source-audited v0.10 forward results](docs/PROSPECTIVE_DIRECTION_AUDIT.md). Reproduce with `npm run audit:direction`; the `BETQ prospective model versus market movement audit` GitHub workflow also checks new source-journal commits. All server-side wagering and automatic paper-staking locks remain active.

## v0.11 — Prospective market-relative evidence (no executable-edge claim)

BETQ's forward journal now supports a **preregistered, market-relative sequential likelihood monitor** alongside the previously built prospective market-movement direction audit. It compares the *first independently timestamped* eligible pregame Elo and efficiency projections to the same-time 3+ bookmaker derived market probability, then scores the eventual final game once. A fixed 50/50 model mixture and a research-only likelihood threshold are used. No model weight, threshold or betting decision is tuned based on observed results.

**The proper score comparison and likelihood evidence are withheld until 30 independent settled qualifying games.** Early samples cannot be marketed as forecasting superiority. The mathematical e-process interpretation assumes market probabilities are the true conditional win probabilities, which is unverified for real sportsbook prices.

A deterministic synthetic check over 1,000 null worlds and 1,000 injected-signal worlds (150 games per world) crossed the illustrative likelihood threshold in **3.2% of null worlds** and **51.6% with a genuine synthetic probability signal**. These are simulation results, not measured BETQ NFL skill or real returns. See [methodology and limitations](docs/MARKET_SEQUENTIAL_EVIDENCE.md).

Only existing forward-derived journal data are read; **no additional Odds API requests**, new private source purchases or stored raw bookmaker prices result from this feature. Full research audit: `npm run audit:sequential`; automatically rechecked with each prospective journal update. No sportsbook execution, actual CLV, or realized ROI is established. The central server-side no-wagering and automatic-paper-staking veto remains in force.

## Deploy

`render.yaml` describes an optional Render Node web service. Link the repository in Render, then enter `ODDS_API_KEY` in the service environment. Deployment is managed separately in Render; a GitHub commit does not guarantee that the service successfully redeployed. Verify the production version at `GET /api/health`.

## Documentation

See `docs/ARCHITECTURE.md` and `docs/MODEL.md` for data lineage, caveats, reproducibility, and next-phase milestones.
