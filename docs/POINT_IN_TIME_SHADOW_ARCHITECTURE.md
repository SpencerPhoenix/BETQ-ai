# BETQ.ai — Point-in-Time Shadow Intelligence: Private Data Contract

**Status: design specification, NOT an active collector.** No historical odds calls, additional API credits, paid services, private databases, or automatic wagering have been enabled by this document.

## Why now

Independent review identified timing, price availability and verified news timestamps as BETQ's most important unresolved capability. The new 14,000-world power study found the current evidence gate detected only 12.40% of the injected stronger/high-observation-quality signals; the margin experiment did not reliably beat the closing spread. This strengthens the case for **prospective timestamped observations**, not repeated tuning on familiar seasons.

## Critical storage and license boundary

The BETQ GitHub repository **SpencerPhoenix/BETQ-ai is PUBLIC**. Do not save raw individual bookmaker odds, private keys, transaction details or full vendor payloads to this repository or its public GitHub Actions artifacts. Current evidence files intentionally contain derived probability estimates, not raw bookmaker feeds.

The Odds API v4 documentation (https://the-odds-api.com/historical-odds-data/) describes paid historical snapshots from June 2020, five-minute intervals from September 2022 and a quoted cost of **10 credits per region per featured market per historical request**. The provider's August 2026 terms (https://the-odds-api.com/terms-and-conditions.html) permit data retention and analytics, but prohibit repackaging or redistributing raw odds as a standalone data service. Consult current plan, limits and terms before procurement or public release.

No bookmaker snapshots should be persisted to public repo without a separate explicit rights assessment and source-safe aggregation policy.

## Proposed minimal private ingestion envelope (future implementation)

Every source observation must carry:

- `recordId`: unique, deterministic/idempotent ID, derived from the source quote identity, version and observation sequence.
- `sourceProvider`, `sourceEventId`, `sport`, `league`, `sourceBookmakerKey`, `marketKey`.
- `marketPeriod`, `selectionId`, `exactHandicapLine` (null for moneyline), `americanOdds` and normalized decimal price.
- `bookmakerQuoteUpdatedAt`: vendor-reported time the individual market was last updated (NOT proof that a user could have bet then).
- `providerSnapshotAt`: upstream snapshot timestamp, if separately supplied.
- `collectorFirstReceivedAt`: timestamp BETQ first observed this exact quote in its own ingestion service.
- `collectorLastReceivedAt`: most recent matching observation; never backdate it to provider's last-update time.
- `eventCommenceAt`: independently verified scheduled kickoff with revision history (rescheduling changes eligibility).
- `collectingInstanceId`, `sourcePayloadDigest` and `ingestionSchemaVersion`.
- `bookmakerMarketState`: available / suspended / unknown, only if explicitly verified by provider; default unknown.
- `executability`: always `NOT_ATTESTED` until an authorized *actual accepted-fill record* exists.
- `sourceVintage`: unique provider-release version and quote-level timestamp provenance.

Never substitute the postgame closing price for an earlier entry. Quotes are source-observed—not guaranteed bettable, particularly when suspensions, stale caching, limit changes and account restrictions occur.

## Separate verified information-event envelope

For a confirmed quarterback change, injury, weather forecast or team announcement:

- `firstSeenByBETQAt` (collector observation), `sourcePublishedAt` if publisher explicitly supplies one, `sourceURL`, author/issuer, revision history and independent corroboration.
- Do not synthesize `sourcePublishedAt` from article scrape time or from the first sportsbook movement.
- Store uncertainty/unknowns as unknown; avoid a fabricated single “earliest publication time” when sources conflict.
- Join to market data only when observed time strictly precedes the tested quote timestamp and kickoff. Otherwise exclude as not proven knowable.
- Price movement after the event is an association, not causal proof; require matched no-news controls and placebo timestamps.

## Sampling and budget policy

The existing live Odds API budget is deliberately conservative. **Do not increase sampling cadence or query historical snapshots as part of app activation.** No new paid requests can be triggered by dashboard page loads or by agent collaboration.

Proposed safe sequence before requesting any paid access:

1. Confirm plan entitlement, exact quotas, retention rights and permitted commercial presentation.
2. Select one market (NFL h2h) and one event type (verified QB starter changes) for prospective research, not broad multisport scanning.
3. Establish an access-controlled private durable database, encrypted at rest, with restrictive read/write credentials and clear retention policy. Render's ephemeral filesystem and a public GitHub repository are not substitute archives.
4. Implement a signed server-side ingestion path with idempotent updates, atomic append-only versions and no client-provided source-attestation flags.
5. Validate schema in a local mock-only fixture suite, including 10,000 mixed timestamps, duplicate quote IDs, timezone, source revision, bookmaker identity, exact market line and kickoff-rescheduling cases.
6. Only then use a user-approved, explicit daily quota to collect a fixed, source-verified sample. Do not spend quota on mass backfills or full-slate automatic polling without user approval.

## Prospective research evaluation

- Pre-register the decision time (e.g., when BETQ first observes a verified QB change), source and market reference. The model must be frozen before future price movement.
- Track refusal and missing-data rates; avoid claiming an edge on the subset with available snapshots if omitted games bias the test.
- Measure `logit(p_later) - logit(p_entry)` from matching contracts and validated source times; report intervals by league week. Price movement is not settled trading profit.
- Investigate book-specific copying, market suspensions, and selected-side preference; include a placebo signal and no-news control.
- For a genuine bet/CLV/ROI claim, require an independent authentic transaction receipt, actually filled price, stake and settlement; source-observed quotes alone do not qualify.

## Safety and status

**Current:** Design only. No collector is running. No odds data was purchased or moved to private storage. The public backend remains read-only and the central betting-authority gate remains locked.

**Exit gate for building collection:** User approval of provider cost/quotas, choice of private retention destination, and a reviewed source-license-compatible storage plan.
