# Durable official descriptive results

## Storage and collection

`official-results.yml` runs hourly at minute17 and on explicit manual dispatch from main. It fetches the current validated public retained journal, then only fixed official NFL weekly URLs for retained completed-game weeks (at most18weeks, three requests concurrently). Successful source observations are appended; partial outages preserve older entries and produce a degraded workflow report after publication.

`evidence/official-results` contains only `ledger.json` in its published tree. Source HTML and credentials are never included. Each hash-chained entry includes a bounded allowlisted weekly receipt, source URL, exact-byte source SHA256, observation time, and digest-bound original frozen snapshot identities. Same-state repeat polls are no-ops, so timestamps never pretend an old stored receipt was freshly archived. Changed final, absent game, nonfinal, identity, and score observations remain in append-only history.

The publisher checks prior head, full history extension, fixed repository/branch, one-file tree, fast-forward update and exact remote byte readback. Collection has no publisher credential. The workflow's write token is scoped to its publication step. Application main, frozen forecasts and qualified settlement journal are never modified.

## Reading and correction safety

The app reads the fixed public ledger. Its accepted history is checked for append-only extension; malformed data, rollback and disappearance of known history suppress grading until valid history is restored. Transient transport/server outages can retain the last accepted valid copy. First-time branch absence is explicitly different from deletion of known history.

Saved finals can grade the original forecast without a new NFL page read succeeding. Fresh matching observations retain saved-result disclosure. Structural baseline/provider/quarantine conflicts cannot be bypassed by a newer live page. Fresh score/finality conflicts latch within the running service and never revive an older saved winner during a later source outage. Collector-published revisions provide durable correction history across restarts. An on-request conflict that has not yet been collected is not claimed as durable.

Current observations do not establish pregame historical source availability or independent timestamp attestation. This ledger is a separate descriptive cohort: no V2 aggregate admission, proven edge, ROI, bookmaker fills, spread/total probabilities or wagering.

## Operations

1. Merge only after syntax, full unit/HTTP tests, offline browser tests and independent review pass.
2. Run the official-results workflow once or publish a validated initial one-file ledger through the authorized repository path; verify readback before relying on durable grades.
3. Deploy the application revision and verify `/api/research/grades`: `durableLedgerAvailable`, `savedGrades`, original source dates, final scores and unchanged qualified counts.
4. Review degraded runs and identity holds; do not rewrite old forecasts or remove conflicting observations to obtain a higher grade count.

The hourly workflow is best-effort GitHub scheduling, not a precise final-whistle guarantee. On-request fresh source checks still exist. Original V2 aggregate qualification remains unchanged.
