# Authorized isolated timestamp-count diagnostic: run 72 only

This isolated candidate starts from published diagnostic commit
`2a1050fb5752ef1cae0eaae8abdd989b671f4ea6`. It is not an application release and must
not be merged. All application code, evidence, schedules, dependencies and other
workflows remain byte-identical to main `69ca969eeef474b379a0b8bc729a1cdde348dc6e`.

## What failed in run 71

Run 71 was reported successful, but the published script deliberately never read
the response body. Its HTTP_OK result established transport and reported quota
only. It supplied no counts of market timestamps. The body was discarded, so its
contents cannot be reconstructed from those logs. The published query also used
American odds with no kickoff bounds rather than the requested decimal,
today-remaining scope.

The user explicitly approved publication of this corrected isolated diagnostic
and one more manually started request, up to one additional quota credit, using
the existing secret over HTTPS to api.the-odds-api.com. Key-exposure risk was
disclosed. Output is limited to counts/status, never the key, prices or raw body.
No automatic retry or BETQ deployment is authorized.

This revision pins run **72**, attempt **1**, and the exact UTC kickoff window
**2026-11-08T16:50:00Z through 2026-11-08T23:59:59Z**. The latest read-only history
showed run 71 completed; run 72 is not reserved. Recheck current history, main and
branch immediately before publication and execution.

No expiry is chosen during preparation. When the user is ready, coordinate a
canonical UTC expiry no more than 15 minutes ahead and at or after 16:50 UTC.
The actual request must start **before 16:50 UTC**. If readiness slips past the
cutoff, stop and refresh the reviewed bounds before any dispatch. Do not knowingly
consume the only allowed run with expired bounds. Never retry an uncertain or
completed request, and never use Re-run jobs.

## Exact scope of the approved request

The only transport remains one HTTPS GET to the official Odds API v4 NFL odds
endpoint. Fixed parameters are region `us`, market `h2h`, `dateFormat=iso`, and
`oddsFormat=decimal`. The query additionally uses approval-pinned
`commenceTimeFrom` and `commenceTimeTo` values. It has no redirects, retries,
secondary provider requests, app calls, historical endpoint, pagination or purchase.

The fixed window is configured in `approval.json`, never supplied via an arbitrary
URL or query input:

- `requestDateUtc` must be the request day's actual UTC date.
- `commenceTimeFrom` must be a valid UTC second-resolution instant on that date,
  strictly later than the actual request preflight clock and no later than the
  separately approved canonical expiry, which is at most 15 minutes ahead.
- `commenceTimeTo` must be exactly that UTC day's `23:59:59Z`.

This selects remaining games from the **explicit approved cutoff**, not an inferred
user-local sports day. A later-day request, passed cutoff, invalid date, widened
end bound or missing window fails before transport. If any returned event lacks a
valid kickoff, falls outside the approved bounds or has started by body inspection,
the whole body is marked OUT_OF_SCOPE_RESPONSE and no partial counts are reported.
An empty response remains inconclusive. Do not reinterpret UTC dates as local dates.

## Bounded transient parsing and output

Only HTTP 200 bodies from the exact requested origin and URL are inspected.
Redirect and error bodies are never read. The body exists only in transient memory:
maximum 5,000,000 decoded bytes, 4,096 stream chunks, 256 events, 256 bookmakers per
event, 64 markets per bookmaker and 10,000 h2h markets overall. The existing single
10-second deadline covers transport and body reading. Abort cancels the active
reader; cleanup releases its lock. Invalid UTF-8, JSON, structure, size, fragmented
streams and read failures produce fixed error enums, never reflected error text.

The only new output is `bodyDiagnostic`, with fixed status and timestamp-rule enums
plus these bounded aggregate counters:

- `h2hMarkets`
- `lastUpdatePresent`
- `lastUpdateMissing`
- `lastUpdateParseable`
- `lastUpdateInvalid`

Presence includes null or malformed values; those count as invalid, not missing.
Parseability requires a real explicit-zone ISO calendar instant, with at most three
fractional-second digits. It rejects timezone-less strings, impossible calendar
dates and silent date normalization. Bookmaker timestamps are never substituted.
Unknown fields and non-h2h market values are not emitted. No raw key, URL, provider
message, team, event ID, bookmaker ID, odds price, source timestamp or body appears
in output or files. No raw-body artifact or dataset is created.

Empty results use EMPTY_RESPONSE_INCONCLUSIVE; nonempty responses without h2h use
NO_H2H_MARKETS_INCONCLUSIVE. Parse/schema/size failures have null counters. Successful
HTTP status with failed body diagnostics is not labeled a completed timestamp
check. Known sanitized HTTP/quota fields survive a body timeout or parsing failure.

These counts test field presence and strict parseability only. They do not prove
quote freshness, provider timestamp semantics, executability, sporting accuracy,
independent forecasts, profitable edge or source-qualified outcomes.

## Cost and approval boundaries

One market and one region retain the expected maximum of one existing quota credit.
The script does not purchase credits or perform an extra balance probe. Actual
provider charging remains provider-controlled: zero/one, missing cost and unexpected
larger reported cost remain distinct. Missing quota headers do not establish zero
spend. Failed, cancelled, timed-out or uncertain outcomes never authorize a retry.

The workflow retains read-only permissions, exact actor/branch/SHA/workflow binding,
run attempt, single reviewed run-number and short-expiry checks. Existing secret
access remains confined to the final step. No credential value was read during
preparation. Publishing the branch does not dispatch the request.

## Offline verification

Run `node --test scripts/one-shot-odds/diagnostic.test.mjs`, `npm run check` and
`npm test` without credentials and with external default fetch blocked. Tests cover
allowlisted output, redaction sentinels, strict timestamps, body limits/timeouts,
actual stream cancellation, explicit scope and all existing approval/cost guards.
The CLI and verifier must stop without the exact approved run context, before the
request window can be covered by the expiry, or after the fixed cutoff passes.
