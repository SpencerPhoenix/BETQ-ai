// Fabricated retained kickoff conflict for offline UI contract tests only.
export function quarantineFixture({games=0,snapshots=0,results=0}={}){
  return {policy:'FROZEN_SCHEDULE_CONFLICT_QUARANTINE_V1',historyPreserved:true,
    rawGameCount:games+1,rawSnapshotCount:snapshots+2,rawResultCount:results+1,
    excludedGameCount:1,excludedSnapshotCount:2,excludedResultCount:1,
    games:[{gameId:'synthetic-conflict',season:2026,home:'HOME',away:'AWAY',gameDate:'2026-11-08',
      reason:'CONFLICTING_RETAINED_KICKOFFS',firstFrozenSnapshotId:'synthetic-first',
      firstFrozenCommenceTime:'2026-11-08T18:00:00.000Z',
      observedCommenceTimes:['2026-11-08T18:00:00.000Z','2026-11-08T21:00:00.000Z'],
      snapshotCount:2,resultCount:1,scoringEligible:false,collectionEligible:false}]};
}
