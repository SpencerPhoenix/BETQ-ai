# Full build audit — November 16, 2026

Scope: source inspection at main `41ddfa5268b7f6bd1502066d775017652cb117ce`, retained artifacts, offline unit/integration tests. This is not a certificate that no weaknesses remain. No paid provider calls, model retraining, changed forecasts, wager execution, or performance claims. Live production status is a separate release check.

## Immediate findings and remedies

| Severity | Evidence | Remedy / state |
|---|---|---|
| High | `src/injuries.mjs` capped flagged players at 8; counts could exceed visible/API players. Upstream labels can disagree with official club reports despite a recent source-file timestamp. | Separate injury repair removes cap and reports completeness. Need official final-status source/reconciliation before treating availability as current. |
| High | Primary `nfl-elo.mjs` uses only outcome ratings and home advantage. Injury, starter and weather flags are explicitly false. | Do not sell the output as a fully contextualized quant pick. Develop point-in-time features and test them prospectively; no invented numeric injury impact. |
| High | `public/retained-forecasts.js` shows primary Elo but not the stored challenger on the main card. NYG–PHI latest pregame: PHI Elo .539633, challenger .485848. | Show separately labeled model disagreement, both sides, vintage and limitations. Do not retroactively select the winning model or change earliest frozen grading. |
| High | Main Elo built Nov13 through Nov12; efficiency built Nov10 with latest features through Nov9. Availability thresholds permit 14-day Elo builds, 28-day result dates, 7-day challenger builds. Recent build does not establish all recent games ingested. | Add expected-completed-game coverage reconciliation and per-team cutoff diagnostics; deployment/current-artifact match alone is insufficient. Tightening a TTL alone cannot detect missing games. |
| High | Training scripts classify any nonempty bounded scores on dates through today as completed. Schedule CSV does not supply an independently checked final-status receipt here. | Prevent same-day/in-progress partial-score training and require explicit finality/settlement policy. Current delivery identity rejects a same-day cutoff until the day ends, but training can already have used partial scores and manual runs can cause temporary unavailability. Do not label this independently verified training finality. |
| High | Paid/current odds require durable budget and operator prerequisites. Cache-only reads cannot produce fresh quotes. | Configure only with authorized cost/usage scope. Do not disable safeguards to make a live button look operational. |
| Medium | `challengerResearchForEvent` checked dates against current clock but not artifact build or predicted game date, and counts could be malformed. | Fixed locally: feature day must fully precede build and precede game day; counts must be integer 4–8. Regression covers post-build/same-game/malformed cases. |
| Medium | Predictor treats missing `neutralSite` as normal home advantage. Odds provider event shape does not establish venue status. | Add an identity-matched, timestamped schedule/venue adapter. At minimum disclose home-venue assumption; do not silently claim verified neutral-site handling. Explicit boolean neutral metadata is handled correctly. |
| Medium | `render.yaml` uses `npm install` although CI uses locked `npm ci`. | Fixed manifest to `npm ci --ignore-scripts --no-audit --no-fund`. Existing Render service settings may override manifest and must be checked separately. |
| Medium | Historical `market-production-audit.yml` and `production-audit.yml` assert obsolete v0.7/v0.4 runtimes. | Replace or archive obsolete probes; use exact commit plus compatible protocol health checks. Do not interpret obsolete probe failure as current app failure. |
| Medium | Outcome ledger has 347 snapshots, 44 raw games, 8 quarantined games. Filtered summary has 36 games, no aggregate-qualified V2 outcomes, plus a separately reviewed descriptive game. | Continue final-status receipt ingestion/review and schedule resolution. Raw record count is not independent scored sample size. No aggregate market advantage established. |
| Medium | Demo, several sports, spread/total displays exist, but independent live model only supports NFL outright; tie/push distribution not modeled. | Make coverage explicit. Do not apply winner probability to spread, total, halftime or another sport. |

## Underdog handling

The primary preference is symmetric: home if p > .5, away if p < .5. There is no favorite-only override. Historical underdog concentration is a warning about selection/calibration, not suppression of underdog forecasts. A lower win probability may still be a better price, but current model-market disagreement is not established expected profit. Keep winner preference, price comparison, uncertainty and data qualification separate.

Across 36 latest non-quarantined retained games, 15 contain a challenger probability; one has opposite preferred sides: NYG–PHI. This count is a coverage/presentation diagnostic, not evidence the challenger is superior. The earliest PHI .572526 prediction remains the primary frozen descriptive grade, with subsequent snapshots evaluated only under a predeclared separate policy.

## Validation priority

1. Repair source completeness and expose disagreements/coverage honestly.
2. Reconcile current source/artifact/deployment and per-team completed-game coverage.
3. Independently qualify final results; preserve original forecasts and revisions.
4. Freeze a prospective comparison protocol before adding features: all eligible games, favorite/underdog strata, probability bins, Brier/log loss/calibration, market-relative scores, uncertainty intervals and week/team dependence.
5. Promote only on out-of-sample incremental evidence, not a single upset or optimized historical selection. Thirty games is a reporting gate, not proof of reliable market outperformance.

No model weights, historical journal rows, scoring cohort rules or numeric predictions were changed by this audit.
