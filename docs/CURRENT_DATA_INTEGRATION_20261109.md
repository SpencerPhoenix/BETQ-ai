# Current-data integration: blocked local candidate

Historical checkpoint: this report describes commit `663677d` before the subsequent local quarantine implementation. See `SCHEDULE_CONFLICT_QUARANTINE.md` for the new read boundary; the underlying kickoff dispute remains unresolved and the original journal remains unchanged.

## Inputs and preservation

- Integrated product base: `2107bd747fdfaf582ebdb49e5f21f267bf28f37f`.
- Disabled official-review contract: `3abbcce5e76715854f57f24cbc3863a28541602b`, a direct descendant of that product base.
- Read-only GitHub main: `9157f19ae43430f9f79af8aafc9c1a2efe21e018`, tree `8b2db8425b6312bc95c857dbf63e9eecd3b3db25`.

The current main tree differs from the earlier main baseline 69ca969 only in `data/evidence/nfl-2026.json`, `data/evidence/summary.json` and `data/nfl_injuries.json`. Those three files were obtained through the supported read-only GitHub connector and their exact Git blob hashes verified before copying. No network Git fetch or package installation was used. No current upstream source or workflow change was omitted.

Every data file on current main is byte-identical in this candidate. The additional historical-2025 bundle remains byte-identical to the reviewed local base. All earlier journal records and its header remain unchanged: 159 snapshots and three raw results extend append-only to 203 snapshots, 31 games and 16 raw results. These are retained claims, not newly verified sporting outcomes. No official observation receipt was created or saved.

## Release blocker: conflicting frozen kickoff

`2026_09_LV_SF` retains seven observations with kickoff `2026-11-08T21:05:00.000Z`. Main then appended two observations with kickoff `2026-11-08T21:25:00.000Z`, under the same game and provider identity:

- `02aa16ac8e067d9cfa027f3a`, captured `2026-11-08T17:13:38.309Z`.
- `437b8ddc7faa4ccc27e0cd55`, captured `2026-11-08T20:25:59.125Z`.

The older records have not been corrected, filtered or relabeled. All records pass individual identity shape checks, but their game-level frozen identity is contradictory. The strict full-journal reader rejects the combined journal with `INVALID_RETAINED_GAME_IDENTITY`. The collector admission boundary also rejects it. An already valid cached journal is retained with an explicit refresh failure; a fresh bundle is unavailable rather than an empty successful view. This is not a safe-to-release candidate.

The disabled official-review ledger can describe all 16 raw-result games without creating receipts or qualification. Its target function correctly rejects LV–SF and accepts the other 15 raw-result identities. It cannot resolve the kickoff conflict, establish source rights or promote legacy results. Qualified outcomes remain zero.

The imported archived summary remains main's historical output, including its older scoring policy and 12 reported near-kickoff pairs. It is not a recomputed V2 summary. Pure current-policy recomputation has zero qualified outcomes, zero qualifying near-kickoff pairs and 200 legacy market snapshots missing oldest-quote times. The public read path must continue using its validated recomputation, not silently trust the archived summary.

## Verification

- Full direct Node suite: **837 passed, 29 failed, zero skipped, 866 total**. Failures include strict full-journal rejection and stale tests tied to the previous 159/3 data baseline. Tests were not weakened to claim compatibility.
- Official-review suite plus separate pinned-data integration checks: **65 passed** (54 existing contract tests and 11 preservation/fail-closed checks).
- Independent review confirmed exact data preservation, append-only history, the single-game conflict, unchanged guards and disabled/nonqualifying official metadata behavior.
- Tests ran with an empty credential environment, external default fetch blocked, and synthetic or loopback fixtures only. Runtime/dependency/workflow/security code is unchanged from 3abbcce.

## Safest next development step

Design and independently review an explicit per-game quarantine boundary before changing runtime behavior. Keep the complete original journal and digest; disclose excluded game/observation/result counts and the conflict reason; retain the first frozen forecast; do not silently select either kickoff; prevent scoring or collection for the disputed identity. Any reader projection must be separately named and consistently applied across evidence, forecast cards, dossiers and health. Structural corruption, unknown identity, backdating and secret/raw-data leakage must still reject. A separate schedule-evidence amendment needs genuine provenance before resolving the disputed game.

Until that design is approved and tested, leave the existing strict rejection in place. Do not change historical records, lower safeguards, claim live readiness or publish this blocked candidate. Official source rights, actual observation procedure and production database/authentication readiness remain separate unresolved prerequisites. No provider request, spending, secret access, publication, deployment, settings change or main merge occurred.
