# Odds-independent on-demand game card

`/game-card` calls `GET /api/game-evaluation?gameId=2026_10_LAC_BAL`.
The endpoint reads only the public NFL weekly schedule, then evaluates the installed
Elo artifact and separately reports the efficiency challenger. No Odds API method,
paid credits, bookmaker credentials, or bet submission is involved.

Official weekly receipts expire after five minutes. Missing/invalid official
fixtures, started games, stale model artifacts, and failed source requests fail
closed. Regular-season weeks 1–18 only. Each receipt exposes its observation time,
body hash, actual matchup kickoff, model identity and build date. Observation time
is not an assertion of source publication time. The page separately shows supported
official roster context, which does not alter model probabilities. It must not
present that partial coverage as a complete injury report.

Optional user-entered moneyline comparison is unverified arithmetic against an
incomplete model, not independently collected live odds, a verified edge, an
injury-adjusted forecast, a stake recommendation, or realized ROI. No forecast is
automatically archived; this response cannot retroactively replace frozen pregame
evidence. Spread and total probabilities remain unavailable. No prediction-quality
improvement is claimed by this delivery feature.

Validation: `npm run check && npm test` on Node 26.13.1. Optional offline desktop/
mobile browser QA: `CHROMIUM_PATH=/path/to/chromium python tests/on-demand-browser.py`.
All browser network requests in that test are intercepted fixtures. The current
container blocks Chromium's local sockets, so that browser test has not passed here.

## Automatic discovery

The homepage and full card now discover nearby upcoming regular-season fixtures
on opening. A bounded three-week calendar hint selects which official pages to
inspect; it never creates a fixture. Displayed games must be official, explicitly
pregame, future kickoffs in the next seven days. The nearest verified fixture is
selected with game ID as a deterministic tie-break. Partial source failures and
limited coverage are disclosed. Device-local full dates avoid UTC-midnight hiding
an evening game. No supported fixture means no substituted pick.

This is on-open generation, not a scheduler or durable archive. The displayed
outright choice follows the unadjusted Elo probability and is not a value-bet
recommendation. Current bookmaker odds remain unavailable. Main-page probabilities
are removed at source expiry; full-card comparisons also expire. Manual matchup
selection is retained and takes precedence over a late discovery response.
