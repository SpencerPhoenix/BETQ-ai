# Final-result receipt readiness

Local implementation based on PR18 `157ed250ededed7fa3963b4c542d854f82e6d869`.
No provider retrieval, credential use, source activation, journal mutation,
publication, merge or deployment is part of this work.

## What blocks real qualified finals today

1. The existing collector reads nflverse's games CSV. Its retained actual header
   provides `gameday`, `gametime`, teams and numeric scores, but neither explicit
   `status` nor canonical UTC `commenceTime`. Scores and elapsed time do not prove
   terminal status. Copying the forecast kickoff would invent observed provenance.
2. The write gate requires an explicit matching terminal receipt with full frozen
   identity, bounded scores and a 24-hour post-kickoff delay. Hashing today's CSV
   cannot supply the fields that its actual source contract does not contain.
3. The existing scoring source contract recognizes ESPN/nflverse metadata only.
   ESPN automated collection/archive rights remain unresolved. The older draft
   adapter is not a current-compatible substitute. No ESPN call or archive is added.
4. The approved isolated BALLDONTLIE/nflverse reader has a native final-state,
   exact-kickoff and score comparison, but explicitly reports source independence
   unverified and zero qualifying outcomes. This change does not relabel it as a
   qualifying source or run its credentialed request.

The retained CSV inspected locally was recorded on November 5, 2026; it is not a
fresh November 7 retrieval. Its 7,548 rows and original header were used only to
verify source shape, not to append results or provide a new finality observation.
The currently checked-in journal remains 132 snapshots, 31 games, three raw final
records, zero source-qualified outcomes and no reported forward metrics.

## Safe implementation completed

- `readScheduleSourceBytes` records a SHA-256 over the exact received bytes and a
  caller-supplied completion observation timestamp. In the collector the timestamp
  is taken immediately after the response body is read. It is a collector time,
  not provider publication time. The function strictly validates UTF-8, CSV quoting,
  duplicate headers and row widths before normalizing rows. Raw bytes are not stored.
- `prepareScheduleReconciliation` invokes the existing result gate and returns
  allowlisted blocker counts. It reports missing final status, missing source
  kickoff, missing/invalid/stale source receipt, delayed finality, absent/duplicate
  rows, ambiguous frozen identity and other gate rejection. Multiple blockers may
  apply to one game; these counters are not outcomes or qualified samples.
- The collector retains its existing requests and timing policy. It now passes the
  actual-byte receipt and reports reconciliation separately from forecast-capture
  success. A realistic score-only CSV remains blocked, and a no-change run does not
  rewrite the journal. The 12MB limit is checked after body allocation, so this is
  not a claim that the transport has a streaming memory limit.
- Write and read validation share `FROZEN_RESULT_RECEIPT_V1`: terminal receipts must
  explicitly name NFLVERSE, the same full frozen identity and scores, FINAL status,
  digest and canonical time. An incoming receipt from another named source cannot
  be silently relabeled. The scoring gate additionally binds community metadata to
  the exact same identity, scores, digest and observation time.
- The externally visible scoring policy is now
  `SOURCE_CORROBORATED_SETTLEMENT_V2`, so old cached summaries cannot restore the
  weaker gate. Old records remain immutable and visible, but incomplete receipt
  metadata is not guessed. Compatible fresh receipts require an appended revision.

These are byte-integrity references and structural consistency checks. They do
not authenticate arbitrary caller-supplied receipts, verify a digest against an
unavailable archive, establish independent upstream lineage, or prove a result.
The synthetic unit fixtures exercise the contract; they are not research evidence.

## Next bounded decision

Choose and review a real source contract before building or activating a qualifying
adapter. A proposed BALLDONTLIE-based path would need a separately versioned policy
that attributes its native final declaration to BALLDONTLIE, treats nflverse as a
matching community score observation, preserves the independence caveat, and
keeps the resulting cohort distinct from ESPN-based or raw-score records. This is
a proposal, not an approved qualification change.

Before a real run: confirm source use/storage rights, exact request and request
budget, existing-key transmission approval, where a sanitized result may be
published, immutable forecast identity, receipt preservation/replay, correction
handling and rollback. Do not reuse old permission for another credentialed call.
Storage provisioning, ongoing access, public publication, merge and deployment
remain separate authorizations. No key is needed to review or test this local code.

No qualified result can honestly be produced from the currently integrated CSV
contract alone. This work makes the blocker visible and prevents contradictory
receipts from creating false progress; it does not claim the source problem is solved.

## Local verification

- 502/502 full tests passed with a cleared environment and external fetch blocked;
  localhost test traffic and intercepted fixture responses only. Zero skipped.
- 130/130 focused tests passed; independent final review approved the changes and
  reran 64 targeted tests after the final append-only upgrade adjustment.
- Syntax checks and whitespace checks passed on Node 24.22.1.
- `data/` and `.github/` are unchanged. Journal SHA-256 remains
  `21d97c7a27873f16962034eb50e1ff040bb55c23aed19160633c4ae7985834e9`.
- A fresh locked dependency installation was unavailable because the package
  registry could not resolve. Tests used an existing local installation with an
  identical lockfile (`pg` 8.23.1); no dependency or lockfile changed. CI on the
  eventual published head remains a separate, unperformed verification step.
