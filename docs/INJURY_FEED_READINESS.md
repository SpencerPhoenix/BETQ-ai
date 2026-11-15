# Injury artifact delivery repair

## Diagnosis verified November 7, 2026

Production revision `6073667` loads `data/nfl_injuries.json` once at process startup. It contains source vintage November 4 at 15:21:18 UTC and 244 team/week reports. At November 7, 23:30 UTC that file exceeds the existing 72-hour freshness limit.

Current main `69ca969eeef474b379a0b8bc729a1cdde348dc6e` already contains a successful refresh from commit `0594661`: source vintage November 7 at 13:53:57 UTC, built at 16:30:28.940 UTC, 272 team/week reports. The earlier November 6 workflow failure (run 42262595076, release metadata HTTP 403) does not establish a continuing source outage or its cause. No retry of that upstream request was attempted here.

The actionable failure is delivery: the newer retained injury file does not reach the old deployed process. Unlike the evidence journal, injuries had no independent retained-artifact reader. Health/config also claimed availability merely because a bundled file existed, even after the injury endpoint rejected its age.

## Local implementation

- The standard `startServer` path supplies a bounded reader for one fixed public BETQ repository JSON URL. It never calls nflverse, odds, scores or an injury provider; it accepts no caller-selected URL or credentials, follows no redirect, writes no disk and publishes nothing.
- Reads occur on injury API requests and live NFL moneyline card analysis, not passive health checks or demo. Concurrent reads share one request; success and failure have a minimum one-minute cache, normally five minutes. Each request has a ten-second timeout and 1.5 MB streaming cap. HTTP failures keep the retained artifact and expose only a sanitized error and numeric HTTP status, not response bodies.
- A strict artifact boundary validates season/team/week identity, source/build/expiry timestamps, fixture identities, bounded player lists and counts. Unknown fields and malformed records are rejected. Source vintage/build regression is rejected; equal-vintage report changes cannot overwrite retained reports. Same-source fixture changes with a later build are allowed without extending expiry.
- Health, configuration, injury API and card context share the source-file freshness calculation. Refresh time and build time never substitute for source time. An expired retained file stays unavailable after a failed refresh. The API distinguishes source age, expiry, last delivery attempt/success and delivery failure.
- `createHandler` defaults to a retained-only feed for injected/embedded usage. Such callers must explicitly supply a network feed if desired. The actual `startServer` path enables the fixed repository reader. Tests inject a mock or retained-only reader and make no external request.
- Card analysis takes its evaluation clock after the artifact read, so waiting for the free read cannot retain a pre-kickoff or stale-quote evaluation time.

## Real retained fixtures and tests

`tests/fixtures/injuries/` contains losslessly gzipped existing repository artifacts from November 4 and November 7, with original SHA-256 hashes, upstream source URLs and source/build times in `manifest.json`. No source was downloaded and no artifact's timestamps or reports were changed. These are public nflverse-derived reports with their retained attribution (CC BY 4.0), not newly collected medical information. Publication/licensing review remains part of a future release.

The tests replay stale deployment → fresh retained source, concurrent reads, HTTP 403 without an immediate retry or alternate route, malformed/future/oversized responses, rollback and same-vintage mutation, exact freshness expiry, absent game reports, API/card/health agreement and immutable returned copies. HTTP tests use loopback and an injected cached slate; they do not contact an odds provider. A synthetic card kickoff is explicit test plumbing, not a new claim about the retained schedule.

## Remaining real-data constraints

This repairs delivery of already-published reports. It does not repair or bypass upstream access restrictions, initiate a source refresh, or establish real-time injury completeness. A valid source file can contain earlier weekly observations. Per-player timestamps are absent in both real fixtures; the API explicitly reports source-file freshness only and exposes no invented player timestamp. Missing team/week reports never mean healthy. Reported quarterbacks are not confirmed starters, and probabilities remain unchanged.

A future release still needs explicit publication/deployment approval, integration with the other candidate changes and actual browser/mobile QA. No workflow, credential, production setting, model artifact, evidence journal or existing injury dataset was changed by this repair. Do not deploy this old-main-based branch wholesale in place of the newer safety candidates; integrate its focused changes and rerun the combined suite.

## Final local verification

- 272 offline tests passed, zero failures/skips; 17 focused injury/feed/API tests passed.
- Syntax checks and `git diff --check` passed.
- Independent review found and verified fixes for future-season cache poisoning and a mixed dated/undated aggregate timestamp. The former now rejects before replacing healthy data; the latter remains null while true per-player timestamps remain on their individual records. No material findings remained in the final reviewed changes.
- Existing `data/` and workflows were unchanged. Integration/browser/deployment checks were not performed or claimed.
