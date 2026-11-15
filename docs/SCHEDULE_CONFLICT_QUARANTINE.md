# Per-game retained schedule quarantine

## Purpose and boundary

The local integration preserves the complete source journal while excluding an unresolved kickoff conflict from usable forecast, evidence and market-monitor views. This is not schedule reconciliation, source verification, historical correction or authorization to collect from a provider.

Policy: `FROZEN_SCHEDULE_CONFLICT_QUARANTINE_V1`.

Only a narrow conflict is quarantined: every record has the same game ID, season, home team, away team, game date and valid, nonmissing provider event ID, but more than one canonical kickoff instant. Missing, changed or cross-game-reused provider identity cannot qualify for this exception. Other frozen-identity contradictions remain hard failures.

The complete journal is structurally validated before projection. Every source/model/market/result observation must obey the actual reader clock. Result identities, revisions and present receipt identities/scores must remain consistent; provided result and receipt kickoffs must agree with one another. A result or receipt must follow the latest disputed kickoff, not merely the earliest one. This does not prove that either recorded schedule was correct or that the result is eligible for scoring.

## Raw history versus usable views

The original journal, all snapshot IDs, forecast probabilities, kickoff fields, result records and source digest remain intact. No record is deleted, rewritten, relabeled or migrated into another game. The source archive remains the authority for complete raw history.

`retainedJournalProjection` returns a detached unaffected-game view and explicit quarantine metadata. Public evidence, forecast cards, dossier index, health and the derived-market feed expose the same exclusion. Metadata reports raw and excluded game/snapshot/result-record counts, each affected identity, all retained kickoff instants, the original first snapshot/kickoff, and `scoringEligible:false` / `collectionEligible:false`. Result-record counts include revisions and must not be presented as qualified game counts.

For main `9157f19`, the raw journal remains 203 snapshots, 31 games and 16 result records. LV–SF has seven original 21:05 UTC snapshots and two later 21:25 UTC snapshots. The usable projection has 194 snapshots, 30 games and 15 result records; qualified outcomes remain zero. The nine conflicted snapshots and one result are retained, not discarded. Selecting the conflicted game returns HTTP 409 with its quarantine reason and an allowlisted, chronological history bounded to 100 snapshots, with truncation disclosed. It never becomes an ordinary eligible forecast dossier.

Public source digests continue to identify the complete raw response, not the projection. UI warnings disclose the excluded counts and both kickoff times; conflicted games receive no probability rank or eligible inspection control. Invalid/contradictory warning metadata fails closed instead of silently hiding exclusions. DOM tests cover warning rendering, escaping, focus restoration, cancellation and late responses.

## Collection and scoring

Capture admission shares the complete retained identity/time/result gate before any schedule exception is considered. It rejects non-schedule corruption, skips every attempted capture for a quarantined game, and permits an unrelated valid capture under all existing chronology, provider, model and budget constraints. The direct journal writer rejects attempted captures and results for the conflicted game, including duplicate capture IDs. Schedule reconciliation and settlement qualification continue excluding ambiguous identities. No path chooses one kickoff or replaces the first frozen forecast.

The collector's future published summary uses the same validated projection and includes quarantine metadata. Logs separately report the cumulative raw snapshot count. The checked-in historical summary was not regenerated during this task and remains byte-identical to main. Direct `summarizeEvidence` remains a raw descriptive helper; public/collector projections are explicit. No qualification threshold, budget reserve, paid-request authorization, scheduler trigger or production configuration changed.

The disabled official-review metadata ledger remains disabled and cannot target the ambiguous frozen game. A genuine later schedule-evidence amendment, with approved source rights and provenance, would be a separate design. This change creates no receipt or new outcome and does not resolve the disputed kickoff.

## Cache and failure handling

Feeds retain the complete last accepted journal, verify append-only updates against that full history, and reject deletion, backdating, identity corruption and future observations before updating caches. A legitimate schedule-only conflict can enter quarantine without hiding unaffected games. Cache hits and in-flight waiters recheck the current reader clock; a rollback withholds future evidence and a later clock restoration recovers the retained cache without manufacturing a new capture. Error handling never silently normalizes a schedule or empties a successful view.

## Verification and limits

New regression tests cover the real preserved data, synthetic multi-revision conflicts, strict validation before filtering, direct-writer and collector bypasses, nested receipt identity contradictions, complete digest/cache preservation, clock rollback/recovery, detached projections and explicit HTTP/UI warnings. The final direct Node aggregate run passed **941 tests, zero failures or skips**, including 58 focused quarantine regressions; all **62 package syntax checks** passed. Exact candidate hashes and complete logs are retained in the local verification report. These are offline/synthetic and retained-data checks, not new live-provider or production database tests.

Browser visual verification was unavailable in this environment: Chromium could not start because its required socket operation was blocked. Node DOM/keyboard tests are not Android visual testing. No production deployment, publication, provider request, spending, secret access or settings change occurred. Database/authentication readiness, source rights, actual provider timestamp support and deployment approval remain separate prerequisites.
