# November 15 retained-evidence append regression

`append.json` pins only the 24 publicly retained snapshots added after the
November 14 fixture, from main commit
`1bfc9afe9ebd056c53b90ab8aeab8e9a1a2f6967`. No results were added. Combining
these records with the unchanged November 14 fixture reconstructs 347 snapshots,
44 games and 18 results. The fixture records the original journal SHA-256.

Seven games acquired retained 18:00 versus 18:05 kickoff conflicts. Together with
the existing LV–SF conflict, eight games (92 snapshots and one result) must stay
quarantined. The regression checks all retained times, excludes these games from
rankings and scoring, and verifies that current capture admission still rejects
new conflicting captures. It never chooses or corrects a kickoff or rewrites
operational evidence. This historical fixture is not current coverage.
