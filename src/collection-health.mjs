/** A deployed journal is evidence of a past capture, never proof a scheduler is alive. */
import {retainedJournalProjection} from './evidence-journal-feed.mjs';
export function collectionHealthFromJournal(journal,now=Date.now(),publication=null) {
  const times=Array.isArray(journal?.snapshots) ? journal.snapshots.map(row=>Date.parse(row?.capturedAt)) : [];
  const valid=times.filter(at=>Number.isFinite(at)&&Number.isFinite(now)&&at<=now);
  const latest=valid.length?Math.max(...valid):null;
  let quarantine=null;
  try{quarantine=retainedJournalProjection(journal,now).quarantine;}catch{/* Invalid retained input never becomes a safe projection. */}
  return {
    state:'COLLECTOR_HEALTH_UNKNOWN',
    latestAttemptStatus:'NOT_OBSERVED_BY_WEB_SERVICE',
    lastKnownCaptureAt:latest===null?null:new Date(latest).toISOString(),
    lastKnownCaptureAgeSeconds:latest===null?null:Math.floor((now-latest)/1000),
    source:publication?.source==='PUBLIC_JOURNAL'?'PUBLIC_JOURNAL':'BUNDLED_JOURNAL',
    journalSha256:typeof publication?.journalSha256==='string'?publication.journalSha256:null,
    lastSuccessfulJournalReadAt:publication?.lastSuccessfulFetchAt||null,
    liveFreshnessVerified:false,
    starvationVerified:false,
    quarantine,
    warning:'A retained journal read does not establish collector health. Check the latest scheduled run for skipped or zero eligible captures.'
  };
}

// Compatibility for callers explicitly inspecting a bundled artifact.
export function collectionHealthFromBundledJournal(journal,now=Date.now()){
  return collectionHealthFromJournal(journal,now);
}
