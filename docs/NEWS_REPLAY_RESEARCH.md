# Point-in-time news replay: research-only admission prototype

Status: offline validation prototype, not a news collector or predictive model. No server,
UI, workflow, provider, probability, frozen forecast, or source artifact imports this
module. `research/news-asof.mjs` is exercised only by synthetic tests. No accuracy
improvement or validated news effect is claimed.

## Why this is useful

An article's original publication time does not prove that its current text existed
before kickoff. An old URL may have been revised after the outcome. The historical
replay therefore needs the exact version, source bytes and independent custody evidence.
Simply retrieving a dated article today does not establish historical BETQ capture.

The checker binds game ID, teams and kickoff, player and reviewer identity, exact
source-byte SHA-256, publication, observation, review and version-availability times.
Only reviewed QB-out/starter-confirmed/player-out/questionable facts are supported.
It validates timestamps and chronology, not football truth. Missing or unreviewed facts
remain unavailable, never healthy. No numerical player effect is assigned.

## Trust boundary

`eligible: true` means **internally consistent review attestations only**. Every output
explicitly states `sourceAuthenticityVerified: false`; it cannot authenticate a website,
archive, reviewer, timestamp or claim. `sourceApproved`, `reviewStatus`,
`versionEvidenceVerified`, reviewer ID and version evidence reference must be supplied by
an independently controlled review process, never treated as user-input proof. The SHA
binds supplied bytes but cannot establish their publisher or publication date.

A future ingestion service must resolve the version evidence reference, validate actual
archive/receipt custody, control a source registry and reviewer identities, check source
rights, preserve revisions, reconcile contradictory claims, and independently verify
extracted facts against the exact version bytes. This module is NOT that service. Do not
wire it to public ingestion or let its return value authorize production features.

## Two explicit modes

- `prospective`: publication, version availability, first observation and review must all
  precede the forecast cutoff. Output still requires independent custody verification;
  consistency alone does not prove BETQ captured it then.
- `historical-reconstruction`: an independently reviewed archive version may precede the
  cutoff even though BETQ observes and reviews it today. It is explicitly labeled an
  archived-content reconstruction, not historical BETQ capture. Current source text with
  an old publication date but no version evidence is rejected.

Both use an exact pre-kickoff cutoff and retain observation/publication as distinct.
At the exact cutoff the information is allowed; at kickoff it is not. Neither runs
network requests, returns source content, trains models or changes probabilities.

## Experiment contract before fitting any effects

1. Predeclare a primary T−24h cutoff and secondary T−60m cutoff, candidate family and
   outcome metric. Preserve all attempted candidates, including negative results.
2. Collect game-bound structured facts from source-approved, independently reviewed
   versions. Rumors/opinions and postgame recaps cannot become pregame input facts.
3. Fit player and replacement effects only on preceding seasons. Do not substitute
   current strength estimates, eventual starter labels or final participation.
4. Compare news-enabled and news-disabled models on identical later games and, where
   available, same-time market prices. Report missing-news coverage separately and never
   select only games where news made a prediction correct.
5. Report Brier/log loss, directional accuracy and uncertainty clustered by week.
   Multiple candidates and repeatedly studied historical seasons remain exploratory.
6. Require untouched prospective validation before promotion. Three illustrative games
   can audit facts and illustrate reasoning; they cannot validate a predictive effect.

Existing prospective QB latency modules measure quote movement, not causal news effects
or a trained winner model. Existing manually reviewed roster context does not adjust
probabilities. This prototype does not replace either.
