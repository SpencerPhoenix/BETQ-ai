# Producer quote contract reconstruction

## Provenance and scope

This is a new local reconstruction from intact candidate `03c83701dc676472fd347144bd3a412da9b7d6dc`. The previously reported producer candidate `face4a6b` was not recoverable after the execution workspace reverted. This patch is not presented as the same commit or exact bytes. It implements the previously reproduced defects and validates them again with new tests.

No provider calls, spending, credential use, production settings changes, publication or deployment were performed. The separate no-vig benchmark reconstruction is not included.

## Rebuilt safeguards

- The producer returns the absolute oldest and newest market-specific quote instants already supported by the intact base. It no longer derives those instants from a bookmaker-level update or permissively parsed dates. Explicit time zones and real calendar instants are required; exact UTC milliseconds survive offset conversion.
- The HTTP path passes the original canonical provider receipt explicitly. Missing, future or over-ten-minute-old receipts cannot become the response time. Quotes must precede the receipt and response and be no older than 600,000 milliseconds at response analysis. A wider display configuration cannot loosen that bound or reduce the minimum of three books.
- Response analysis occurs after both injury retrieval and optional private capture complete. A slow or failed capture cannot leave the model or market falsely pregame, or the market falsely fresh.
- Raw provider event IDs are checked before any event filter or enrichment. Every occurrence of a duplicate ID and every invalid ID is excluded. IDs are never coerced to strings or repaired by choosing first/last records. Unrelated original events remain intact. An ambiguous batch is never sent to optional private persistence.
- Existing collector admission rechecks quote age at actual capture. Thus a 599-second-old producer quote can become model-only evidence after a ten-second delivery delay. Historical quotes and results are never backfilled.

The stricter timestamp rules apply to the market consensus/reference and prospective evidence contract. This patch does not redesign the existing scanner quote renderer or the independent private shadow-latency normalizer.

## Verification

- **787 full tests passed**, zero failures/skips, on Node 24.22.1 with an empty credential environment and external default fetch blocked.
- **32 new regressions passed**, including actual production source code with a fixture-only fetch, local HTTP response, actual collector entry subprocess and retained dossier projection.
- Syntax check and `git diff --check` passed.
- The first full attempt encountered a missing `pg` package in the new worktree. Unchanged locked modules were copied locally from the intact candidate, dependency validation passed, and the full suite was rerun successfully. No dependency or lockfile changes or package network requests were made.
- Independent review: 129 in-memory assertions and 69 pure evidence/schedule tests passed, with no blocking findings. Two suggested delay cases were added as committed regressions and the full suite rerun.

Coverage includes malformed and absent quote/receipt times, explicit offset milliseconds, exact age boundaries, stale market versus fresh bookmaker time, delayed capture success/failure, kickoff crossing, source cache reuse, authentication and zero budget, duplicate/invalid raw IDs, filtered duplicates, and immutable source objects.

## Data and remote baseline

GitHub main was rechecked read-only at `69ca969eeef474b379a0b8bc729a1cdde348dc6e`. All files already present under main's `data/` remain byte-identical; the intact candidate additionally contains its previously reviewed historical-2025 bundle. This reconstruction changes no data, collector, scoring, model, schedule, auth/budget implementation, workflow or dependency files.

The prospective journal remains 159 observations, 31 games and three raw results, SHA-256 `abd610adedd6f20d133e94ed52f8503a0a49423e683deccf9fc7eba4c5b83daa`. No new real results or predictive-performance claims are established.

Latest remote draft PR18 was read-only verified open and unmerged at `157ed250ededed7fa3963b4c542d854f82e6d869`. This new local reconstruction is not published there or included in production.

## Remaining operational blockers

The configured provider's actual market timestamp field support is unverified. Some Odds API formats may supply only bookmaker-level updates. This reconstruction deliberately refuses to treat those as market-specific proof and can therefore leave consensus unavailable for that format. Before any rollout, verify an authentic retained payload or authoritative field contract without guessing or backfilling a timestamp. The offline fixtures establish code behavior, not live provider compatibility.

Production operator authentication, shared budget readiness, provider configuration and deployment still need their separately approved operational work. Existing raw results lack source-qualified finality; no amount of local testing substitutes for authentic future receipts. No betting authorization, verified edge, ROI or CLV is implied.
