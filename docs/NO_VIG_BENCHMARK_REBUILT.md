# Rebuilt independent no-vig benchmark

## Identity and scope

This is a **new local implementation**, based exactly on `03c83701dc676472fd347144bd3a412da9b7d6dc`. The earlier reported `7d23f16628d4a669188a7c004c8cdc16a14bfaf3` commit and original benchmark worktree were unavailable in the inspected repository. This work does not recover that commit or claim its test results.

The candidate adds isolated research, documentation and fixtures. It changes no live forecast, scanner, API, data file, risk gate, schedule or dependency. No provider calls, package installs, copied third-party implementation, publication or deployment are part of it.

## Independently implemented mathematics

For exactly two decimal prices d_i > 1, define q_i=1/d_i and S=q_1+q_2. The original overround is S−1.

- **PROPORTIONAL:** p_i=q_i/S. This is independently compared with the unchanged `src/engine.mjs:noVigPair`. Underround inputs remain explicitly labeled UNDERROUND; no arbitrage or execution claim follows.
- **SHIN_TWO_OUTCOME:** p_1=(1+q_1−q_2)/2 and p_2=(1−q_1+q_2)/2. For exactly two outcomes, Shin is equivalent to this additive correction. This is not a general multi-outcome iterative solver.
- With d=q_1−q_2, z=(S−1)(S−d²)/(S(1−d²)), derived by adding the quadratic identities q_i²/S=(1−z)p_i²+zp_i. Tests check these identities independently. z is only an assumed-model parameter; it is not evidence of actual insider trading.
- Material underround is rejected for Shin with `SHIN_UNDERROUND_UNSUPPORTED`, never silently replaced by proportional. A declared tolerance of eight binary64 epsilons treats tiny residuals around zero margin as rounding. The raw overround is retained, and z uses max(0,S−1) within this tolerance. Fair ±107 and ±143 American pairs exercise both floating residual signs.
- Inputs must be finite numeric pairs. No strings, coercion, third outcome, default prices or missing-data replacements. American magnitudes must be at least 100. All output probabilities must be finite and strictly within (0,1), with unit sum within the declared tolerance. Unrepresentable extremes fail explicitly.
- Very large negative American prices can convert to decimal exactly 1 in binary64. The research implementation rejects this precision collapse even though the legacy engine accepts it. Parity claims apply only to the tested common domain, not every finite legacy input.

There is no fit, method search or internal decimal rounding. The methods produce **market-derived estimates**, not independent sports forecasts or known true probabilities. Binary settlement must be defined separately: tied games, integer-line pushes and void rules are not invented by this transform.

## References and licensing

These pinned references were previously inspected in this task history; no external source was downloaded or executed for the rebuild:

- Penaltyblog commit `6870f0e762e9cba35fa722dc14a8daeaf8bc6134`: [implied formulas](https://github.com/martineastwood/penaltyblog/blob/6870f0e762e9cba35fa722dc14a8daeaf8bc6134/penaltyblog/implied/implied.py), [documentation](https://github.com/martineastwood/penaltyblog/blob/6870f0e762e9cba35fa722dc14a8daeaf8bc6134/docs/implied/implied.rst), [MIT LICENCE](https://github.com/martineastwood/penaltyblog/blob/6870f0e762e9cba35fa722dc14a8daeaf8bc6134/LICENCE), copyright 2021 Martin Eastwood. MIT requires retaining copyright and permission notices when copying substantial code. No third-party implementation, test suite, model or dependency was copied here. If code is adopted later, retain its notices and audit dependencies separately.
- Clarke, Kovalchik and Ingram, 2017, *Adjusting Bookmaker's Odds to Allow for Overround*, American Journal of Sports Science 5(6), 45–49, [DOI](https://doi.org/10.11648/j.ajss.20170506.12). Its appendix proves binary Shin/additive equivalence. Findings from its datasets are not validation of BETQ or an NFL edge.

Software licensing does not grant rights to collect or retain sportsbook data. No such rights are inferred.

## Calibration and proper-score fixtures

`binaryCalibrationDiagnostics` is a descriptive scorer, **not a fitted calibrator**. It accepts uniquely identified binary observations and reports Brier, natural-log loss, fixed-bin reliability, weighted ECE and Wilson intervals.

- Ten fixed equal-width bins use [lo,hi), with 1 included in the final bin. Direct upper-bound comparisons avoid a known binary64 pitfall: multiplying the predecessor of 0.9 by 10 rounds it into the wrong bin. Tests cover predecessor, exact and successor values for all nine interior boundaries.
- Empty bins have null means, rates and intervals; an empty sample has INSUFFICIENT_DATA. Nonempty samples remain DESCRIPTIVE_ONLY_NOT_VALIDATION regardless of size.
- Correct exact-endpoint predictions score zero. Wrong 0/1 predictions have infinite log loss, preserved as `logLoss:null`, `logLossStatus:POSITIVE_INFINITY`, with a mistake count. They are not silently clipped into finite scores or mistaken for missing evaluation.
- Wilson 95% intervals estimate descriptive **iid bin event rates**, not uncertainty around a particular prediction or a calibration guarantee. With one observed win, the lower bound is approximately 0.20655. Recurring teams and temporal dependence remain unadjusted.
- ECE is weighted by sample count, depends on the selected fixed bins and can look good in small or constructed samples. It does not establish calibration. Every report sets `fittedCalibration:false`, `calibrationEstablished:false`, `promotionAllowed:false`.
- Tests cover known rational examples, proper-score honesty, equal accuracy with worse confidence calibration, unequal bin weights, empty/sparse/malformed input, endpoint errors, outcome swaps and finite precision.

Chronology, eligibility and authenticated outcomes are separate requirements. Ties, pushes and voids are rejected as nonbinary labels, not treated as losses. No ROI, EV or promotion is inferred.

## Offline reproducibility

Run without networking or installations:

```
node --test tests/no-vig-benchmark.test.mjs
node scripts/audit-no-vig-benchmark.mjs
node --check research/no-vig/benchmark.mjs
node --check research/no-vig/calibration-fixtures.mjs
node --check scripts/audit-no-vig-benchmark.mjs
```

The audit prints deterministic JSON to stdout. It reads eight hand-derived synthetic fixtures, compares a fixed 23×23 American-price grid and hashes the existing bundled journal. Its raw-odds count checks the expected paired-decimal field, not every possible archive or hypothetical input format. It writes no dataset. The benchmark has no third-party dependency.

## Remaining scientific blocker

The bundled journal retains normalized multi-book consensus, not the original paired bookmaker odds and overround. These inputs cannot be uniquely reconstructed from a normalized median. Historical comparison remains **NOT_EVALUATED**; the audit does not manufacture prices or outcomes to choose a winning method.

A later study requires authorized, immutable paired prices, exact event/market/line/period, both sides' quote times, source receipts, bookmaker identity and explicit settlement rules, plus qualified outcomes. Freeze the sole proportional-versus-binary-Shin comparison before inspecting new outcomes. Keep the identical common evaluation mask and disclose underround/missingness exclusions. Any calibration fit must use strictly earlier data, a separate calibration period and a later untouched holdout, with simultaneous games grouped at split boundaries. Report coverage, paired proper scores, fixed-bin reliability and dependence-sensitive intervals. Keep all attempted methods in the research ledger. Numerical correctness is not market outperformance.

## Fresh verification of this rebuild

- Full offline suite on the new base: **780 passed, 0 failed, 0 skipped**, including **25 new tests**. This is a fresh execution, not the missing candidate's former count.
- Existing `npm run check`, all three new-file syntax checks and whitespace checks passed.
- Eight independent rational fixtures and 529 fixed price pairs: maximum proportional difference from the unchanged engine **0**; binary Shin supported **254** pairs and explicitly rejected **275** underround pairs.
- Current journal: **159 snapshots**, **0 expected paired-decimal-odds fields**, SHA-256 `abd610adedd6f20d133e94ed52f8503a0a49423e683deccf9fc7eba4c5b83daa`. Historical alternative-method evaluation is NOT_EVALUATED.
- The synthetic 20-row reliability oracle has Brier 0.16, log loss approximately 0.5004024235 and approximately zero fixed-bin ECE by construction. These are **not** sports-model performance results.
- Existing dependencies were copied locally from the base checkout only after its lockfile matched exactly. No installation occurred. The new focused tests themselves need only Node built-ins.
- Wilson intervals are individual-bin descriptive intervals, not a simultaneous confidence band over all bins.
- Fresh independent review found no correctness blockers: 100,000 deterministic-random American pairs matched the existing engine exactly; 100,000 Shin cases had maximum quadratic residual 4.44e−16 and additive difference 1.11e−16; 400 extreme-domain cases and 1,000 calibration datasets passed independent checks. These are numerical cases, not historical games.
- CLI `productionIntegration` describes module scope, not an automated Git verification. Review separately verified production/data/dependency/workflow paths match the base.
