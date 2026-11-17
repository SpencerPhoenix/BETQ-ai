# Injury source coverage audit

The read-only audit runs daily at 12:40 UTC, on relevant pull requests, or by
manual dispatch. GitHub schedule execution can be delayed or skipped. It reads
only the checked-out `data/nfl_injuries.json`: no provider, API key, paid quota,
team-site scraper, artifact mutation, model adjustment or betting is involved.
Run locally with `node scripts/audit-injury-coverage.mjs`. The bounded JSON
report and GitHub step summary distinguish source-file freshness from team-week
record presence, including an explicit league-wide zero-record warning for
candidate fixture weeks. An output SHA-256 identifies the audited input bytes.

A successful workflow means the diagnostic completed, **not** that injury
coverage is sufficient. Read `status`, `reasons`, `weeks`, and usable counts.
Missing reports early in a week may be expected; they still mean unknown, not
healthy. The audit does not manufacture missing player rows or fail the build
merely because a report has not yet been published. Invalid artifacts fail.

Candidate games come from the injury artifact's date-only fixture list within
NFL Eastern-calendar today through 14 days ahead. They are not verified official kickoff times
or pregame eligibility. Old fixture dates are excluded, and no candidates
produces an explicit gap. The separate official schedule/capture gates remain
unchanged. `RECORD_PRESENCE_ONLY` never asserts complete roster coverage,
per-player freshness, verified starters or an injury-adjusted model.

## Verified source constraints, November 17, 2026

- nflverse injury CSV release metadata was updated at 07:01:22 UTC. The fetched
  current-season file contained 3,168 rows, Weeks 1–10 only, zero Week 11 rows
  across the league. BETQ's retained artifact source vintage was November 16
  17:00:35 UTC. Refreshing that vintage alone cannot fill Week 11 gaps.
- nflverse documents daily 07:00 UTC injury updates:
  https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html . Its data
  repository distributes under CC BY 4.0; this is not an independent clearance
  of all upstream rights. Existing authorized pipeline is unchanged.
- BALLDONTLIE documents injury access on ALL-STAR/GOAT, not free; separate
  game player designations require GOAT. Existing key presence is not proof of
  entitlement, suitable timestamps or redistribution rights. No request or
  subscription was made: https://nfl.balldontlie.io/ .
- Sleeper's official docs allow free non-commercial API use and require direct
  licensing discussions for commercial use. It is not wired as a commercial
  BETQ fallback: https://docs.sleeper.com/ .
- Texans website terms restrict systematic retrieval/compilation absent written
  permission. Official links may be offered for human reference, but player
  tables are not automatically ingested:
  https://www.houstontexans.com/news/houston-texans-website-terms-conditions .

Next coverage step: obtain an appropriately licensed structured source with
verified access and timestamp semantics, or await genuinely new records from
the existing permitted source. Keep practice participation, game designations,
inactives and confirmed starters distinct. Do not lift model safety gates
because source-file metadata advanced.
