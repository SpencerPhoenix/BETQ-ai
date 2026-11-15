# Capture-time market proof and provider identity continuity

## Scope and result

Local patch based on `176bedc627b0ed02d4efeb8e14b61758e73bedfe`. It fixes the two independently reproduced capture defects without rewriting any forecast, result, model, injury or schedule data. No provider request, credential change, publication or deployment was performed.

### 1. Quote age is evaluated at capture, not earlier analysis

The earlier consensus exposed the oldest constituent's relative age at analysis plus only the newest absolute quote time. A quote that was 599 seconds old at analysis remained accepted when capture occurred ten seconds later, even though it was then 609 seconds old.

The consensus now returns its actual oldest constituent timestamp. The collector retains that timestamp as `marketOldestQuoteAt` only when the complete market pair qualifies. The shared eligibility rule requires canonical UTC timestamps satisfying:

- Oldest quote <= newest quote <= provider receipt <= forecast capture.
- Capture minus oldest quote <= 600,000 milliseconds, inclusive.
- Existing pregame, probability, model provenance and minimum independent-book gates still pass.

The absolute bound is used instead of a rounded or caller-supplied relative-age field. A delayed or incomplete market pair is omitted while a valid independent model forecast can still be captured. The dossier projects the retained timestamp and lists it as missing when absent.

The separate market policy is `ABSOLUTE_OLDEST_QUOTE_AT_CAPTURE_V1`. Outcome scoring and final-result receipt policies are unchanged.

### 2. Provider identity must remain consistent

`FROZEN_CAPTURE_IDENTITY_V2` adds three capture diagnostics:

- `PROVIDER_EVENT_ID_CHANGED`: more than one provider event ID for a frozen game.
- `PROVIDER_EVENT_ID_REUSED`: one provider event ID assigned to multiple frozen games.
- `PROVIDER_EVENT_ID_UNVERIFIED`: missing or invalid provider identity prevents continuity verification.

A conflict quarantines the affected game's complete incoming batch before deterministic snapshot-ID deduplication. Other games may proceed. Identical provider identity with changed quotes or receipt times remains a routine repeat; the original observation is never overwritten.

Source event IDs must be nonempty opaque strings, at most 200 characters, without surrounding whitespace or control characters. IDs are preserved exactly, not normalized or guessed. Direct journal additions and public append admission enforce the same continuity guard. Existing missing legacy identities remain readable; they do not authorize a new same-game identity. Changing a provider ID needs an explicit future reconciliation mechanism, which this patch does not invent.

## Historical evidence is preserved

The retained journal still has 159 observations, 31 games and three raw results. Its 156 non-null archived market probabilities lack oldest-quote timestamps. They remain stored and visible, but cannot qualify for market scoring or derived movement under the new policy. Missing timestamps are never reconstructed from fetch time, build time or newest quote time.

Model eligibility remains separate. In a synthetic case with 30 source-qualified outcomes and missing oldest-quote times, model scoring remains eligible while market comparison is withheld. The actual retained journal still has zero source-qualified outcomes; this patch does not claim improved predictive performance, betting edge, CLV or ROI.

The summary exposes the market policy and `legacyMarketSnapshotsWithoutOldestQuoteTime`. Raw paired-market counts continue to describe recorded values, not qualified comparison samples.

## Verification

- Full suite: **738 passed, zero failed**, including **33 new regression tests**. The final full run blocked nonlocal `fetch`; tests used retained files, fabricated fixtures, explicit mocks and local HTTP servers.
- `npm run check`: passed.
- `git diff --check`: passed.
- Independent review: **176 focused tests passed**, plus separate in-memory probes of the exact millisecond boundary, provider drift/reuse, and legacy withholding. No remaining material blocker found within this patch's scope.
- Data, workflows, server/auth/budget code, schedule review, model implementations and dependency files remain identical to the base.

New tests cover the original 599-to-609-second reproduction, 600,000 versus 600,001 milliseconds, invalid clock ordering, missing legacy proof, provider changes hidden by same-ID repeats, order-independent batch quarantine, reuse across games, direct-writer/public-feed bypasses and immutable historical bytes.

Independent review found and fixed one regression during development: the derived reader had treated its historical bundled fallback as an incoming new batch. Its startup now applies the existing public structural/time validation to the historical baseline and reserves provider continuity enforcement for actual subsequent appends. A dedicated legacy fallback and failed-append regression verifies this distinction.

## Integration and remaining operational limits

- The forecast-display work also adds `marketOldestQuoteAt` to the dossier whitelist. Keep one copy of that field when combining the branches. Preserve its archived/unqualified labels and suppress a model-versus-market comparison when market eligibility is false.
- Until the consensus-producing service returns the new absolute timestamp, an updated collector deliberately captures model-only observations rather than guessing old market proof. Rollout therefore needs compatible producer and collector versions.
- This patch cannot recover missing historical constituent timestamps or establish provider-event identity after a genuine ID change. Those need verifiable source evidence and explicit reconciliation.
- Existing budget, authenticated refresh, schedule reconciliation and result finality gates remain in place. Production operation still depends on separately approved integration/setup/deployment and authentic subsequent data; tests do not establish those live conditions.
