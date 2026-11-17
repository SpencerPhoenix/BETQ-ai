# Listed quarterback context

The game card and homepage now show the latest available nflverse listed QB1 for each team, separately from model predictions. It is **not confirmed starter status**, injury clearance, or a probability adjustment.

- Free source: nflverse depth charts, CC-BY-4.0; attribution is displayed.
- `sourceLoadAt` means the source loaded the chart, not when a club announced a change.
- `collectedAt` is when this collector received the source; compressed source bytes are SHA-256 hashed.
- Only a complete 32-team latest snapshot with unambiguous listed QB1 is published.
- Display expires 24 hours after source load or at kickoff, whichever is earlier. A failed refresh cannot extend freshness. Missing/stale remains unknown.
- The server reads a compact fixed public artifact, cached five minutes. It does not download the large upstream CSV for each user request.
- A separate manual/twice-daily GitHub workflow updates only this contextual artifact. No paid providers, credentials, predictions, or frozen grading records are modified.
- Depth charts can lag known starter changes. They must not be used as confirmed-starter labels or automatic model penalties. Injury data remains the existing separate feed and may lack matchup coverage.

This is data presentation infrastructure, not evidence of improved predictive accuracy. The publication schedule needs observation after merge; missed runs yield stale/unknown state rather than invented availability.
