# Current public journal read path

This follow-on to the outcome scoring gate reads the existing public BETQ
`main/data/evidence/nfl-2026.json` and calculates the evidence summary using the
running code's policy. An older `summary.json` no longer prevents updated
recorded-game counts from appearing. The legacy summary reader remains exported
for compatibility but is not the server's production evidence route.

## Request and data boundaries

- One fixed GitHub raw URL, one GET per refresh, no redirects or credentials.
- Requests are coalesced and cached for five minutes; failures retain the last
  accepted summary. Reads are bounded to 5 MB and ten seconds, with no retry.
- No BALLDONTLIE, odds-provider or ESPN request, API key, evidence write,
  database, account setup or new schedule is involved.
- The decoded journal must match the existing 2026 research schema and exact
  known source provenance. Capture timestamps must use canonical UTC ISO form
  so timestamp ordering cannot be changed using offset spellings. Nested
  raw-price or credential fields are rejected,
  including escaped JSON keys. Startup validates bundled data the same way.
- Previously retained forecast records must remain identical by ID. Sorting
  existing snapshots is allowed. New captures cannot predate the latest retained
  capture or precede an existing same-game, same-time ID in selection order.
  This protects both initial-model and challenger forecast selection.
- Every historical settlement record must remain identical and in order;
  later corrections append revisions. The scoring gate handles qualified and
  unqualified revisions without falling back to an older qualified outcome.
- Captures more than one minute ahead of the reader clock, and reconciliations
  more than two minutes ahead, are rejected. These are clock-skew tolerances,
  not permission to reconstruct forecasts after games.
- Only the recalculated summary is returned, with cloned objects. A caller
  cannot mutate the retained journal or cached scores.

## Honest freshness and limitations

The API and UI distinguish the most recent recorded capture, last successful
public read, summary calculation time and retained fallback status. A successful
GET does not prove recent source publication. The journal digest identifies
received bytes, not authenticity or original publication time. The initial
bundled digest is for its JSON serialization; a public-read digest is for the
actual response text.

Monotonic history checks are against the bundled and last accepted in-memory
journal. They are not a durable archive across process restarts and cannot prove
that a forecast was first published before kickoff. They do not establish
upstream source independence or add qualifying outcomes. The existing
BALLDONTLIE/nflverse match still does not qualify for scoring. Rights, durable
receipts and source independence remain separate prerequisites for a stronger
prospective study.

## Collection trigger separation

The collector's code-push trigger is removed so changing evidence code does not
implicitly request paid odds or publish results. Its existing seven scheduled
triggers, manual dispatch and main-only writer remain unchanged. This does not
disable scheduled collection and does not grant new permission to run it.

PR #9 must not be merged on its own while its original code-push trigger is
still present: merging it would match `src/evidence.mjs` and launch collection.
A future approved rollout must incorporate this trigger safeguard before or
with the scoring change. Publishing a draft does not merge or deploy anything.

Tests use mocked responses and loopback HTTP, including the unchanged checked-in
real journal. No live provider requests are needed to validate this reader.
