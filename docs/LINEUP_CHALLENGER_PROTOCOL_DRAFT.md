# Lineup-aware challenger: point-in-time design and offline feature freeze

Status: **design and tested offline feature layer only**. No fitted lineup coefficients, training cohort, automatic collector, production probability change, paid calls, or model promotion. This draft is not a completed preregistration; numeric experiment choices must be frozen before future evaluation outcomes are inspected.

## Current evidence gap

The current `nfl_injuries.json` is a latest-state community injury report. Its source release and player modification dates do not prove when BETQ knew a fact. It lacks an archive of BETQ-owned historical first-received observations and independently reviewed starting identities. Re-fetching a historical URL today does not make its contents knowable before an earlier game. The current file cannot legitimately train a point-in-time injury-outcome challenger.

The existing QB latency lab tests observed price movement around reviewed news. It is not an outcome model and its source review does not certify who was the starting quarterback. Do not repurpose its movement statistic into a win-probability coefficient.

## Implemented boundary

`freezeReviewedQbFeatures()` in `src/lineup-shadow.mjs` consumes the existing private `makeQBCandidateNews` and `reviewQBCandidate` envelopes. At a trusted pregame freeze time it:

- requires exact game/team/kickoff identity;
- excludes observations or reviews not yet available at the freeze;
- validates canonical candidate/review contents and deterministic identity;
- deduplicates identical records, rejects mutated IDs and conflicting reviews;
- retains latest eligible observed status per player; conflicting same-time statuses remain unknown;
- reports partial or unknown team coverage, categorical reported-status counts and observation age;
- never equates missing reports with health, OUT with starting-QB status, or source review with authenticity;
- hashes the frozen record for deterministic identity, not cryptographic source authentication;
- returns no probability adjustment and never promotes a model.

It is a pure, offline function with synthetic tests. It does not write a store, fetch sources, expose private data publicly, or establish authenticity of caller-provided receipts. Production needs a trusted append-only ingestion/review service and durable retention. Source URLs remain constrained by the existing QB candidate allowlist; unsupported team domains fail rather than being silently trusted.

## Experiment design to freeze before collecting evaluation games

1. **Unit:** one verified game and one predeclared prediction horizon. Preserve the existing first-forecast baseline. An injury-aware later horizon is a separate cohort, paired with its contemporaneous market and baseline predictions.
2. **Primary task:** binary regulation-plus-overtime winner for non-ties, not spread or total. Ties and unsupported markets remain explicitly excluded.
3. **Candidate set:** baseline market probability; existing independent Elo; a regularized logistic model with market-logit offset plus narrowly defined pregame QB-availability features. No fixed invented point deductions for player names, positions, or designations.
4. **Features:** explicit known starter identity and change/availability supported by timestamped official observations; prior-game QB performance and participation only through a completed-game cutoff; missingness and observation age. Start with QB features, not every injury. Non-QB availability requires actual frozen role/usage data and a separate experiment, not counting each absent player as equally important.
5. **History gate:** a source timestamp is not a first-seen receipt. Historical records may be used for exploratory feature engineering only unless archived snapshots prove they existed at each decision horizon. Never use postgame snap counts, final starters, current depth charts or corrected latest-state injury files as pregame inputs.
6. **Training:** chronological expanding/rolling windows; transformations and hyperparameters fitted only inside earlier training folds. Any regularization choice, feature selection and calibration stay inside nested temporal validation. Keep all snapshots of one game in one fold; assess dependence by week and recurring team.
7. **Freeze:** store protocol version, feature definitions, exact trained-artifact hash, training/result cutoff, horizon, input receipt IDs and source observations. Freeze baseline and candidate probabilities before outcomes. Postgame changes create new versions for future games only.
8. **Outcomes:** retain current qualification policies and revisions. Separate strict V2 and reviewed-BDL descriptive cohorts; don't quietly combine them to reach a sample target.
9. **Evaluation:** paired Brier and log loss versus the same-time market and baseline; calibration bins with counts/uncertainty; favorite/underdog and disagreement coverage; week-block sensitivity; abstention/missingness rate. Winner accuracy is secondary, not a shortcut to value or profitability.
10. **Promotion:** establish sample-size/power and effect-size requirements before collecting evaluation outcomes, accounting for candidate count and dependence. Thirty games is only the existing descriptive floor, not sufficient evidence of model superiority. Keep probabilities research-only until independent validation supports promotion.

## Required next artifacts, not completed work

- A rights-reviewed official information observation stream with owned first-received times and source content digests.
- Separately reviewed starting identity/role receipts: current source-review envelopes intentionally do not establish starter certainty.
- A durable private append-only archive with tested backup/restore.
- A qualified timestamp-matched market cohort under already-approved provider limits.
- Enough historical point-in-time or prospective training data to estimate coefficients. Until then, `probabilityAdjustment` remains null rather than a guessed number.

The module can test chronology now. It cannot prove a better model without the missing data.
