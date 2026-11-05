/** Offline checkpoint preparation/verification. No fetching or data writes. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';
import {unambiguousFrozenGameIds} from '../src/settlement-qualification.mjs';

export const DIRECTORY='docs/checkpoints/2026-11-05-elo';
export const TRIAL_ID='betq-2026-11-05-pending-elo-v1';
export const REPOSITORY='SpencerPhoenix/BETQ-ai';
export const SOURCE_COMMIT='607366752c0d32410caf23fc068335acb06f858e';
export const HISTORICAL_COMMIT='11abbcb9859059e34b7a0dadc7d661565b658bd1';
export const INPUT_DIGESTS=Object.freeze({
  'plan.md':'fe750559c4d9d91eb81daea827448fdaa8f6b02186adb5756dfdabf434fbf325',
  'source-journal.json':'94625a292147c8806fe9a66af2df58cc6b081f1b2f04d8387887d4e39d4d5441',
  'jax-bal-historical-model.json':'a741d7e748ff00f9530a9d60c1f669007f1a2d1163705ff41aa74e9e4e375c9e',
  'jax-bal-historical-scorer.mjs':'e354d3ed4bd76ca6be6ca1caf57a84507ac3b2740b7348e4abff6c690fe931d4',
  'evening-historical-model.json':'4bf3c3fb72b7e4289206974e314ad5acfa552a6d320b5645a4bb47feccebcf98',
  'evening-historical-scorer.mjs':'52d868e664a48d28ef6354b65402f7baedbb689c82f836991205b6c4af3dfbcb',
  'evening-historical-integrity.mjs':'031aadc2fe489be8e8cabd8b25e051b17c67e10b8b76c7eba131043ff1aebccf'
});
export const sha256=text=>createHash('sha256').update(text).digest('hex');
const gitBlob=text=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');
export const canonical=value=>JSON.stringify(value&&typeof value==='object'?
  Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):
    Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
const utc=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const compare=(a,b)=>a.capturedAt<b.capturedAt?-1:a.capturedAt>b.capturedAt?1:a.id<b.id?-1:a.id>b.id?1:0;
function validateInputs(inputs){
  for(const [name,expected] of Object.entries(INPUT_DIGESTS))
    if(typeof inputs[name]!=='string'||sha256(inputs[name])!==expected)throw Error('CHECKPOINT_INPUT_HASH_MISMATCH: '+name);
}
export async function readCheckpointInputs(){
  return Object.fromEntries(await Promise.all(Object.keys(INPUT_DIGESTS).map(async name=>[
    name,await readFile(new URL('../'+DIRECTORY+'/'+name,import.meta.url),'utf8')])));
}
export function freezePendingCohort(journal,preparedAt){
  if(!utc(preparedAt))throw Error('INVALID_PREPARATION_TIME');
  const now=Date.parse(preparedAt);
  recomputeJournalEvidence(journal,now);
  const unambiguous=unambiguousFrozenGameIds(journal.snapshots),byGame=new Map();
  const settled=new Set(journal.settlements.map(r=>r.gameId));
  for(const s of journal.snapshots){
    if(Date.parse(s.commenceTime)<=now)continue;
    if(settled.has(s.gameId))throw Error('UPCOMING_GAME_ALREADY_HAS_RESULT');
    if(!unambiguous.has(s.gameId)||!utc(s.commenceTime)||Date.parse(s.capturedAt)>now)
      throw Error('UNTRUSTED_FROZEN_GAME');
    const previous=byGame.get(s.gameId);
    if(!previous||compare(s,previous)<0)byGame.set(s.gameId,s);
  }
  return [...byGame.values()].sort((a,b)=>a.commenceTime.localeCompare(b.commenceTime)||a.gameId.localeCompare(b.gameId))
    .map(s=>({gameId:s.gameId,snapshotId:s.id,snapshotSha256:sha256(canonical(s)),
      home:s.home,away:s.away,gameDate:s.gameDate,frozenKickoff:s.commenceTime,capturedAt:s.capturedAt,
      modelVersion:s.modelVersion,modelBuiltAt:s.modelBuiltAt,homeProbability:s.modelHomeProbability,
      derivedMarketReference:{homeProbability:s.marketHomeProbability,asOf:s.marketNewestQuoteAt,
        basis:s.marketBasis,currentOdds:false,rawQuoteReconstructionAvailable:false},
      challengerIncluded:false}));
}
export async function prepareCheckpoint(inputs,preparedAt,{existingTrialIds=[]}={}){
  validateInputs(inputs);
  if(existingTrialIds.includes(TRIAL_ID))throw Error('DUPLICATE_TRIAL');
  const journal=JSON.parse(inputs['source-journal.json']),cohort=freezePendingCohort(journal,preparedAt);
  if(cohort.length!==29||cohort[0]?.gameId!=='2026_09_JAX_BAL'||
    cohort[0].frozenKickoff!=='2026-11-06T01:15:00.000Z')throw Error('FIXED_COHORT_WINDOW_CLOSED_OR_CHANGED');
  // Load only hash-verified source bytes. The evening scorer's sole relative
  // dependency is bound to the exact archived helper bytes, not current code.
  const uri=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
  const morning=await import(uri(inputs['jax-bal-historical-scorer.mjs']));
  const helperUri=uri(inputs['evening-historical-integrity.mjs']);
  const evening=await import(uri(inputs['evening-historical-scorer.mjs'].replace(
    "from './integrity.mjs'", "from '"+helperUri+"'")));
  const bindings=[
    {id:'nov2-morning',commit:HISTORICAL_COMMIT,scorer:morning,modelFile:'jax-bal-historical-model.json',
      scorerFile:'jax-bal-historical-scorer.mjs',helperFile:null},
    {id:'nov2-evening',commit:'d5e84e936fd98dc3b334c1a02e74138b743ed594',scorer:evening,
      modelFile:'evening-historical-model.json',scorerFile:'evening-historical-scorer.mjs',
      helperFile:'evening-historical-integrity.mjs'}
  ].map(b=>({...b,artifact:JSON.parse(inputs[b.modelFile])}));
  const replayRecords=cohort.map(selected=>{
    const snapshot=journal.snapshots.find(s=>s.id===selected.snapshotId);
    const matches=bindings.filter(b=>b.artifact.generatedAt===snapshot.modelBuiltAt);
    if(matches.length!==1)throw Error('MISSING_HISTORICAL_MODEL_BINDING');
    const b=matches[0],names=Object.fromEntries(Object.entries(b.scorer.NFL_TEAMS).map(([name,code])=>[code,name]));
    const inferenceInput={home_team:names[snapshot.home],away_team:names[snapshot.away],commence_time:snapshot.commenceTime};
    const replay=b.scorer.predictNflEvent(inferenceInput,b.artifact,Date.parse(snapshot.capturedAt));
    if(!replay.available||replay.homeWinProbability!==selected.homeProbability||
      replay.modelBuiltAt!==snapshot.modelBuiltAt||replay.throughGameDate!==snapshot.modelLastResultDate)
      throw Error('HISTORICAL_REPLAY_MISMATCH');
    return {gameId:selected.gameId,snapshotId:selected.snapshotId,bindingId:b.id,
      historicalCommit:b.commit,modelFile:b.modelFile,scorerFile:b.scorerFile,helperFile:b.helperFile,
      inferenceInput,replayClock:snapshot.capturedAt,homeProbability:replay.homeWinProbability};
  });
  const selected=cohort[0],jaxReplay=replayRecords[0];
  const snapshot=journal.snapshots.find(s=>s.id===selected.snapshotId);
  if(snapshot.challengerHomeProbability!=null)throw Error('JAX_FIRST_SNAPSHOT_HAS_UNEXPECTED_CHALLENGER');
  const verifierText=await readFile(new URL(import.meta.url),'utf8');
  return {schema:1,trialId:TRIAL_ID,preparedAt,
    verificationScript:{path:'scripts/pregame-checkpoint.mjs',sha256:sha256(verifierText)},
    purpose:'FIXED_COHORT_PREGAME_COMMITMENT_AND_OPERATIONAL_TRIAL',
    source:{repository:REPOSITORY,commit:SOURCE_COMMIT,journalPath:'data/evidence/nfl-2026.json',
      journalSha256:INPUT_DIGESTS['source-journal.json'],observedPublicationRun:42056770119,
      publicBytesObservedNoLaterThan:'2026-11-05T15:37:40.000Z',
      publicationReceiptUrl:'https://github.com/'+REPOSITORY+'/actions/runs/42056770119'},
    selection:{rule:'ALL_PENDING_UPCOMING_GAMES_IN_PINNED_JOURNAL_FIRST_ELO_SNAPSHOT',
      cohortSize:cohort.length,cohortSha256:sha256(canonical(cohort)),closedMembership:true,
      laterSnapshotsReplaceSelection:false,laterChallengersMayBeAdded:false,
      historicalResultsIncluded:false,missingOrPostponedGames:'RETAIN_AND_REPORT_SEPARATELY_NEVER_SUBSTITUTE',
      ties:'RETAIN_AND_REPORT_SEPARATELY_NO_BINARY_SCORE',duplicateGameCounting:false},
    cohort,
    inputSha256:INPUT_DIGESTS,
    inferenceReplay:{count:replayRecords.length,records:replayRecords,
      neutralSiteArgument:'OMITTED_DEFAULT_FALSE',originalEventPayloadArchived:false,
      originalDeployedScorerIdentityVerified:false,trainingReproduced:false,
      exactRoundedProbabilitiesReproduced:true},
    jaxBalPublicationExample:{gameId:selected.gameId,snapshotId:selected.snapshotId,
      historicalCommit:HISTORICAL_COMMIT,homeProbability:jaxReplay.homeProbability,
      originalFirstSnapshotHasChallenger:false,
      observedPublicationRun:41370765405,observedPublicationJob:125040545250,
      publicBytesObservedNoLaterThan:'2026-11-02T01:07:32.000Z',
      publicationReceiptUrl:'https://github.com/'+REPOSITORY+'/actions/runs/41370765405'},
    checkpointPublication:{verified:false,requiredBefore:cohort[0].frozenKickoff,
      requirement:'SUCCESSFUL_GITHUB_SERVER_TIMESTAMPED_RUN_BOUND_TO_EXACT_PUBLISHED_BUNDLE',
      preparedAtIsPublicationProof:false},
    safeguards:{researchOnly:true,sourceIndependenceVerified:false,qualifyingOutcomesAdded:0,
      existingJournalOrMetricMembershipChanged:false,settlementGateChanged:false,
      wageringAuthorized:false,profitabilityEstablished:false,
      postgameComparison:'SEPARATE_AUTHORIZATION_REQUIRED_CROSS_CHECKED_INDEPENDENCE_UNVERIFIED_ONLY',
      currentOddsOrExecutablePriceClaim:false}};
}
export async function verifyPreparedCheckpoint(manifest,inputs){
  const expected=await prepareCheckpoint(inputs,manifest?.preparedAt);
  if(!isDeepStrictEqual(manifest,expected))throw Error('CHECKPOINT_MANIFEST_MISMATCH');
  return {valid:true,trialId:manifest.trialId,cohortSize:29,publicationVerified:false,qualifyingOutcomesAdded:0};
}
/**
 * Check bindings of separately retrieved GitHub API receipts. This cannot
 * authenticate caller-supplied JSON; the caller must retrieve it from GitHub.
 */
export async function validatePublicationReceipt({manifestText,inputs,run,commit,tree}){
  const manifest=JSON.parse(manifestText);await verifyPreparedCheckpoint(manifest,inputs);
  const before=Date.parse(manifest.checkpointPublication.requiredBefore),after=Date.parse(manifest.preparedAt);
  if(run?.repository?.full_name!==REPOSITORY||run.event!=='pull_request'||run.run_attempt!==1||
    run.status!=='completed'||run.conclusion!=='success'||!Number.isSafeInteger(run.id)||run.id<=0||
    run.html_url!=='https://github.com/'+REPOSITORY+'/actions/runs/'+run.id||
    !/^[a-f0-9]{40}$/.test(commit?.sha||'')||run.head_sha!==commit.sha||
    !Number.isFinite(Date.parse(run.created_at))||!Number.isFinite(Date.parse(run.updated_at))||
    Date.parse(run.created_at)<after||Date.parse(run.updated_at)<Date.parse(run.created_at)||
    Date.parse(run.updated_at)>=before||tree?.truncated!==false||tree.sha!==commit.tree?.sha||!Array.isArray(tree.tree))
    throw Error('INVALID_OR_LATE_PUBLICATION_RECEIPT');
  const verifierText=await readFile(new URL(import.meta.url),'utf8');
  const verifierEntries=tree.tree.filter(f=>f.path===manifest.verificationScript.path&&f.type==='blob'&&f.mode==='100644');
  if(verifierEntries.length!==1||verifierEntries[0].sha!==gitBlob(verifierText))throw Error('PUBLISHED_VERIFIER_BINDING_MISMATCH');
  const files={'manifest.json':manifestText,...inputs};
  for(const [name,text] of Object.entries(files)){
    const entries=tree.tree.filter(f=>f.path===DIRECTORY+'/'+name&&f.type==='blob'&&f.mode==='100644');
    if(entries.length!==1||entries[0].sha!==gitBlob(text))throw Error('PUBLISHED_BUNDLE_BINDING_MISMATCH');
  }
  return {status:'CONSISTENT_WITH_PREGAME_GITHUB_RECEIPT',authenticationVerifiedByThisFunction:false,
    manifestSha256:sha256(manifestText),commit:commit.sha,runId:run.id,
    qualifyingOutcomesAdded:0,sourceIndependenceVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const inputs=await readCheckpointInputs();
  if(process.argv[2]==='--prepare')console.log(JSON.stringify(await prepareCheckpoint(inputs,new Date().toISOString()),null,2));
  else if(process.argv[2]==='--verify')console.log(JSON.stringify(await verifyPreparedCheckpoint(
    JSON.parse(await readFile(new URL('../'+DIRECTORY+'/manifest.json',import.meta.url),'utf8')),inputs)));
  else throw Error('Use --prepare (stdout only) or --verify. No publication or network operation is supported.');
}
