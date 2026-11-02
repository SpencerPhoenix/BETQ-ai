# BETQ.ai v0.9 — NFL QB Information-Latency Shadow Research, Phase One

**Status: the source validation, read-only study API, synthetic demonstration, public-safe derived forward-market monitor, and optional private PostgreSQL adapter are built and tested.** At this release, **live bookmaker-level QB latency collection is NOT enabled**: BETQ lacks its own dedicated durable private database and a verified automatic official-QB-source collector. Do not claim otherwise.

## What works now

1. **Real derived forward market monitoring** using the *existing* prospectively collected, public-safe NFL evidence journal at `data/evidence/nfl-2026.json`. The read-only fixed URL uses the existing GitHub journal and does **not** call The Odds API. It shows counts of real market-probability snapshots and differences between source-observed snapshots separated by at least 10 minutes. It intentionally has no bookmaker identities, raw odds, or QB attribution.
2. **Synthetic QB repricing simulation** (read-only `GET /api/shadow/demo`): fictional official-looking event, human review two minutes later, four fictional bookmaker quote timelines and two matched control games. Explicitly marked fictional; no actual player, odds, CLV, ROI, or measured effect is claimed.
3. **Prospective validator**: `normalizeOwnedOddsSnapshot()` ingests only an actual `getOdds()` provider response, controls cache handling, allowed leagues/contracts, signed American odds, bookmaker identity deduplication, opening/kickoff chronology, odds freshness and source received timestamps. The provider's market `last_update` is **NOT** BETQ's observation or proof of bookmaker movement/availability.
4. **Official QB source candidate/review workflow**: `makeQBCandidateNews()` accepts only a supported official NFL HTTPS domain, valid kickoff and QB status, and assigns collector first-seen time from the executing process. It starts as `AWAITING_INDEPENDENT_SOURCE_REVIEW`. Privileged human source review produces a separate append-only review; it does not certify a starter's availability or causality.
5. **Source- and time-matched QB event study**: `evaluateQBLatency()` compares same-book, same-game full-game moneyline probability observations before and after *the later of first observation and human source review*, with other-game comparison periods. No public sportsbook request, no causal claim, and no reportable actual effect below ten qualified events.
6. **Private PostgreSQL adapter**: `src/shadow-store.mjs` and `sql/shadow-private.sql` implement source-idempotent, parameterized, transactional, append-only quote/news/review inserts. Database creation and schema initialization are **never automatic from an HTTP request**. Raw odds are private only.
7. **Read-only dashboard**: QB Latency Lab has actual collection readiness, genuine forward-derived market movements, and a clearly separate fictional demonstration. All real CLV/ROI and betting controls remain disabled.

## Critical finding fixed: evidence collector version gate

The scheduled `capture-evidence.yml` still rejected every non-`0.4.x` backend release, even though BETQ was already v0.8. This could silently stop forward collection. The new preflight `scripts/verify-evidence-health.mjs` checks required health fields (BETQ identity, configured source, available NFL model and forward evidence contract) rather than a specific minor version. It uses only a free `/api/health` call. **The existing scheduled collector still may consume its usual quota-limited sportsbook request** when eligible; its schedule, `ODDS_DAILY_CREDIT_LIMIT=12`, and `ODDS_MIN_CREDITS_RESERVE=50` were not changed. Updating the workflow itself no longer triggers a one-off additional collection.

## API contract

| Endpoint | Input | Returns | Paid odds request |
|---|---|---|---|
| `GET /api/shadow/status` | none | Private archive status with sanitized counts, capture defaults OFF | No |
| `GET /api/shadow/study` | none | If source review/control sample is insufficient, clear unavailable; otherwise aggregate only | No |
| `GET /api/shadow/demo` | none | Immutable fictional source/QB movement demonstration | No |
| `GET /api/shadow/derived` | none | Real forward-derived market-probability movement from fixed GitHub evidence URL | No |
| Existing `GET /api/slate` | supported parameters | Normal market analysis plus optional `shadowCapture` result | Same original provider request only |

All write endpoints are absent. POST to any public shadow route is disallowed. Neither raw bookmaker quotes nor publisher URLs are served from the private store.

## Point-in-time rules

A quote has at least three distinct concepts:

- `sourceMarketUpdatedAt`: provider-reported market `last_update`. The Odds API documentation states this is the time **the provider last saw odds for that bookmaker market**; it is not necessarily the moment the bookmaker changed price.
- `firstObservedAt`: timestamp assigned by BETQ's trusted odds-response receiver. Cached responses are **never** replayed as new first-seen observations.
- `kickoffAt`: scheduled event start. A quote captured after or within five minutes of kickoff is excluded for phase one.

An official news event similarly has a claimed `sourcePublishedAt` and a BETQ-owned `firstObservedAt`. Only a separately reviewed official candidate can enter the event study, and its effective start time is the later of first observation and human review. This deliberately sacrifices timeliness to avoid looking into the future.

No aggregation may label these data as an accepted sportsbook offer, a tradable price, genuine CLV, or confirmed profitable model edge. Comparison games without a *recorded* QB announcement are not guaranteed news-free and cannot establish causation.

## No-cost activation and its limits

Opening the QB Latency Lab issues only the four read-only, public-safe internal GETs above. The derived feed reads BETQ's existing public derived evidence and caches it; it never starts a new sportsbook poll.

**The actual private raw quote collector defaults off**. It requires **all** of:

- `BETQ_SHADOW_CAPTURE_ENABLED=true` (explicit feature opt-in).
- `BETQ_SHADOW_LICENSE_REVIEWED=true` (provider retention/usage review).
- `BETQ_SHADOW_DATABASE_URL` connecting to a **dedicated** PostgreSQL database named `betq_...` (for example, `betq_shadow_research`).

The process refuses URLs pointing to another project's database, including the existing `trading_agent_history_dev` PostgreSQL database. That unrelated free Render database is short-lived (expires November 27, 2026); do not repurpose it for BETQ. Free Render Postgres expires after 30 days and provides no backups: https://render.com/docs/free .

A dedicated persistent database may require a paid service. **No dedicated database was created or billed for this phase.** No new Render environment variables were set to enable raw capture.

The optional `pg` package (MIT license) is pinned to a specific version. The private schema maintenance tool is available as `npm run shadow:private -- init`, but must be run only by a trusted operator in an environment with the private URL and approved source rights. Optional `ingest <private-source.json>` timestamps first seen at execution time and `review <record-hash> <source-evidence-file>` requires a human reviewer and a source evidence digest. Neither is accessible over the web.

Once explicitly enabled, **only the existing uncached live NFL h2h odds response** may be captured; the implementation makes no second paid provider request and no automatic polling. Source news ingestion and review remain private human workflows pending a verified licensed news-feed collector.

## Known limitations and acceptance gates

- The real derived feed cannot determine bookmaker lead-lag, identify QB-caused movement or produce true CLV. It is a helpful forward observation baseline, not the completed target study.
- The human review pipeline does not independently fetch/source-check articles; it requires a qualified operator to inspect the material. Team-specific official domains beyond `nfl.com` are not yet allowlisted.
- Postgres captures immutable source observations but is not cryptographically tamperproof against database administrators. Production archival requires backups, retention controls, private network access and an independent integrity audit.
- A meaningful causal QB news latency experiment requires an independently collected official first-seen source, matched no-news controls and enough future events (at least ten in this UI; likely far more for reliable inference).
- The public user interface never enables real bet execution, paper automation, real-money ROI or verified CLV. The central risk authority remains the final veto.
- No unapproved increase to `ODDS_DAILY_CREDIT_LIMIT`, new historical odds purchases, private DB plan, or automatic source polling is part of v0.9.

## Data sources / terms

- Official NFL reporting policy for 2026: https://amp.nfl.com/news/2026-27-national-football-league-important-dates
- The Odds API v4 documentation and market `last_update` semantics: https://the-odds-api.com/liveapi/guides/v4/
- Provider historical odds feature (paid; NOT used here): https://the-odds-api.com/historical-odds-data/
- Render free datastore limits: https://render.com/docs/free
- Source and requirements basis: [Point-in-time design](POINT_IN_TIME_SHADOW_ARCHITECTURE.md)

## Acceptance evidence

`npm run check` and `npm test` cover: cache/first-seen controls, quote identity and timestamps, impossible markets, official source news review, synthetic matched control study, database idempotency, 10,000 randomized malformed records, HTTP read-only/no-cost routes, source-derived market movement, responsive labeling, and fixed scheduled evidence compatibility. Source and integration audit runs are reported in GitHub Actions.

**Bottom line:** v0.9 ships a source-safe, testable prospective research infrastructure and real derived market observations. A complete *live* bookmaker-level QB news latency study is not collecting until separate private persistence and a vetted news source are approved and connected.
