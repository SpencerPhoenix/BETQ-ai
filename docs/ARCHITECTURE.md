# Architecture and source integrity

## Live flow

Browser -> same-origin /api/slate -> validated Node.js API -> The Odds API v4 -> 90-second cached snapshot -> quant engine -> API analysis -> terminal UI.

Sports: NFL, NBA, MLB, NHL and NCAAF. Market keys: h2h, spreads, totals. The provider's region is US, odds format American, timestamps ISO8601.

## Market-only method

For each game, every bookmaker's price pair is normalized to remove its margin. Spreads and totals must match exactly on the line value. The candidate's own bookmaker is removed from the reference set. The median fair probability of the other books produces a **market-consensus proxy**.

Offered implied probability = 1 / decimal odds. Price edge in percentage points = 100 x (consensus probability - implied probability). Estimated EV per dollar = consensus probability x decimal odds - 1.

This is **not** an independent or validated prediction model. A WATCH means a potential price discrepancy worth checking. A quality score measures comparator count, freshness and agreement, not the chance that a wager wins.

## Safeguards

- No model-backed verified picks, injury adjustments, QB validation, weather or halftime leans are fabricated.
- The scan excludes stale bookmaker quotes. Started games, imminent kickoff, thin lines, weak edges and too few comparators cannot pass WATCH.
- Paper log is browser-local and never places wagers. Paper settlement is user-entered and **not** independently verified.
- Quarter Kelly calculations use an unvalidated market proxy and are theoretical only; a single paper ticket is capped at 1% bankroll, total paper exposure at 5%.
- Live scores are requested on demand using The Odds API scores endpoint and consume credits; demo scores are never fabricated.
- The backend has no third-party dependencies, allowlists all routes and filters, uses a 10-second fetch timeout, caps upstream JSON size, includes simple IP throttling, and serves strict CSP headers. Untrusted data is escaped before UI rendering.
- The Odds API key must be a private server environment variable (ODDS_API_KEY), not a browser key or GitHub source file.

## Roadmap for production-grade model-backed picks

1. Verified league-specific starters, official injury status, lineup, rest/travel and weather feeds with provenance.
2. Historical game and play-by-play features; independent out-of-sample backtesting, recalibration and versioned feature pipeline.
3. Probability calibration reports (Brier score/log loss), closing-line value, predictive skill, drawdown and stake-adjusted ROI.
4. Persist immutable quote snapshots and results, add authentication, per-user quotas and secured paper performance verification.
5. Live-specific injury and play-event models before any in-play signal. Integrate half-time markets only with a separately validated 1H model.
6. Mobile end-to-end browser tests, error monitoring and nightly CI stress suites.

## Source notes

The Odds API v4 documentation:
https://the-odds-api.com/liveapi/guides/v4/

Featured odds are typically billed per region and market; scores with daysFrom cost two credits. Price availability, supported leagues, markets and provider terms depend on the user's API plan. No false claim of access to proprietary injury/EV datasets is made.

No automatic wager placement, guarantee of profit or real-money order support is included.
