# Historical 2025 evaluation: local app integration

Based on PR18 (`157ed250`), initially implemented as a standalone local viewer at `4ba7233`. The current local candidate integrates the same frozen view into the app. **Nothing has been published or deployed.**

## App entry and isolation

The app navigation and Game Monitor link to `/historical-2025`, a dedicated same-origin document. It deliberately does not reuse the live-slate selectors, demo mode, prospective dossier or their JavaScript/CSS. A Back to terminal link returns to `/`. Loading the ordinary app adds no historical data requests. Opening this page reads only the local frozen index and the selected game. It cannot refresh a provider, create a forecast, write a settlement or stage a wager.

New read-only routes:

- `GET /api/historical-evaluation`: complete cohort scorecard and game picker.
- `GET /api/historical-evaluation/game?gameId=2025_...`: one retained game, including all 50 analogs.
- `/historical-source-license.txt`: exact retained CC BY 4.0 text.

Duplicate/unknown selectors and write verbs are rejected. Invalid or absent bundle data yields a sanitized 503, never a fake/live fallback. Raw compressed artifact paths are not served. The existing CSP remains in force; no iframe allowance, external resource loading or permission change was added.

Historical reads have a separate bounded 600-request/10-minute IP allowance. The existing API quota remains 180/10 minutes. Neither consumes the other's allowance. The browser caches validated game records in memory, coalesces concurrent reads, and does not refetch/re-render an unchanged selection while typing filters. HTTP 429 has distinct retry wording.

## Run locally without any provider configuration

Node 22 or later is required. The standalone loopback-only command now uses the checked-in frozen bundle by default:

```sh
npm run historical:local
```

It listens only on `127.0.0.1:3095`. Open that address on the same computer. Optional `--port NUMBER` changes only the port. Stop with Ctrl+C. A loopback address on a cloud computer is not a public preview link.

The original external-artifact route is also supported:

```sh
npm run historical:local -- --artifact-dir /absolute/path/to/betq-history-pilot/output
```

The normal app server also serves `/historical-2025`, but no server or deployment is started by this document. Tests exercise that actual handler on temporary loopback servers with provider/feed/database methods forbidden.

## Existing data, lossless packaging, licensing

The checked-in data consists of losslessly gzipped copies of two existing experiment artifacts. Decompression must exactly match their original SHA-256 fingerprints. No source was retrieved, refitted, relabeled or rewritten. No new research record, forecast or synthetic evidence was generated.

- `spread-screen.json`: 4,694,517 original bytes; 756,757 gzip bytes; SHA-256 `2081da66b9dac6be4e08e6e630b629931c3382a0248e20e0461c6c74add36933`.
- `lagged-efficiency-2023-2024-2025.json`: 2,310,327 original bytes; 244,515 gzip bytes; SHA-256 `4b9bab600ce82dc95bcb28792d0a76abf01e49701fd6b334e487db0de3a4e8c4`.

Combined compressed data is **1,001,272 bytes**. The retained license adds 18,651 bytes. The API index is **34,426 bytes** and a game is **14,848–15,097 bytes**. Data is loaded lazily and successfully validated projections are cached. Decompression is bounded; the entire archives are never sent to the browser.

The retained source manifest names nflverse/nflfastR contributors and Lee Sharpe, and states CC BY 4.0. The exact retained license, source URLs, attribution, prior transformations, lossless packaging change and warranty notice are included in the bundle and viewer. No FTN participation data was used. See `data/historical-2025/README.md`.

This verifies preservation of the existing licensing notices, not independent legal clearance or every upstream party's rights. CC licenses cover only rights their licensors can grant. The viewer makes no claim of official league certification. Publication/deployment requires separate authorization and release review.

## Functional scope and interpretation

- All **285 games**: 272 regular-season games, 13 playoff games, one spread push.
- Team abbreviation, date/game-ID search; week/phase filtering; chronological selection; Previous/Next and browser history.
- Actual score and home margin; recorded market margin; market-plus-efficiency margin; independent efficiency margin. Signed error = forecast minus actual, with absolute error alongside it.
- Lagged EPA/success/rest values and the included prior-game IDs/dates.
- All **50 retained 2023/2024 analogs** per game, nearest first, with distance, actual/market margin and spread outcome. The historical cover frequency is descriptive, not a validated forecast probability.
- Exact fingerprints, source metadata, attribution, protocol and method. Asset update, local verification and protocol times are not presented as pregame availability or final-result certification.
- Loading, empty, error, retry and stale-response handling. The skip link preserves filters/selection. No success, older error or stale response can replace a newer game.
- Labeled controls, status regions, focus styles, mobile single-column rules, 44px controls and keyboard-accessible horizontal table scrolling.

| Point forecast | MAE | RMSE |
| --- | ---: | ---: |
| Recorded market line | 9.670175 | 12.244798 |
| Market + efficiency correction | 9.793266 | 12.300429 |
| Independent efficiency model | 10.254470 | 13.155860 |

The correction reduces absolute error in 130 games and increases it in 155. It did **not** beat the benchmark. These seasons were repeatedly inspected; this is development evidence, not an untouched test or prospective performance. No verified edge, ROI, CLV, or wager recommendation is claimed.

The experiment's probability scores use research residual distributions around point forecasts, not authenticated sportsbook fair probabilities. This view focuses on point-margin errors without suggesting validated probabilities. Quote timing, bookmaker identity, fills, input availability, pregame QB status, injuries and weather remain unverified. These historical outcomes stay separate from the qualified prospective-outcome count and never enter its journal.

## Verification and remaining release gates

```sh
npm test -- tests/historical-evaluation.test.mjs tests/historical-app-integration.test.mjs
npm run check
npm test
npm run historical:verify -- /absolute/path/to/betq-history-pilot/output
```

Tests cover exact source fingerprints, bounded decompression, all 285 production-handler game responses and 14,250 analogs, preserved license notices, no provider/feed/database calls, query/verb rejection, raw-path denial, bounded quota separation, cache/coalescing, filters/history/skip-link behavior and failure/race handling. Synthetic unit fixtures are labeled and never written into research evidence. Temporary servers close after verification.

**Visual/mobile QA remains blocked.** No real screenshots, measured 360/390px layout, actual focus/scroll behavior or screen-reader certification were completed. The earlier browser denial and instruction against alternate browser routes were respected. API/VM/source tests do not satisfy that release gate.

The local candidate also needs review of eventual publication/build/workflow effects before any authorized release. Existing workflows, lockfile, pre-existing data, forecasts, journals, thresholds and execution gates remain unchanged; the only new data files are the lossless frozen copies and their licensing documentation.

### Final local verification, November 7, 2026

- **495 tests passed**, zero failed or skipped. Historical-focused coverage is **31 tests**.
- Syntax and whitespace checks passed.
- All 285 real records and 14,250 analogs pass validation/rendering. The actual app-handler test reads the complete cohort with every provider, remote-feed and database method forbidden.
- Original artifact hashes remain unchanged. Gzip decompression reproduces the original bytes exactly. License text is byte-identical to the retained source copy.
- Independent review's shared-quota finding was fixed and re-reviewed; no remaining material code finding was reported.
- Browser/mobile/assistive-technology QA remains unperformed, not passed. No browser denial was retried or bypassed.
