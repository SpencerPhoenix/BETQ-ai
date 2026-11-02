# BETQ.ai — reliability audit and source review

**Audit date:** November 1, 2026, America/Chicago (November 2 UTC).  
**Baseline:** `0499176b30e4be703dc3073f616627610bb669dd`, application 0.4.0.  
**Candidate:** 0.4.1 reliability release.  
**Scope:** repository source, boundary conditions, prediction vintage, immutable evidence, cost guards, statistical uncertainty, desktop/mobile DOM behavior, and outside-source suitability.

## Executive finding

The baseline passed **59 existing tests**, but four independently constructed adversarial probes failed. Passing the original suite did not demonstrate adequate boundary protection. The corrective release has **81 passing tests**, including seeded randomized tests and request bursts. No new winning percentage, profitable edge, or stronger future performance has been established by this audit.

The biggest improvement is to the trustworthiness of what the terminal is allowed to display. Malformed data, invalid timestamps, stale underlying results, uncertain settlement rules, and prematurely scored evidence should produce an explicit refusal to issue a usable signal—not a crash, guessed probability, or stale WATCH label.

## Reproduced defects and corrections

| Finding | Why it matters | Candidate correction |
|---|---|---|
| A null bookmaker crashed the scanner | A single malformed provider record could take down a slate | Validate book, market and outcome structures; ignore malformed records safely |
| Invalid capture/kickoff dates entered the evidence journal | NaN date comparisons silently bypassed chronological checks | Validate timestamp syntax/order, unique IDs, probabilities and settlement consistency before append |
| Newly packaged models could use ten-month-old results | File build time was mistaken for current predictive information | Check the underlying game/result vintage and each team's efficiency history, not only package time |
| Invalid kickoff crashed the challenger API | A malformed event date could fail an entire request | Reject invalid/started events before date conversion or inference |
| Client WATCH labels did not automatically expire | On-demand refresh could leave a stale quote looking usable | Recheck freshness locally, suppress WATCH, zero theoretical size, disable paper action and display expired status without another paid request |
| Filter changes briefly retained the previous slate | A user could act on prices for the previous sport/market | Clear the slate during transitions; require current filter/source agreement before staging |
| Integer spreads/totals lacked a push model | Two-outcome arithmetic was presented despite unmodeled void/push probability | Explicit PASS with `PUSH_PROBABILITY_NOT_MODELED`; preserve settlement assumptions |
| Different fractional lines could merge after rounding | A different contract is not an interchangeable price | Preserve the exact line key; no rounding distinct contracts into one group |
| NaN budgets and multi-credit reserve handling were unsafe | Bad configuration/concurrency could bypass budget controls | Safe defaults, pending-credit reservations and score-endpoint cost checks |
| Oversize upstream responses were checked after allocation | A large response could consume memory before rejection | Read with a byte limit while streaming; cancel oversized or invalid UTF-8 bodies |
| A slow fetch could cross kickoff using an old clock | Freshness was evaluated before the network delay | Analyze with a post-fetch clock |
| Research branches could trigger writers targeting main | Experiments risked unintended model/data publication | Restrict scheduled artifact writers' push triggers to main |
| Rest days could change at UTC midnight | NFL game date is not always its UTC calendar date | Prefer verified schedule date, otherwise use the Eastern game date |
| Confidence relied on independent-game resampling | Repeated teams and related games undermine independence assumptions | Add paired calendar-week-block sensitivity; retain residual dependence and inspected-holdout caveats |

The initial four failures are preserved in the audit artifact. Corrections were tested on an isolated branch rather than edited directly into the live service.

## Verification performed

| Check | Result |
|---|---|
| Baseline unit/HTTP suite | 59 passed; four additional audit probes failed |
| Corrected suite | 81 passed, 0 failed locally |
| American odds/no-vig invariants | 50,000 deterministic randomized price pairs |
| Malformed event stress | 10,000 deterministic malformed-input cases |
| Same-market request coalescing | 1,000 concurrent requests; one mocked upstream call |
| HTTP burst | 500 local requests; controlled 200/429 responses, health/config remain usable |
| Cost/failure cases | Credit reserve, NaN configuration, concurrent reservations, payload size, invalid JSON/UTF-8 and time-order checks |
| Interface widths | 1440×1000, 768×1024, 412×915 |
| Interface interactions | 31 navigation/control checks per viewport; 93 total; no JavaScript errors or horizontal page overflow |
| Stale interface check | Advance fixture clock by 11 minutes: WATCH suppressed and paper buttons disabled |

**Browser qualification:** container browser network navigation was blocked. The tests mounted the exact HTML/CSS/JavaScript into Chromium and bound fetch to a local mocked HTTP handler. They test real rendering and client behavior, but they are **not a full production-browser or live-provider end-to-end certification**. Browser tests consumed zero paid Odds API calls. The 1,000-request and 500-request stress runs were against mocks/local infrastructure, never a load test against the public production site or sportsbook provider.

Passing a randomized test suite does not establish absence of all defects, production capacity, or a higher percentage of winning wagers.

## Statistical audit: what changes and what does not

The prior comparison—2025 Elo Brier 0.22235 versus EPA challenger 0.21935—is a previously inspected historical result. It must not be presented as a new untouched test every time the code changes. Proper scoring, winner accuracy, calibration reliability and realized betting returns are different quantities. Scikit-learn explicitly explains that Brier/log loss jointly reflect calibration, discrimination and outcome uncertainty; lower Brier alone does not prove better calibration [3].

This release adds a deterministic **paired week-block bootstrap sensitivity check**. Each resample preserves model/baseline pairs and groups related observations from the same calendar week. It needs at least 30 games and eight weekly groups before reporting an interval. The historical promotion check now additionally requires a positive lower week-block bound. This is inspired by dependence-aware resampling, not a claim to have eliminated dependence: recurring teams and relationships across weeks remain. The `arch` project documents several time-series block-bootstrap approaches and is a good future validation reference [4].

Actual production selection remains separate from the research challenger. Genuine fresh evidence comes from forecasts locked before outcomes, not repeated tuning to the 2025 reference season. A later negative interval or failed gate must be retained as evidence rather than hidden or tuned away.

## External project and source review

This was a **targeted primary-documentation and repository review**, not a full security audit or reproduction of every outside project's performance claims. None of the projects below has been blindly copied into production. No new external runtime dependency was added by this reliability release.

| Project/source | What is worthwhile | Decision for BETQ.ai |
|---|---|---|
| **nflverse/nflreadpy** [1] | Maintained Python loader; Polars, caching and documented data provenance | Best candidate for the research ingestion job. Keep the Node API lightweight. Validate source schema/vintage regardless of loader |
| **nflverse/nflfastR and nflreadr schedules** [2] | NFL EPA/PBP infrastructure, corrected data and explicit refresh schedules | Retain as the core research source; freeze data vintages because later corrections can alter a backtest |
| **scikit-learn** [3] | Calibration curves, proper scoring, temporal validation and separated calibration data | Use its methodology as an independent research benchmark; do not substitute shuffled cross-validation for chronological tests |
| **bashtage/arch** [4] | Dependence-aware bootstrap and uncertainty tools | Adopt the principle now via a small original week-grouped sensitivity implementation; review more complete dependence treatment later |
| **dubzzz/fast-check** [5] | Property-based generation and reproducible/shrinkable counterexamples | Adopt generative testing methodology now. This release uses seeded dependency-free tests; consider the library as a pinned development dependency later |
| **martineastwood/penaltyblog** [6] | Multiple vig-removal methods and typed implied-probability outputs | Use as a numerical benchmark/test oracle, not a drop-in NFL predictor. Do not assume Shin/power always beats normalized odds |
| **greerreNFL/nfelo** [7] | NFL Elo design and market-comparison research | Benchmark the approach against the current baseline. Do not copy source without confirming reuse rights and reproducing time-aligned evaluation |
| **greerreNFL/nfeloqb** [8] | Quarterback value estimation and opponent/context adjustments | Candidate research feature, not a confirmed-starter feed. Require source/vintage/rights checks and separate historical ablation |
| **MLflow / Evidently** [9,10] | Experiment lineage, model versions and later drift monitoring | Valuable when the number of experiments grows. Existing versioned artifacts remain simpler at current scale |
| **Open-Meteo Single Runs** [11] | Forecasts tied to their issue/run time | Candidate weather source. Train on forecasts that existed before kickoff, not future realized weather; account for roof/venue and usage terms |

Additional repositories reviewed as comparisons include **VascoEsquivel/nfl-power-ratings-backtest**, **JMutammara/NFL**, **kyleskom/NBA-Machine-Learning-Sports-Betting**, **sportsdataverse/hoopR**, and **jldbc/pybaseball** [12–16]. These offer evaluation patterns or sport-specific ingestion ideas, not an established reason to transplant their models into BETQ. Author-reported results were not independently reproduced. NBA/MLB expansion is deferred until the NFL evaluation process is credible.

### Recommended model adjustment—not yet represented as deployed

Evaluate a **third explicitly market-informed candidate** alongside market-only consensus and the independent Elo/EPA model. Learn any blending weight using strictly earlier data, then freeze it for a later test window. A market-aware blend must never be labeled “independent of bookmaker prices.” Compare reliability bins, Brier/log loss, odds availability and realistic settlement separately; a high favorite hit rate is not proof of profitable prices.

For quarterbacks, separate two tasks: identifying who will actually start from a reliable timestamped team/league source, and estimating that player's impact from historical data. A depth-chart listing or absence from an injury CSV cannot solve the first task by inference. SportsDataIO documents relevant NFL endpoints, but a paid/license-controlled source is not silently enabled [17].

## Cost, licensing and remaining limitations

The API key stays on the server. No new subscription, paid historical-odds backfill, or real-money order has been created. Public-source research/training and isolated tests must not be confused with free access to licensed production feeds. Software licensing and permission to redistribute underlying sports data are separate questions. nflreadpy documents MIT software licensing and distinct data licenses; preserve attribution and check each dataset [1].

The current provider budget is **in memory** and resets on a service restart. Strengthening guards does not turn it into a durable billing ledger. Authentication and persistent quota accounting remain necessary before a broad public launch. True bookmaker closing-line value and executable ROI still need licensed, timestamped private price storage, result verification and realistic acceptance/settlement rules. The current evidence journal does not establish them.

Source-freshness thresholds (28 days for underlying team/results checks, seven days for the feature artifact, and existing quote limits) are conservative operational gates, not scientifically estimated performance guarantees. A new season may be unavailable until sufficiently recent completed data exists. Neutral-site adjustments, player confirmation and weather effects remain separate outstanding features.

## Primary references

1. nflreadpy official docs and linked repository: https://nflreadpy.nflverse.com/
2. nflverse update/availability schedule: https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html ; nflfastR models: https://www.nflfastr.com/articles/expected_points.html
3. scikit-learn calibration: https://scikit-learn.org/stable/modules/calibration.html ; chronological splits: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
4. arch time-series bootstrap: https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html
5. fast-check: https://fast-check.dev/ ; https://github.com/dubzzz/fast-check
6. penaltyblog implied probabilities: https://penaltyblog.readthedocs.io/en/latest/implied/implied.html ; https://github.com/martineastwood/penaltyblog
7. nfelo: https://github.com/greerreNFL/nfelo
8. nfeloqb: https://github.com/greerreNFL/nfeloqb
9. MLflow: https://github.com/mlflow/mlflow
10. Evidently: https://github.com/evidentlyai/evidently
11. Open-Meteo exact forecast runs: https://open-meteo.com/en/docs/single-runs-api
12. https://github.com/VascoEsquivel/nfl-power-ratings-backtest
13. https://github.com/JMutammara/NFL
14. https://github.com/kyleskom/NBA-Machine-Learning-Sports-Betting
15. https://github.com/sportsdataverse/hoopR
16. https://github.com/jldbc/pybaseball
17. SportsDataIO NFL documentation: https://sportsdata.io/developers/api-documentation/nfl
18. The Odds API V4 documentation: https://the-odds-api.com/liveapi/guides/v4/

External source availability, schemas and licensing can change. The linked primary documentation was reviewed during this audit; no blanket accuracy or profitability claims from external projects have been adopted.
