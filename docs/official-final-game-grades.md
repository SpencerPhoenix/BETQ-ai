# Official final-score game grades

The Games & results view now matches free official NFL final-score observations to each unchanged first frozen pregame forecast. It does not require manual BDL review for every descriptive grade and never inserts these observations into the retained settlement journal or qualified aggregate cohort.

- Final status must be `FINAL` or the observed NFL `FINAL_OVERTIME`, plus `END_OF_GAME`, with bound teams and scores.
- Exact team, season, week, game date and kickoff must match. Existing schedule quarantine and contradictory retained final scores remain ungraded.
- Missing model provenance does not hide an actual final score, but prevents a model grade. Missing original forecasts are never reconstructed. Ties and 50/50 forecasts never invent a directional win.
- The source is read on request through the existing five-minute cached/coalesced official feed, with at most three weekly bodies in flight and at most 18 weeks per grade request. The cache holds up to 40 parsed weekly receipts to avoid evicting full-season history on every call.
- These observations are not persisted. If official source access fails, newly observed grades are unavailable; existing qualified retained grades remain. The UI explicitly distinguishes observed finals from recorded journal results. Durable background recording remains separate work.
- No paid odds calls, credentials, forecast changes, wager execution, ROI, league-wide completeness or upstream independence claims.

Verification: focused parser/overlay/UI regressions, full Node suite, syntax checks. Live acceptance should check counts, exact original picks, final source links, source outages, conflicts, mobile readability and unchanged V2 aggregate counters.
