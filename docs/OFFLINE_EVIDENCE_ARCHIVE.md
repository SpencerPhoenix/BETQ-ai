# Offline synthetic archive and replay foundation

**Status: local research tooling, OFF by default. Synthetic fixtures only.**

This isolated proof does not capture live data, connect to a database, create
credentials, provision storage, call a paid provider, or change the production
collectors. No ESPN material or other real provider response is included.

## Run

`npm run archive:replay` reports that the archive is disabled. Environment
variables cannot activate it.

`npm run archive:replay -- --synthetic-fixture` verifies the fixed fabricated
repository fixture, prints a replay report, and writes no files. No arbitrary
source URL, input file, or output destination is accepted by this command.

## What is demonstrated

- Exact UTF-8 source content is retained with its SHA-256 and byte length.
- Identical content is stored once. Distinct source roles or collector receipt
  times produce separate receipt records. Repeated identical receipt submissions
  are idempotent. Publisher publication times remain explicitly unknown.
- A frozen pregame forecast pins the feature-input, model-parameter artifact and
  exact synthetic scorer-function bytes through their receipt IDs. Each receipt
  must exist no later than the frozen forecast, and the forecast must precede kickoff.
- The synthetic model's training cutoff cannot postdate its receipt. This proof
  replays inference from frozen parameters; it does not reproduce model training.
- Two distinct synthetic source roles must explicitly declare completion and
  match the same game, kickoff and both final scores. Receiving the same source
  twice does not supply a second source. Result receipts must be at or after
  kickoff and no later than verification. Frozen records cannot be overwritten.
- JSON export/import preserves content bytes and all references. Replay requires
  an expected manifest digest supplied separately from the imported bundle. The
  CLI pins the reviewed fixture digest in code rather than trusting a digest
  claimed by the fixture itself.
- Replay verifies every blob, receipt, reference, forecast and result. Unknown
  schemas, unsupported scorer code, orphan blobs, inconsistent IDs, stale hashes,
  incomplete records, future inputs and contradictory scores fail closed.
- The current synthetic scorer implementation is trusted executable code. Its
  archived function bytes must match, but archived code is **never evaluated**.

The committed fixture has four content blobs and six receipt records. Its
forecast and final are fabricated examples, not BETQ NFL predictions or results.

## Boundaries before any live implementation

A hash proves consistency with an independently trusted digest. It does not prove
that a publisher supplied the data, that a collector clock was honest, that the
original collection happened at the claimed time, or that two real publishers
were independent. The repository-pinned fixture is a deterministic test anchor,
not an independent production timestamp service.

The in-memory builder and local test-file round trip are not durable production
storage, access control, encryption, signatures, disaster recovery or an
append-only database. Each bundle contains one frozen forecast and result;
production correction/revocation history and multiple forecast manifests need a
separately reviewed design. Production model/code/input hashes and reproducible
training are still missing from the live pipeline.

Real-source adapters require source-specific retention and redistribution review,
an authorized private storage destination, and explicit approval before live
capture. This synthetic-only schema rejects real-provider identifiers. It does
not grant permission to archive ESPN, bookmaker payloads, private pricing, or any
other live source. It is not connected to the existing private shadow store.

No forecasting advantage, performance certification, real-money return, closing
line value, model promotion or wagering permission follows from this proof.
