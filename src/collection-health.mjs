/** A deployed journal is evidence of a past capture, never proof a scheduler is alive. */
export function collectionHealthFromBundledJournal(journal,now=Date.now()) {
  const times=Array.isArray(journal?.snapshots) ? journal.snapshots.map(row=>Date.parse(row?.capturedAt)) : [];
  const valid=times.filter(at=>Number.isFinite(at)&&Number.isFinite(now)&&at<=now);
  const latest=valid.length?Math.max(...valid):null;
  return {
    state:'COLLECTOR_HEALTH_UNKNOWN',
    latestAttemptStatus:'NOT_OBSERVED_BY_WEB_SERVICE',
    lastKnownCaptureAt:latest===null?null:new Date(latest).toISOString(),
    lastKnownCaptureAgeSeconds:latest===null?null:Math.floor((now-latest)/1000),
    source:'BUNDLED_JOURNAL',
    liveFreshnessVerified:false,
    starvationVerified:false,
    warning:'This deployed journal may lag the current collector. Check the latest scheduled run for skipped or zero eligible captures.'
  };
}
