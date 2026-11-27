# Market-prior ablation: development research only

## Result

No tested addition improved the unchanged closing-market probability baseline on the common 1,136 non-tied 2022–2025 games. The constrained market-offset fit selected **zero Elo weight in each of the four seasons**, based on the preceding two seasons, not the evaluation season. This is evidence against forcing an Elo contribution into this particular historical baseline, not proof that every possible feature lacks information.

| Model | Brier, lower better | Log loss, lower better |
|---|---:|---:|
| Unchanged closing market | 0.20995252 | 0.60703953 |
| Existing Elo | 0.22382151 | 0.63867443 |
| Fixed 25% Elo logit residual | 0.21129307 | 0.61028422 |
| Constrained fitted Elo residual | 0.20995252 | 0.60703953 |
| Existing market calibration | 0.21043294 | 0.60821229 |
| Existing calibrated market + Elo residual | 0.21050406 | 0.60838116 |

On the same 1,131 games with a directional market favorite, market picked 764 winners and the fixed-quarter blend picked 770. The blend picked 772/1,136 when including the five market abstentions. It nevertheless worsened Brier and log loss. More correct favorite selections are not sufficient evidence of better probabilities or profitable decisions.

Every attempt is retained. There is no winner-selection or promotion mechanism. The fixed blend and constrained offset are bounded sensitivity tests; the calibration/residual models repeat existing research as controls, not new discoveries. No 2026 live outcomes enter this study.

## Reproduction

Use the retained `games.csv` with SHA-256 `5e1f14fe5b37df03d7ef9c3662402cc4e4fb6055bede8940cc2fc5af46cb3f01`. No source is downloaded by this script. Attribution: nflverse / Lee Sharpe, CC BY 4.0.

Run from the repository, using an existing parent directory and a new output directory outside this checkout:

```sh
node --import ./scripts/test-network-guard.mjs scripts/run-market-prior-ablation.mjs /absolute/path/to/retained/games.csv /absolute/path/to/new-report-directory
node scripts/run-tests.mjs tests/market-prior-ablation.test.mjs tests/residual-research.test.mjs tests/historical-replay.test.mjs
```

The script refuses a different source hash, outputs inside the repository, or an existing output directory. Outputs include the exact protocol, source/code hashes, underlying Elo fits, all reconstructed 2020–2025 rows, four prior-only model fits, every evaluation-game prediction, exclusions, pooled/year scores, and 10,000 deterministic season-stratified week-block draws summarized as intervals.

The protocol was committed before the real run. Underlying Elo tuning and calibration are inherited from `historical-replay.mjs`: five earlier tuning seasons, two earlier calibration seasons, then day-frozen updates. Candidate training uses the preceding two NFL seasons only. Perturbation checks verify target/future outcomes cannot change fitted parameters, the opening day's Elo predictions, or the market-model prediction given its frozen inputs.

## Uncertainty and limits

- The primary score is log loss versus raw market. Simultaneous intervals cover all five non-market comparisons using the centered maximum absolute bootstrap deviation. This conservative unstandardized interval is dominated by the higher-variance Elo comparator. Individual nominal intervals are also retained, explicitly not family-corrected.
- Zero fitted weight gives exactly the market prediction on every row. Its actual paired difference and individual interval are exactly zero; the shared simultaneous interval is conservatively wider.
- The 2022–2025 seasons have been repeatedly inspected in earlier BETQ experiments. This protocol freezes this execution, but cannot retrospectively create an untouched confirmatory holdout. The intervals do not correct for every earlier BETQ search or include the uncertainty from refitting coefficients.
- Closing moneylines are retrospective and lack historical quote timestamps, bookmaker identity, contemporaneous injury context and fills. They can contain later information than Elo's earlier forecast. This is not a same-time decision comparison, CLV result, ROI result or live pricing recommendation.
- The retained source can contain later corrections. Chronological computation is verified; historical source-vintage availability is not.
- Three evaluation ties are excluded from binary scoring. The 2020–2021 training reconstruction additionally excludes two ties and one invalid/missing paired market. Reasons and IDs remain in the report.
- Local verification used Node 24.22.3; the current repository declares Node >=26.13.1 <27. Tests passing here do not substitute for the target-runtime release checks.

## Next useful step

Preserve raw market as the baseline and add only an independently motivated, timestamped feature that can be tested against the **same quote at the same decision time**. A zero-weight/raw-market fallback is preferable to forcing an unproven residual. Keep any candidate in shadow evaluation with frozen future eligibility, proper scores and explicit missingness. This patch changes no production endpoint, model artifact, collector, evidence record, schedule or wagering decision.
