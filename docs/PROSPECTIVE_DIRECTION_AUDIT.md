# BETQ.ai v0.10 — Prospective Model Disagreement versus Later Market Movement

**Research status: collecting. NOT a validated predictive advantage or profitable betting strategy.**

## The problem this test addresses

BETQ's 2022–2025 replay lost hypothetical closing-price stakes even while predicting selected sides to win much more often than they did. We found that extreme Elo disagreements frequently selected errors. A meaningful next question is whether an **earlier, genuinely recorded** Elo forecast ever anticipates the **direction of a later independently observed market consensus**, using no future game outcomes.

## Fixed directional audit rules

The implementation in `src/prospective-direction.mjs` takes an append-only *existing* forward forecast journal, not a reconstructed closing price:

- NFL full-game moneyline only; first recorded pre-kickoff Elo plus derived no-vig 3+ book market consensus.
- Model build timestamp and source-received timestamp must precede the forecast capture. The same model version, model build time, provider event ID, teams, and kickoff are required in the later snapshot.
- A later source-observed, newly updated consensus must occur **at least 15 minutes** after the first snapshot and before kickoff.
- Study a game only when the original Elo–market home-probability disagreement is at least **3 percentage points**.
- Score a direction only when the subsequent observed derived market probability moves by at least **0.5 percentage points**.
- Count each game once, with no selection of the best subsequence or most favorable time.
- Withhold even the descriptive direction hit rate until at least **30 distinct qualifying games** exist. Even after 30, this does NOT prove superiority, significance, CLV, causation or profit.
- Never include bookmaker-identifiable raw prices, real betting transactions or private article URLs in public evidence.

These thresholds are fixed for this version. Future threshold changes must be labeled as separate exploratory protocols rather than optimizing v0.10 after seeing outcomes.

## First actual forward-data audit

Based on the public GitHub `data/evidence/nfl-2026.json` snapshot as of November 2, 2026:

| Audit evidence | Recorded |
| --- | ---: |
| Pregame snapshots | 33 |
| Games with snapshots | 17 |
| Source-timestamp-passing paired games | 9 |
| Qualified prior-model disagreements and later material market shifts | 3 |
| Later movement aligned with early model disagreement | 1 |
| Later movement opposed early model disagreement | 2 |
| Reportable direction rate | **Withheld, fewer than 30 qualifying games** |
| Verified genuine CLV | **Unavailable** |
| Verified realized profitability | **Unavailable** |

**The 1-of-3 count is not evidence of an edge** or even a meaningful estimate of forecasting accuracy. It simply demonstrates that the prospective data pipeline can distinguish early observations from later ones and that most existing observations do not qualify under the strict rule.

Automated audit: `.github/workflows/prospective-direction-audit.yml`. It automatically reruns whenever the public derived evidence journal is updated. Reproduce with `npm run audit:direction`. The GitHub Actions audit artifact is derived source-safe research (no private sportsbook quotes).

## Operational boundaries

- `src/shadow-derived.mjs` already accesses the fixed GitHub public derived journal. v0.10 reuses this same cached read to compute `prospectiveModelLeadDiagnostic`; there is **no new paid API call** and no historic provider backfill.
- The QB Latency Lab shows the evidence counts and will display a descriptive rate only when the 30-game sample condition is met.
- Model-leading-market cannot establish that an earlier odds quote was accepted by a book. Market consensuses are not independent sportsbooks, and there is no verified fill, quoted limit, slippage, settlement, genuine CLV or realized ROI.
- No private sportsbook data are written to the public GitHub repository.
- The independent model remains unpromoted; the central server-side wagering risk veto and automatically sized paper-staking lock remain active.

## Measurable requirements to advance

1. Accumulate source-frozen forward snapshots through the current quota-limited evidence collector, without increasing the paid Odds API budget.
2. Obtain a dedicated, permission-controlled, **durable private database** before considering raw bookmaker odds archival. Do not reuse the temporary trading-agent database for BETQ research.
3. Validate per-book historical-vintage quotes and the actual ability to place bets at the observed decision time. A feed quote is not a fill.
4. Specify one narrow event class (source-verified QB changes) with event-publication/first-seen times, prospective matching price snapshots and no-news controls.
5. Report matched-time proper scoring gains and week-block uncertainty, real price availability, CLV from actual matched contract/entry quotes, and independently validated settlements. Do not promote a strategy until those are demonstrated on genuinely new data.

## Source and reproducibility

- Public source frame: BETQ's prospectively written `data/evidence/nfl-2026.json` (contains only derived market probabilities, not raw book prices).
- Results audit: see GitHub Actions `BETQ prospective model versus market movement audit`.
- Historical research and model limitations: [Power and margin findings](POWER_MARGIN_FINDINGS.md) and [private as-of data architecture](POINT_IN_TIME_SHADOW_ARCHITECTURE.md).