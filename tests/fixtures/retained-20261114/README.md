# Pinned retained-evidence regression fixture

These sanitized, public derived files are byte-for-byte copies of `data/evidence/`
from GitHub commit `f53b4b346ed79200d88dacccc648bab3f17c09df`. `manifest.json`
records the source URL, byte lengths and SHA-256 digests. They contain no raw odds,
credentials, or new forecasts. This fixture contains 323 snapshots, 44 games and
18 recorded results, none source-qualified under the tested policy.

Fixed-history, rejection and browser regressions use this immutable fixture and
explicit historical clocks rather than mutable operational data. Do not refresh
these files merely because collection appends another snapshot or result.
`tests/operational-evidence-bundle.test.mjs` separately checks the current journal,
retention of this baseline, structural validity, quarantine and coherent dynamic
coverage. It does not require current qualified counts to remain zero. Synthetic
future appends and qualified results exist only in memory inside tests.
