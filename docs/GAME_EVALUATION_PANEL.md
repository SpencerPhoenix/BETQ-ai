# Per-game evaluation panel

The Game Monitor's existing **Compare game strategies** disclosure now includes a read-only evaluation at the browser's current check time. Opening it does not make provider requests, recompute a model, change frozen records, promote a model or place bets.

For a compatible live pregame moneyline snapshot it displays:

- Three-book-or-better no-vig market-implied probability, explicitly distinguished from an independent win forecast, with oldest quote time.
- Independently sourced Elo research probability and artifact build/version, when supplied by the guarded server.
- Each quoted side's conditional break-even and independent research probability minus break-even. This gap is unvalidated arithmetic, never a verified edge.
- Available team injury report coverage and source-file update time. Missing team reports stay explicitly missing; public reports do not establish starters or probability adjustments.

All current claims fail closed for archived/demo sources, other markets, expired provider receipts, started/imminent games or schedule conflicts. Consensus provenance, quote chronology, probability pairs, book counts and injury expiry are validated independently. A stale individual quote cannot inherit a research price comparison from fresh game metadata. The existing timer rechecks while preserving native disclosure/focus behavior. All decisions remain PASS with no recommended stake.

Verification: 17 focused strategy tests and 982 full-suite tests pass; `npm run check` passes. Browser QA was attempted but Chromium could not launch because this executor prohibits its process-singleton socket. Desktop/mobile visual verification remains outstanding. No production deployment performed by this change.
