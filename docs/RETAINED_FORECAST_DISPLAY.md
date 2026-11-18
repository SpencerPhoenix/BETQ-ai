# Retained outright forecast display

This read-only Game Monitor panel makes actual saved Elo preferences visible without a live odds slate. It is deliberately separate from the selected league, market and synthetic demo. `GET /api/research/forecasts` rejects query parameters and uses the same retained-journal validation and allowlisted scalar projection as game dossiers. It neither runs a model nor writes or settles evidence. In the integrated candidate, it reads the same accepted full-journal snapshot as `/api/evidence/nfl` and the dossier routes, including the accepted publication source/digest and the reader clock after any bounded public-journal read. It never contacts an odds provider.

## Selection and presentation

- For each game, select the latest capture by capture time and then snapshot ID. Never search backward for a better, eligible or more favorable forecast. The first frozen baseline and scoring rules are unchanged.
- Use only eligible `nfl-elo-1` probabilities. A missing or unsupported model version or missing provenance produces an unavailable preference. Do not use the challenger as a fallback.
- Show both teams' complementary binary probabilities. The larger probability determines the preferred team; exactly 50/50 has no preferred side. NFL ties and sportsbook settlement rules are not modeled.
- Show the same selected team's qualified no-vig market probability only when the retained model/market chronology and multi-book provenance qualify, including oldest contributing quote time. Without that proof, keep the raw archived market probability explicitly unqualified and withhold model-minus-market comparison. A qualified comparison is labeled disagreement, never validated edge, EV or a wagering recommendation. No executable price or oldest contributing quote timestamp is fabricated.
- Include model version/build time, last model result date, capture time, source receipt time, newest market quote time, frozen kickoff and snapshot ID. Response generation is not a new capture. A public-journal response must carry matching latest-capture metadata and a SHA-256 digest; a failed refresh is visibly identified as retained evidence.
- Rank within each recorded date by saved outright probability only. Leave stale captures (over 24 hours), stale model builds (over 14 days) or result cutoffs (over 28 days), recorded results, passed frozen kickoff, known schedule conflicts and unavailable/50-50 probabilities unranked. All retained probabilities remain inspectable. These are presentation rules, not validated performance or execution gates.
- No spread-cover probability, total distribution, per-game uncertainty interval, confidence grade or positive stake is invented. Existing risk and automatic-paper-staging blocks stay intact.

## UI behavior

The independent asset loads one same-origin retained endpoint and exposes no refresh or betting control. Its inspection button uses the existing read-only dossier flow. Background aging updates text nodes without replacing focused buttons. Repeated loads ignore older successes and failures; a failed current read clears the panel rather than silently claiming current data. Invalid or future payloads fail closed.

## Offline verification

`npm test -- tests/retained-forecasts.test.mjs` covers original-versus-latest selection, unchanged journal inputs, actual bundled values, unsupported/missing Elo, fixed-primary behavior, two-team complements, date-local rankings, market distinction, 50/50, stale/model/kickoff/result/conflict states, malformed and future provenance, source digests, read-failure disclosure, escaping, repeated and interrupted loads, focus-safe aging and read-only HTTP behavior.

`python tests/retained-forecasts-browser.py [artifact-directory]` intercepts every browser request and serves only local assets and retained fixture responses. It covers desktop/mobile overflow, actual bundled forecasts, demo/non-NFL separation, repeated dossier opening/closing, keyboard focus across clock updates, stale transition and unavailable responses. No provider, public-journal or other external service is called. Fixtures are test-only, never journal publications.

Run `npm test` and `npm run check` against the completed local revision. Browser results and screenshots are kept separately from production files. Local validation does not establish deployment, live source freshness, independent model superiority or betting profitability.

## Integrated candidate verification, 2026-11-08

The display change `8bb5484` was integrated locally onto capture-boundary fix `b2f7ef2`. Two conflicts were resolved: the dossier timestamp whitelist retains both oldest and newest quote fields exactly once; the server keeps shared `currentEvidenceSnapshot()` routing rather than reverting to a separately bundled journal. `listRetainedForecasts` forwards the publication envelope without replacing the original scoring baseline.

Cross-endpoint regressions check one accepted digest/source across evidence, dossier index/detail, forecasts and cached health; latest-card values and both quote timestamps; rejected-refresh retention; missing-bundle recovery; clock rollback; an independently clocked feed; and the post-read response time. All data, workflow, authentication, budget, schedule and scoring gates remain unchanged.

Final integrated Node suite: **755 passed**, plus syntax and whitespace checks. Independent integration review passed **145 focused tests** and an extra pure end-to-end public-journal/UI probe, with no material integration blocker found. The local browser rerun could not start Chromium because the execution environment denied its process-singleton socket, including an escalated retry. No integrated browser page or visual check ran; earlier display-branch browser results are separate and are not claimed as an integrated pass. No publication or deployment occurred.
