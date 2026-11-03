# Settlement preparation, separated from publication

This development change does not authorize source use, collection, publication,
merging or deployment. It adds no automated publisher. The existing paid-odds
collector is separate and unchanged.

## Default behavior

- Pull requests and manual dispatch with the default `validate` operation run
  offline syntax and regression tests only. PRs no longer invoke live sources.
- The settlement workflow has no schedule, `contents: write`, persisted checkout
  credentials, Git commit, push, automatic rebase or reset-to-main step.
- Merely merging this workflow cannot schedule or publish settlement data.

## Explicit preparation, only after source-use approval

An authorized operator must select `prepare` on main, provide the reviewed full
40-character main SHA and explicitly confirm source-use authorization. This
checkbox records the operator's assertion; it does not establish licensing or
make an unofficial source authoritative. Do not select it without approval.

The preparation job checks out the dispatch SHA, requires it to match the supplied
SHA and freshly observed main, and reruns syntax and all tests on that actual
checkout. It repeats the clean-checkout and current-main checks immediately
before source requests. It never switches to a different untested revision.

The existing bounded two-source reconciler modifies only runner-local derived
files. The strict settlement-only guard rejects changed original forecasts,
deleted/reordered history, new season journals and unqualified result revisions.
Packaging rechecks main and rejects tracked changes outside the current season
journal and derived summary. A changed main invalidates preparation, requiring
review of a fresh baseline instead of automatic rebasing.

## Review artifact

The only uploaded files are `settlement-candidate.json` and its report. The bundle
contains the exact source commit, canonical preparation time, baseline journal
SHA-256, exact candidate journal text and SHA-256, regenerated summary text and
SHA-256, and append-only transition counts. It is labeled
`publicationAuthorized: false`. Source commit identity pins the complete baseline,
including its original summary. The summary is regenerated from the candidate at
the recorded preparation time rather than accepting an arbitrary changed file.

The report and workflow summary show the SHA-256 of the complete bundle. Retain
that digest with the specific reviewed run. The hash detects changes relative to
that externally retained value; it is not a publisher signature, source license,
trusted collector-clock attestation or proof of correct final scores.

No raw source responses, credentials or paid-provider data are archived. Tests
use fabricated records and temporary Git repositories, with no live providers.

## Separate future publication decision

There is no publication command or job in this workflow. Before a later approved
publication operation is implemented or performed:

1. Review the exact candidate, finality evidence, source-use rights and destination.
2. Obtain explicit publication approval for its SHA-256 and source commit.
3. Check out that source commit, rerun tests, independently verify current main is
   still exactly that commit, and verify the bundle using the externally retained
   digest. Never accept a digest merely recomputed from an untrusted bundle.
4. Use the fixed-path offline verifier with `EXPECTED_SOURCE_SHA` and
   `EXPECTED_CANDIDATE_SHA256` set to those reviewed values:
   `node scripts/settlement-candidate.mjs verify`. It reads the baseline from HEAD,
   verifies all bytes/metadata and reconstructs the summary and transition checks.
   It writes nothing and does not grant publication permission.
5. Any future publisher must recheck main immediately before a guarded
   fast-forward publication and refuse divergence. It must not rebase, silently
   recollect or substitute another candidate. Such a publisher is not included.

Verification passing does not mean the sample is statistically adequate. Current
performance thresholds and withheld under-threshold metrics remain unchanged.
