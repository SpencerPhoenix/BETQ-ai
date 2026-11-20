# BETQ forecast improvement audit · 2026-11-20

A forecast can pick the correct winner while overstating how likely that winner is. A more accurate winner forecast does not establish spread accuracy or betting value. This review uses public, read-only evidence; it does not update live forecasts, endpoints, schedule, odds access, receipts or grading policy.

## Questions and answers

| Question | What the evidence says | Decision |
|---|---|---|
| Is the current 16/23 hit rate evidence of a strong model? | No. It's an outright-winner count from a selectively retained descriptive sample (22 official-final grades and one separately reviewed BDL grade). There are 12 pending, eight schedule-conflicted and one ungraded game. None qualifies for the stricter V2 cohort. The 70%+ bin went 7/7, with too few games to adopt it as a threshold. | Report selection and sample sizes. Keep headline metrics descriptive. |
| Where are the misses? | Five of seven were below 60% forecast probability. The two highest-confidence misses were BAL (65.60%, LAC 23–20) and NE (62.25%, GB 45–27). Median baseline lead was 164.29 hours; 21 of 23 were more than five days before kickoff. These facts don't tell us what caused the misses. | Separate decision time and confidence in the miss review. Do not train on this slice. |
| Would a later Elo refresh alone have helped? | Nine of the 23 had both the first baseline and a later saved snapshot in the fixed 90–45 minute window; all nine were Week 9. Both versions were 6/9, with no side changes; Brier .18137 early and .18210 later. This is a small paired description, not a test of the new scheduled collector. | Preserve both horizons; use an on-time capture for a fair comparison, not as an assumed accuracy improvement. |
| Does the sports market already provide a stronger baseline? | In the four previously replayed seasons (2022–25), de-vigged closing moneylines beat Elo on Brier and log loss each year. The closing reference is retrospective and cannot be substituted for an earlier decision-time quote. | Test additive information against market-only and model-only controls on the same fixtures and timestamps. |
| What input could change the largest misses? | Confirmed changes in starter/QB availability and meaningful recent efficiency may add information. The early predictions preceded some official game-day reports by days. Later official evidence is not a feature for an old prediction; report content is not proof of an earlier observation by BETQ. | Test separately in shadow; freeze exact source, observation time, kickoff identity, role validation, and model artifact before using any feature. Do not apply invented point adjustments. |

Sources: [grade endpoint](https://betq-ai.onrender.com/api/research/grades), [pinned early and late snapshots](https://github.com/SpencerPhoenix/BETQ-ai/blob/42eb972bb653ffbeb09f7c8e7043bdf5cf6aa631/data/evidence/nfl-2026.json), [official results ledger](https://github.com/SpencerPhoenix/BETQ-ai/blob/evidence/official-results/ledger.json), [closing-reference replay](https://github.com/SpencerPhoenix/BETQ-ai/blob/42eb972bb653ffbeb09f7c8e7043bdf5cf6aa631/data/replay/summary.json), [NFL game-day inactives example](https://www.nfl.com/news/week-10-monday-night-inactives-los-angeles-chargers-at-baltimore-ravens). Snapshot comparison uses exact capture and kickoff timestamps and the same non-tie grade; latest eligible in-window snapshot was selected without considering results. Live grades were checked at 12:41 UTC; numbers are not a recurring assertion.

## Historical market-plus-Elo experiment

On 1,136 matched non-tied games across 2022–25, an offline prior-season-only fit assigned zero added Elo weight in every held-out season. On 1,131 games where the market picked a side, the fixed 25% Elo logit blend went 770/1,131 versus the market's 764/1,131, but it worsened pooled Brier (.20995 to .21129) and log loss (.60704 to .61028) versus raw de-vigged closing prices. Elo alone was .22382 / .63867. Neither existing calibration nor residual variants beat the raw market on the pooled probability scores. Thus the replay does not support promoting a fixed blend or a market-plus-Elo production rule. These are development-era seasons examined previously, not an untouched prospective holdout. Closing prices are not decision-time or executable prices.

See the [reproducible market-prior experiment](MARKET_PRIOR_ABLATION_2026_11_20.md).

## What would justify changing the live model

1. Verify in-window scheduled forecasts and durable pre-kickoff receipts, and separately verify final result and fixture identity. Exclude mismatches, ties, or missing capture proof, and report the omitted counts and causes. Keep the immutable first forecast separate from later windows.
2. Fix one candidate and all feature rules before inspecting a new prospective outcome cohort. Use prior-season fits and split by season in historical replay. A final injury designation or roster known today cannot backfill knowledge for an earlier hour. Use only data entitled and authorized for the task.
3. Compare the candidate to unchanged Elo and a de-vigged market at the same horizon, on identical qualified games. Evaluate paired Brier and log loss (lower is better), calibration with counts and coverage, and uncertainty across week blocks. The existing 30-game floor is not evidence of superiority. Do not keep trying variants on the prospective holdout or promote based on a single confidence band.
4. Advance a win model only after reliable, independently reviewed, out-of-sample improvement. Spread tests need a separate calibrated margin distribution with push probabilities, the exact spread/price at forecast time, and their own benchmark and holdout. No prediction or price simulation constitutes a verified fill or realized return.

See also [lineup challenger design](LINEUP_CHALLENGER_PROTOCOL_DRAFT.md) and [model-research integrity audit](MODEL_RESEARCH_INTEGRITY_2026_11_17.md).
