# Rebuilt producer and offline benchmark integration

## Exact inputs

- Intact common base: `03c83701dc676472fd347144bd3a412da9b7d6dc`.
- Rebuilt producer: `2c82fce9abf550b14fbc795dc4228a177a65854b`.
- Rebuilt offline benchmark: `e2ebd4ef95e0e1c0c83e02035c98bc6cde3d50d6`.
- Conflict-free benchmark cherry-pick onto producer: `1438a184e30baa31f3855b2bbb73addc39c57f61`.

These are new reconstructions. No claim is made that unavailable earlier producer or benchmark commits were recovered. Original worktrees remain unchanged.

## Scope

The producer retains strict market-specific quote timestamps, original source receipt chronology, exact capture-age bounds, post-await response evaluation and unambiguous raw provider identity. Existing cache-only public reads, operator authentication, durable budget accounting, result qualification and schedule safeguards are unchanged.

The benchmark adds six isolated research, test, CLI and documentation files. Those files match the independently reviewed benchmark commit exactly. Nothing imports the alternative transform or descriptive calibration scorer into production. The integration adds no model selection, training, probability adjustment, market promotion or betting authorization.

## Fresh combined verification

- **812 tests passed, zero failures or skips**, on Node 24.22.1. The combined total includes 32 new producer and 25 new benchmark regressions.
- The full run used an empty credential environment and blocked external default fetch. HTTP/collector tests used local servers, synthetic responses and intercepted schedule reads only.
- Existing `npm run check`, explicit syntax checks for all three benchmark executable modules and `git diff --check` passed.
- The offline audit reproduced 529 paired-price cases with maximum proportional difference from the unchanged engine of zero. Binary Shin supported 254 pairs and explicitly rejected 275 underround pairs. These are numerical fixtures, not sporting events or accuracy results.
- Locked dependencies were copied locally from the verified producer worktree. No install or dependency change occurred.

Independent integration review is recorded in the accompanying local handoff report. Component review and limitations remain in `PRODUCER_QUOTE_REBUILD_20261108.md` and `NO_VIG_BENCHMARK_REBUILT.md`.

## Preserved evidence and remote baseline

GitHub main was rechecked read-only at `69ca969eeef474b379a0b8bc729a1cdde348dc6e`. Every data file present on that main revision remains byte-identical. The only additional data paths are the prior intact candidate's reviewed historical-2025 bundle, not new integration output.

The retained prospective journal is unchanged: 159 snapshots, 31 games, three raw results and no new qualified outcomes. SHA-256: `abd610adedd6f20d133e94ed52f8503a0a49423e683deccf9fc7eba4c5b83daa`.

No production source, public asset, data, scoring gate, workflow, configuration or dependency file differs from the producer rebuild. No provider call, spending, credential/configuration change, publication, merge or deployment was performed.

## Remaining blockers

- Actual configured-provider market-specific timestamp support is unverified. Bookmaker-only timestamps deliberately do not qualify as market proof.
- The retained journal lacks original paired odds and overround, so historical proportional-versus-Shin performance remains **NOT_EVALUATED**. Normalized medians cannot reconstruct those missing inputs.
- Production operator authentication, durable budget readiness, compatible collection and deployment need separate approved operational work. Qualified result receipts remain necessary before reporting forward performance.
- Numerical correctness and passing tests do not establish improved forecasts, profitable edge, ROI, CLV or live readiness.

A complete-history Git bundle and patch are prepared alongside the local report. Backup verification must include restore to an independent bare repository and exact commit/tree comparison, not only successful bundle creation.
