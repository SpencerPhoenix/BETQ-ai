# Manual private result sample

This is a **single-game compatibility and provenance review**, not an active grading
pipeline. Publishing this workflow does not run it. There is no schedule, push trigger,
production write, result correction, model promotion, paid odds request or wager.

## Run once from GitHub

1. A repository writer opens **Actions → BETQ manual private result sample → Run
   workflow**, selects `main`, and leaves `2026_09_NYG_PHI` for the first review.
2. The existing repository Actions secret `Balldontlie_api_key` is made available only
   to the collection step as `BALLDONTLIE_API_KEY`. Do not paste the key into an input,
   issue, log, chat, file or command argument. A missing key fails before transport.
3. Download the resulting `betq-private-result-sample-…` artifact for private review.
   It contains only `envelope.json` ciphertext and an allowlisted `summary.json`.

The workflow runs offline tests first. It permits only `main`, has read-only repository
permissions, disables persisted checkout credentials and serializes manual runs. It
does not retry requests or dispatch another workflow. Re-running a job is another
manual collection, not an automatic continuation of the first observation.

## Request budget and identity

After local validation, the collector fetches the fixed nflverse schedule release
URL. Up to two public HTTPS redirects are permitted, only to GitHub's named release
asset hosts; no provider authorization accompanies those requests. The decoded CSV
must be at most 4 MB. Only then does it make at most **two authenticated requests** to
`https://api.balldontlie.io/nfl/v1/games`: one date-list page of at most 100 games and
one native-ID detail. There is no pagination, alternate endpoint, redirect, retry,
historical odds query or subscription purchase. Requests have bounded header/body
timeouts and decoded-body limits. Compressed responses are bounded after decoding.

The provider's optional `next_cursor` is accepted as omitted only for a short final
page (fewer rows than a valid `per_page`). Explicit null also marks an end page.
Any continuation value, too many rows, malformed metadata or full page without an
end marker is rejected. `providerListState` reports only a fixed diagnostic label,
never provider-supplied field values. Original list bytes are retained unchanged in
a successful encrypted bundle; no missing cursor is inserted into the evidence.

The [BDL NFL documentation](https://nfl.balldontlie.io/#account-tiers) lists Games on
its free tier, at five requests per minute. The account's actual key validity and
entitlements still require a successful authorized response. No paid tier is needed
for this proposed Games-only sample and none is selected by this code.

The frozen journal and selected original forecast are checked before transport.
Kickoff must be at least 24 hours old, exact season/teams/kickoff must agree, native
IDs must be unambiguous, and the list/detail observations must match. Retained kickoff
conflicts remain quarantined. Cross-UTC-date targets are intentionally unsupported
for this first bounded proof; the default target avoids that ambiguity. Source and
mapping failures are reported, not repaired by changing retained identities.

## Private evidence and encryption

The collector prepares exact original response bytes, retrieval timestamps from the
runner's clock, SHA-256 digests, the frozen journal and the disabled receipt ledger
in memory. These are encrypted before any output file is written using a fresh
AES-256-GCM key wrapped to the repository's **public** review recipient with
RSA-OAEP-SHA256. The matching private key is retained separately by the reviewing
operator, never in this repository or Actions. The configured public recipient is
specific to this review; do not run after losing access to its private key. A new
recipient needs review and a verified private-key custodian before collection.

The public diagnostic file exposes only fixed status/error codes, bounded request
counts, false eligibility flags and ciphertext/key identifiers. It is not a score
report. Public GitHub artifacts must not be treated as private storage. Encryption
protects the response contents; it does not authenticate the provider independently,
prove upstream independence or create immutable archival custody. GitHub artifact
retention is **14 days**. Download, decrypt, replay-verify and retain an authorized
private copy before expiry. This implementation does not promise a managed archive
or claim any real receipt was collected merely because tests pass.

Failures can leave only a sanitized diagnostic file; failed preflight can leave no
artifact. Neither condition is a receipt. Private files must not be uploaded to
public issues or committed after decryption.

## What success does and does not prove

A successful run supplies a current, reviewable observation, not a historical
as-of-final record. Provider `updated_at` is not a final-publication timestamp. Matching
BDL/nflverse scores are not proof that the providers have independent upstream data.
The existing scoring policy still rejects these receipts. The public site, result
journal, frozen forecasts and quarantine are not changed.

Before activation: inspect a real decrypted sample and mapping, preserve private
receipts/checkpoints, resolve source-independence limitations honestly, and implement
a separately reviewed versioned writer/reader/scoring cohort. Missing paired-market
provenance and schedule conflicts cannot be repaired by obtaining a final score.

For local preparation/replay without any network, see
[the offline receipt guide](BDL_OFFLINE_RECEIPTS.md).

## Offline verification before publication

On November 15, 2026, syntax checks and all 1,138 tests passed locally with provider
credentials absent. This includes synthetic transport, ciphertext roundtrip/tamper,
private file handling, failure-before-network, immutable identity, and workflow
trigger tests. A valid 4 MB schedule prepares and replays under a 256 MB heap; the
shared parser also survives 12 MB adversarial inputs. These are engineering checks,
not an actual provider sample. Node 22 CI is verified separately on the release commit.
