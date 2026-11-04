# BETQ.ai — Independent source-finality protocol (development candidate)

**Status:** development-branch research safeguard. Not production-certified. No wager execution.

## Why a 24-hour delay is not enough

A community schedule can display two numeric scores before it has declared a game
final, and may subsequently correct the score. A single timestamp or nonblank
score is therefore **not** proof of finalized settlement. Existing 2026
community-only score revisions remain preserved for traceability, but cannot
unlock model-performance or conditional sequential evidence.

## Read-only, no-paid-provider corroboration

1. Read the previously configured **nflverse schedules release** CSV.
   Validate game ID, NFL season, teams, local game date and scheduled kickoff
   against the *immutable original forecast journal*. Require 24 hours since
   scheduled kickoff and the next UTC date. Invalid/ambiguous source rows fail
   closed. The source's CSV bytes receive a SHA-256 digest.
2. Fetch only the fixed, publicly reachable **ESPN Site API NFL scoreboard**
   date endpoint, with at most four distinct dates per command. ESPN's Site
   API is **unofficial and unsupported**; it can change or become unavailable.
   No sportsbook odds, paid APIs, secrets, arbitrary URLs, or private quotes
   are fetched or persisted.
3. Require a single unambiguous event with a numeric event ID, matching
   season, matching teams, kickoff within six hours of the original schedule,
   explicit \`STATUS_FINAL\` with \`completed: true\`, and **both** scores
   equal to the nflverse result. Contradictory or in-progress status fails.
   Multiple matching events fail.
4. Record only a bounded derived attestation: event ID, publisher identifier,
   both matched scores, status, independent response SHA-256, collector receipt
   timestamp and \`officialLeagueCertification: false\`. The original source
   remains \`NFLVERSE_SCHEDULES\`. Do **not** confuse collector first receipt
   with the publisher's original publication time: the latter is unavailable.
5. Append a new revision if the score changes or an older community-only
   record is newly corroborated. Do not rewrite the first pregame forecast or
   any previous settlement. A verified identical score remains idempotent.

If ESPN is down, the result remains uncorroborated and scoring eligibility is
**withheld**. Missing independent confirmation is not treated as a verified
loss, no-result, or evidence of a model advantage.

## Data and metric gates

- \`settledGames\` still includes legacy observed final-score rows to preserve
  history and transparency.
- \`sourceCorroboratedSettledGames\` counts only latest, independently
  corroborated non-tie final-result revisions.
- \`sourceUncorroboratedSettledGames\` reports remaining legacy records.
- **Brier score, log loss, calibration, paired market metrics, and conditional
  likelihood ratios require at least 30 independent source-corroborated
  qualifying games.** The prior minimum of 30 is a descriptive publication
  gate, not proof of model skill, market superiority or profitability.
- The preregistered first-source market-direction audit does not depend on
  final scores and remains separate; no thresholds or observation choices
  were optimized after outcomes.
- No bookmaker-specific entry quote, fill, closing price, authentic CLV, net
  return or real-money profitability is established.

## Operations and operational limitations

- \`npm run evidence:settle -- --dry-run\` uses only the two fixed public
  sources. Dry-run prints verification counters and changes **no files**.
- The scheduled settlement-only writer may persist appended results only
  after merge, as a main-only GitHub Actions writer; PR validations skip the
  write job. The original paid-odds collector is not triggered by a mere
  source-code push; its pre-existing schedule/manual behavior is separate.
- Up to four unverified scoreboard dates are fetched per run. Dates rotate
  across invocations to avoid indefinitely starving older unresolved games.
  Already-corroborated unchanged results do not require repeat requests.
- Public source requests are bounded and performed at most once per date per
  run. Outages are recorded as unavailable, never silently accepted as final.
- Full score-vintage reconstruction would require durable original source
  snapshots and publication metadata; digest + receipt timestamp alone do
  not establish the historical publication time or official game authority.
- The original score journal does not contain publisher-signed game-final
  declarations. Source cross-checks mitigate this but are not league
  certification. An explicit official final-status source, stable licensed
  data, or independently controlled provenance archive is still preferable.

## Verification evidence (November 3, 2026)

- GitHub Actions PR validation included an actual **free-only dry run**:
  17 tracked games, 33 frozen snapshots, one final-score candidate,
  one independently matched final, no source-unavailable dates, and **no
  files modified**.
- This is a source-integrity milestone, not a new market prediction or
  profitability result.
- Tests cover wrong teams, mismatched scores, contradictory sources,
  status not final, timing, season, duplicate events, network failure,
  append-only revisions, untrusted legacy results, 30-game publication
  suppression, bounded date rotation and no sportsbook request path.

Reference PR: https://github.com/SpencerPhoenix/BETQ-ai/pull/2
Reference CI run: https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/41650023075
