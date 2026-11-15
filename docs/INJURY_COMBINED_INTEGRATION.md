# Injury fix integrated into the combined local candidate

## Exact inputs and scope

- Combined base: `c1417e68326d41974d8fe8d4a67fe941a5d088b1`.
- Injury source commit: `f2c262aab7f15e0abec944ee5c446e4f07918e01`.
- Local integrated cherry-pick: `e389ba0`.
- Isolated branch: `fix/combined-injury-delivery-local`.

The original combined worktree remains clean at its original base. No remote ref, pending publication, production service, provider or credential was changed.

## Conflicts and resolution

1. `package.json`: kept every combined syntax check, added only `src/injury-feed.mjs`. Dependency declarations and lockfile are unchanged.
2. `src/server.mjs`: retained `getOdds(..., { allowPaid: paidPermission(req) })`; inserted the injury artifact read after that admission and before the analysis clock. Unauthenticated or cached-only admission failures therefore cannot initiate an odds purchase or injury read.

The auto-merged injury module retained the combined candidate's strict `scheduledInstant` guard. Server model calls retain raw event data and neutral-site handling. A small integration refinement evaluates injury status once per health response, preventing inconsistent availability fields when a clock crosses the freshness boundary.

## Verification

- **690 offline tests passed**, zero failures/skips.
- All syntax checks and whitespace checks passed.
- Four new integration tests confirm paid-intent/authentication/cache-only admission, zero-budget denial, post-read kickoff reevaluation and single-observation health metadata.
- Independent review passed 21 focused injury/API/integration tests and an additional mocked integration probe. No blocking findings remained.
- Compared against the exact combined base: existing `data/`, workflows, public assets, lockfile, odds/budget, schedule, source-receipt and Elo files remain unchanged. Existing policy/wagering protections remain intact.

The new worktree initially lacked `pg`, so the first suite attempt had a missing-dependency failure. An offline clean install could not find the cached `xtend` tarball. No network install was attempted: existing installed dependencies were copied from the qualified-receipts checkout only after its package-lock was verified byte-identical. `npm ls` confirms `pg@8.23.1`; the complete suite then passed. This is not a claim that a clean registry install was tested in this worktree.

## Remaining release limits

This is a tested local integration, not a deployed repair. Actual browser/mobile QA and release/publication approval remain outstanding. Reports remain source-file-freshness context, not individually timestamped availability, verified starters or injury-adjusted predictions. No provider refresh was performed.
