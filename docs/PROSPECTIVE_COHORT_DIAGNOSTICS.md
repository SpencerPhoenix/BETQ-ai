# Prospective cohort diagnostics

Run `node scripts/audit-prospective-cohorts.mjs [journal.json]`. This is an offline read-only audit, not an app route or a forecasting change. It performs no provider calls and never mutates the journal.

## Why

A pooled Brier score can hide disagreement performance and changes between model versions. The audit splits first frozen predictions into model-favors-market-underdog, model-favors-market-favorite, no-model-direction, and even-market groups. Market favorite means the side above 50% in a qualified same-capture no-vig consensus, not a team reputation. Both home and away underdogs are treated symmetrically.

Only strict V2 source-corroborated results with eligible first frozen model and market evidence enter this audit. Reviewed BDL results retain their separate descriptive policy. Missing legacy quote timestamps are not reconstructed; a later better forecast never replaces the first.

Each cohort independently needs 30 games before displaying proper scores. This is a descriptive publication floor, not sufficient proof of an edge. Week-block sensitivity requires at least eight weeks. Subgroups are exploratory and multiple comparisons are not corrected. Version labels can include different training artifacts, so the report is not an exact-artifact experiment.

## Current limitations and next validation steps

1. Source-qualified forward outcomes and genuine quote provenance must be collected before prospective market-relative accuracy is measurable. Lowering qualification standards would not create evidence.
2. Treat 2022–2025 benchmarks as retrospective development evidence now that they have been repeatedly inspected. The original 2025 holdout is not a fresh holdout for subsequent changes.
3. Keep the market probability, independent model probability, and model-favored winner separate. High winning probability is not the same as favorable price; model-market disagreement alone is not validated edge.
4. Pre-register a small candidate set and freeze model artifacts, input timestamps, forecast horizon, and promotion rules before evaluating new lineup/injury features. Neither a single upset nor one successful favored pick justifies a coefficient change.
5. Compare challenger and baseline on the same game/snapshot cohort. Report proper scores, calibration with bin counts, temporal/block uncertainty, missingness and coverage. Do not pool descriptive BDL and V2 results silently.
6. Add exact artifact identity and forecast-horizon cohorts when sufficient valid prospective samples exist. Keep the existing first-forecast report unchanged; a later pre-kickoff horizon is a separate protocol, not a replacement selected for better results.
