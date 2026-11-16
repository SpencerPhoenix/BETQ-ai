// Fabricated derived review only. No actual provider response, receipt, or outcome.
import {createHash} from 'node:crypto';
import {syntheticBdlOutcomeInput} from './bdl-outcome-candidate.mjs';
import {assessBdlOutcomeCandidate} from '../../src/bdl-outcome-candidate.mjs';
import {emptyJournal} from '../../src/evidence.mjs';
import {BDL_REVIEWED_RESULT_POLICY,reviewedResultDigest} from '../../src/bdl-reviewed-result.mjs';
export function reviewedBdlFixture({prior=true}={}){
  const input=syntheticBdlOutcomeInput(),candidate=assessBdlOutcomeCandidate(input).candidate;
  const journal=input.journal;journal.provenance=emptyJournal(2026).provenance;
  const snapshot=journal.snapshots[0],identity=Object.fromEntries(['gameId','season','gameDate','home','away','commenceTime'].map(k=>[k,snapshot[k]]));
  const resultHash=createHash('sha256').update(snapshot.gameId+'|27|17').digest('hex').slice(0,24);
  if(prior)journal.settlements.push({...identity,source:'NFLVERSE_SCHEDULES',homeScore:27,awayScore:17,outcome:'HOME',
    revision:1,resultHash,verifiedAt:'2026-11-09T18:00:30.000Z'});
  const result={...identity,source:'BALLDONTLIE_NFLVERSE_REVIEWED',policyId:BDL_REVIEWED_RESULT_POLICY,
    homeScore:27,awayScore:17,outcome:'HOME',verifiedAt:input.evaluatedAt,revision:prior?2:1,resultHash,
    nativeFinalObservation:candidate.nativeFinalObservation,communityScoreObservation:candidate.communityScoreObservation,
    review:{firstFrozenSnapshotId:snapshot.id,firstFrozenSnapshotSha256:reviewedResultDigest(snapshot),
      receiptSha256:'1'.repeat(64),ledgerEntrySha256:'2'.repeat(64),ledgerSha256:'3'.repeat(64),encryptedArtifactSha256:'4'.repeat(64),
      retainedResultSha256:prior?reviewedResultDigest(journal.settlements[0]):null,allFrozenSnapshotsSha256:reviewedResultDigest(journal.snapshots),
      recordedAt:input.evaluatedAt,githubRepository:'SpencerPhoenix/BETQ-ai',githubRunId:'99999999999',githubCommitSha:'5'.repeat(40),
      githubRunUrl:'https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/99999999999'},
    researchOnly:true,qualifiesForAggregateScoring:false,sourceIndependenceVerified:false,officialLeagueCertification:false,
    historicalAsOfVerified:false,sourceAuthenticityIndependentlyVerified:false,providerPublicationTimeVerified:false};
  return {journal,snapshot,result,now:Date.parse('2026-11-16T12:00:00.000Z')};
}
