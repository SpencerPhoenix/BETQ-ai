# Retained per-game grading ledger

`GET /api/research/grades` and the Game Monitor now expose every retained NFL game,
not only the recent-result preview. Reads await the shared, cached and coalesced public derived-journal refresh, with no odds-provider request,
forecast recomputation, journal write or paid action. The source journal is validated
before rows are returned. Every raw game remains in coverage, including quarantined
schedule conflicts, which are never scored.

The deterministic first frozen pregame snapshot remains the baseline. Later forecasts
cannot replace a missing or ineligible first forecast. The latest unambiguous result
revision is selected before qualification; an unqualified correction cannot fall back
to an older eligible result. Existing source-corroboration and model/market provenance
rules are unchanged. Missing model evidence, missing market evidence, no final result,
ties and schedule conflicts have explicit statuses/reasons, not fabricated grades.

Eligible non-tie games receive model Brier loss, log loss (probabilities clamped to
1e-6 for numerical stability), and directional correctness. A 50/50 forecast has no
directional pick. Market losses use only eligible same-capture no-vig consensus.
Market-minus-model Brier difference is descriptive for one game, not proof of future
improvement. No executable sportsbook price, ROI, CLV, spread or total grade is inferred.

Coverage is restricted to the retained journal; `leagueWideCompletenessVerified:false`
explicitly states this is not every game in the league. Games never captured cannot
be reconstructed from current model outputs. A full season inventory and qualifying
final-result receipts are needed before claiming complete league-wide grading.

No data files, workflows, model parameters or production settings are changed by this
feature. Historical model training/evaluation remains separate from prospective grades.
