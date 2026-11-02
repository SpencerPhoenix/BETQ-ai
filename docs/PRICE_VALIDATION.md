# BETQ.ai — ROI & Closing Line Value Verification Contract (v0.5)

## Why two metrics are separate

**Stake-based ROI** measures the net dollar return divided by total capital risked in graded WIN, LOSS and PUSH tickets. VOID/CANCELED orders and OPEN tickets are excluded. Stakes returned after a PUSH remain included in the denominator. This differs from **bankroll growth**, which divides net profit by the starting bankroll (and must account for deposits/withdrawals in a real account).

**Closing Line Value (CLV)** is a *same-contract* entry versus closing price comparison. Direct subtraction of American odds is not a percentage. Always convert odds into decimal before calculating CLV.

### Correct ROI

For a winning ticket with decimal odds d, net profit = stake × (d − 1).
For a losing ticket, net profit = −stake. PUSH returns stake (zero profit); VOID returns stake (excluded from graded ROI).

Stake-based ROI = 100 × sum(net profits on graded tickets) / sum(stakes risked on graded tickets).

### Raw price movement

Convert American to decimal: +A → 1 + A/100; −A → 1 + 100/abs(A).

Raw closing price improvement percent = 100 × (entryDecimal / closingDecimal − 1).

Example: entry −110 = 1.909091; close −125 = 1.8; price improvement = **+6.0606%**. This is a hypothetical **price-movement comparison**, not automatically independently verified CLV.

The alternative raw implied-probability movement is **100 × (1/closingDecimal − 1/entryDecimal)** in percentage points. It is deliberately labeled in *pp*, not percent ROI.

### Closing margin removal

Given a complete matching two-way closing market, calculate close-side implied probability p1 = 1/d1 and opposite-side p2 = 1/d2. Use proportional no-vig pFair = p1/(p1+p2).

No-vig closing price benchmark percent = **100 × (entryDecimal × pFair − 1)**.

This is conditional on the *closing reference market* being fully represented and its prices current. It is not an independently calibrated true probability, guarantee, or realized return. Different margin-removal methods can produce different estimates.

### Required identity and chronology

Source records must have matching: sport, provider game ID, market, selection ID, game period, and (for spread/total) exact handicap/total **line**. A price on −2.5 cannot be compared with −3.5 for a price-only CLV measure. Rules for pushes, overtime, canceled games and venue apply. Parlays, Asian handicap splits and cashouts require separate accounting models.

Reject post-kickoff entry or close, a close earlier than the entry, mismatched kickoff timestamps, incomplete sources or different contracts. A quote more than ten minutes from kickoff is an early/near-close proxy—not a certified final price. Even a near-close quote from a named data source is labeled **source-attested price proxy** until an externally certified closing-price pipeline exists.

The current live Odds API snapshot and the journal of *derived probability estimates* do NOT contain verified filled wagers or actual matched closing lines. They therefore cannot establish historical ROI or verified CLV.

## Implemented endpoints / UI

- Read-only illustrative pricing calculator: GET /api/price/illustration?entry=-110&close=-125&closingOpposite=%2B115&stake=110&result=WIN
- Source verification state: GET /api/price/verification
- ROI & CLV Lab includes the hypothetical calculator, independent source-coverage disclosure, and a separately labeled **manual paper ROI** computed only from locally manually graded positions.
- The public service is not a sportsbook and never executes bets.

The calculator makes **no requests to the paid sportsbook provider**, transmits no credentials and never saves the illustrative price pair. API inputs are validated, bounded and rate-limited by the existing read-only server.

## Historical season reporting—future data prerequisites

For every NFL season (or other sport), preserve immutable rows containing: actual accepted entry price, wager amount, result, settlement and settlement rules, bookmaker identifier, entry time, game start, identical closing contract/line, closing source/time and opposite-side closing odds. Retain source versions and field-level verification status. Do not invent missing historical prices from win percentages or backtest forecasts.

Only after collecting eligible records should season-level verified ROI and CLV be computed with coverage counts, variance, confidence intervals, bootstrap dependence controls, and exclusions. Publish **null/unavailable** whenever verification is missing.

Results should show: gross/net profit, total stake risked, stake ROI, initial bankroll return (separate), win/loss/push/void counts, mean/median price improvement, no-vig closing benchmark, and % of entries beating the matched close. Segment by sport, season and market. Never use a single arbitrary provider's final midgame tick as the closing line.

## Reliability expectations

- Tests must include +100/−100, favorite/underdog, 0/negative stakes, fractional cents, pushes, voids, duplicate tickets, unmatched line/period/selection, stale and post-kickoff quotes.
- Stress randomized odds and stake arithmetic for signed CLV and bounded cash returns.
- Preserve strict declaration that verified real-money ROI and CLV remain **unavailable**.
- Deployment must serve a version-matched UI and backend, with no implicit paid odds calls from this analysis.
