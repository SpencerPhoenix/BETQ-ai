# Retained NFL game dossier

Local product slice, 2026-11-07. Built on guarded integration commit `78f3c8c`; no publication, deployment, new source activation or data changes.

## User job and entry points

Inspect one game without confusing a price reference, a model prediction, a frozen observation, and an outcome. Game Monitor supplies a retained real NFL index even when no current odds are cached. Current real NFL cards offer a research entry independently of whether a qualifying quote exists. The archived full-game moneyline scope is explicit and remains separate from current non-NFL, spread/total or fictional demo selections.

The detail panel is inline, not a modal. It has a named heading, Back to games control, Escape support while focused inside the detail, and a loading/result status region. Opening focuses the heading once; asynchronous completion and unrelated render timers must not steal focus. Closing, choosing a different dossier, or leaving the Games tab invalidates prior requests so a late response cannot reopen the panel or overwrite a newer dossier. Back returns focus to the opener if it still exists, otherwise to the Games heading.

## Retained data contract

- `GET /api/research/games`: at most 1,000 game identity/index entries, with total and truncation metadata.
- `GET /api/research/game`: exactly one `gameId` or `providerEventId`. Duplicate query keys, unknown filters and absent selectors are rejected. Unknown games return 404, ambiguous provider mappings 409, and invalid retained journal 503.
- Both routes read the loaded bundled derived journal only. They do not contact a provider or remote journal feed, use operator credentials, call a model, record a forecast, or change settlement history.
- Source generation time is a response timestamp, never a capture/publication timestamp. Actual bundled latest capture and per-game first/latest capture timestamps are separate. The deployed bundle may be older than the current external collector.
- The original baseline is the earliest original snapshot by canonical capture time, then ID. Missing qualification does not cause a later favorable or better-documented snapshot to replace it.
- Detail retains the latest 100 snapshots in chronological order, discloses truncation, and always supplies the first baseline separately. It does not silently treat 100 displayed rows as all evidence.
- Model, market and challenger qualification reuse existing shared integrity gates. Missing fields remain missing. Market consensus is always labeled market-derived, never independent model probability or verified edge.
- Latest settlement revision is selected before qualification. A later unqualified correction cannot revive an older qualified result. Recorded scores, source corroboration and model scoring eligibility are separate. Ties are not scoring-eligible. Results at/before kickoff and invalid/future receipts fail closed.
- API output uses explicit scalar and nested receipt allowlists. Existing public-journal validation rejects raw bookmaker/credential fields. Unknown record fields are not returned. Neither response exposes a payment credential, raw archived bookmaker odds, or a new source URL.

## Context and claims

No verified QB, injury or weather adjustments are added. Missing context does not establish that conditions were neutral. The separate EPA challenger is not promoted. Comparable games remain unavailable because no validated selection/similarity method has been implemented. No outcome or similar-game win rate is fabricated.

The view does not establish verified edge, CLV, ROI, official league certification, upstream source independence or a wagering recommendation. All existing execution and automatic-paper locks stay in force. No current-slate model recomputation is blended into the frozen record.

## Verification and remaining gates

Offline tests cover pure projection, original-baseline preservation, correction order, ties, identity conflict, future chronology, missing provenance, unknown-field isolation, selector/error contracts, immutable input, no external-source access, HTML escaping, no-demo/non-NFL provider links, malformed client payloads, close/reopen races and focus return. Tests use fabricated fixtures separately from the read-only bundled-journal checks. No fabricated fixture is written into production evidence.

Full test and syntax results are captured in the local task's verification log after final integration. Browser layout, actual keyboard/screen-reader behavior and interaction on mobile have not been certified: the existing environment rejects Chromium socket setup. DOM/VM tests are not a substitute for browser or assistive-technology QA.

The guarded parent integration's real PostgreSQL validation and production setup gates remain open. This dossier does not bypass them or authorize a release. Publication, deployment and any external provider/account action require separate authorization.

Final local verification: **420 tests passed, 0 failed, 0 skipped** on Node 24.22.1. Syntax and whitespace checks passed. Independent code review's final pass found no remaining material issues after checking the API unavailable-state mapping, provider-ID length contract, startup invalid-versus-empty distinction, qualification, chronology and focus/race paths. The original guarded integration commit and its recovery bundle remain intact.

An optional static JAX–BAL dossier preview was generated from the existing journal through the actual UI renderer. It includes five retained captures, labels its result as uncorroborated, has no scripts or external resources, and is explicitly a local implementation preview rather than a deployed app. HTML parsing and resource-isolation checks passed; visual layout was not browser-verified.

Later local update, 2026-11-07: isolated real PostgreSQL verification was subsequently completed while fixing transport and disconnect handling. See [PostgreSQL transport review](POSTGRES_TRANSPORT_REVIEW.md) for the current test coverage and privilege boundary. Historical test counts above describe the earlier slice. Production setup, publication/deployment approval and browser QA remain separate gates.
