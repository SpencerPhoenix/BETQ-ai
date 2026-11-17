# Practice context and matchup coverage (research only)

## Source rights checkpoint

Reviewed 2026-11-17. Texans website terms at https://www.houstontexans.com/news/houston-texans-website-terms-conditions restrict systematic retrieval/compilation without prior written consent, and commercial harvesting. This change **does not ingest or automatically fetch** Texans/Colts articles and includes no copied player table. Two exact Week 11 source URLs are navigational links only. No claim that links independently corroborate the retained feed.

The existing nflverse distribution's https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md is Attribution 4.0 International. That is distribution-level licensing, not a representation that upstream third-party permissions have been independently cleared. Existing attribution is retained; no new source or expanded collection is introduced.

## Behavior

`/api/injuries/nfl?gameId=2026_11_IND_HOU` separates global source freshness from presence of exact season/team/week records. BOTH_TEAM_WEEK_RECORDS does not mean complete rosters, current practice, confirmed starters or inactives. The response preserves unknown publication/observation timestamps instead of inventing them. Existing source timestamp means file freshness only.

Optional participation rows retain practice participation (DNP/LP/FP/NOT_REPORTED), game designation, and inactive status separately. Practice type remains NOT_VERIFIED: nflverse fields alone do not distinguish walkthrough estimates from physical practice. Missing or unknown practice is NOT_REPORTED; DNP is never OUT, FP never confirms starting. Existing OUT/DOUBTFUL/QUESTIONABLE flags stay unchanged. No model, probabilities, provider, scheduler or forecast gates change.

## Deployment sequence and remaining gap

Compiler participation emission is **opt-in and disabled by default**. Existing collector remains byte-format compatible with old production. Deploy and verify new reader/UI first; only then authorize a separately tested collector migration (`includeParticipation:true`) and require a NEW source vintage. Same-vintage report changes are correctly rejected by the existing feed anti-regression guard. Do not relax it.

This patch does not fill absent IND/HOU Week 11 rows or claim lineup-adjusted probability. Missing data remains visible. Authorized official receipt ingestion and a rights-reviewed source are separate follow-up work. No paid odds requests, bets, deployment or live source data edits.
