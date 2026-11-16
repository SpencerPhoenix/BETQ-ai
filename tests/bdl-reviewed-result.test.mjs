import test from 'node:test';
import assert from 'node:assert/strict';
import {isReviewedBdlSettlement,isDescriptivelyQualifiedSettlement,describeReviewedSettlement,reviewedResultDigest,BDL_REVIEWED_RESULT_POLICY} from '../src/bdl-reviewed-result.mjs';
import {isSourceCorroboratedSettlement,OUTCOME_SCORING_POLICY} from '../src/settlement-qualification.mjs';
import {reviewedBdlFixture} from './fixtures/bdl-reviewed-result.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {validateRetainedJournal,createJournalEvidenceFeed} from '../src/evidence-journal-feed.mjs';

test('operator-reviewed native final has a distinct descriptive cohort, never aggregate V2 qualification',()=>{
  const {result,snapshot}=reviewedBdlFixture(),before=JSON.stringify(result);
  assert.equal(isReviewedBdlSettlement(result,snapshot),true);
  assert.equal(isDescriptivelyQualifiedSettlement(result,snapshot),true);
  assert.equal(isSourceCorroboratedSettlement(result,snapshot),false);
  const view=describeReviewedSettlement(result,snapshot);
  assert.equal(view.policyId,BDL_REVIEWED_RESULT_POLICY);assert.equal(view.aggregateScoringEligible,false);
  for(const key of ['sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified'])assert.equal(view[key],false);
  assert.doesNotMatch(JSON.stringify(view),/Sha256|providerGameId|body|receipt/);
  assert.equal(JSON.stringify(result),before);
  const old=syntheticScoringJournal(1,1);
  assert.equal(isDescriptivelyQualifiedSettlement(old.settlements[0],old.snapshots[0]),true);
  assert.equal(describeReviewedSettlement(old.settlements[0],old.snapshots[0]).policyId,OUTCOME_SCORING_POLICY);
});

test('strict field allowlists reject extras, omissions, private bytes and optimistic flags',()=>{
  const {result,snapshot}=reviewedBdlFixture();
  for(const path of [[],['nativeFinalObservation'],['communityScoreObservation'],['review']]){
    for(const mode of ['extra','missing']){
      const r=structuredClone(result);let node=r;for(const key of path)node=node[key];
      if(mode==='extra')node.rawBody='forbidden';else delete node[Object.keys(node)[0]];
      assert.equal(isReviewedBdlSettlement(r,snapshot),false,path.join('.')+mode);
    }
  }
  for(const key of ['sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified',
    'sourceAuthenticityIndependentlyVerified','providerPublicationTimeVerified','qualifiesForAggregateScoring']){
    const r=structuredClone(result);r[key]=true;assert.equal(isReviewedBdlSettlement(r,snapshot),false,key);
  }
});

for(const [name,mutate] of [
  ['policy',r=>r.policyId='SOURCE_CORROBORATED_SETTLEMENT_V2'],['source',r=>r.source='NFLVERSE_SCHEDULES'],
  ['snapshot binding',r=>r.review.firstFrozenSnapshotSha256='a'.repeat(64)],['snapshot ID',r=>r.review.firstFrozenSnapshotId='later'],
  ['result hash',r=>r.resultHash='a'.repeat(24)],['receipt hash',r=>r.review.receiptSha256='BAD'],
  ['repository',r=>r.review.githubRepository='other/repo'],['run URL',r=>r.review.githubRunUrl+='?token=secret'],
  ['commit',r=>r.review.githubCommitSha='a'.repeat(39)],['native mapping',r=>r.nativeFinalObservation.providerGameId=0],
  ['team mapping',r=>r.nativeFinalObservation.providerHomeTeamId=r.nativeFinalObservation.providerAwayTeamId],
  ['native home',r=>r.nativeFinalObservation.home='NYG'],['native kickoff',r=>r.nativeFinalObservation.providerScheduledKickoff='2026-11-08T18:05:00.000Z'],
  ['native status',r=>r.nativeFinalObservation.statusState='in'],['contradictory final',r=>r.nativeFinalObservation.status='Halftime'],
  ['community score',r=>r.communityScoreObservation.homeScore++],['community status invented',r=>r.communityScoreObservation.explicitFinalStatusObserved=true],
  ['season phase',r=>r.nativeFinalObservation.postseason=true],['future receipt',r=>r.nativeFinalObservation.collectorRetrievedAt='2026-11-09T18:04:00.000Z'],
  ['stale receipt',r=>r.communityScoreObservation.collectorRetrievedAt='2026-11-09T17:02:59.999Z'],
  ['24h delay',r=>{r.verifiedAt=r.review.recordedAt='2026-11-09T17:59:59.999Z';}],
  ['updated after retrieval',r=>r.nativeFinalObservation.providerRecordUpdatedAt='2026-11-10T00:00:00.000Z'],
  ['recorded time',r=>r.review.recordedAt='2026-11-09T18:02:00.000Z'],
])test('reviewed-result validator rejects '+name,()=>{
  const {result,snapshot}=reviewedBdlFixture();mutate(result);
  assert.equal(isReviewedBdlSettlement(result,snapshot),false);assert.equal(describeReviewedSettlement(result,snapshot),null);
});

test('all new observation times are rejected after reader clock rollback',async()=>{
  const {journal,result,now}=reviewedBdlFixture();journal.settlements.push(result);
  validateRetainedJournal(journal,now);
  for(const path of [['nativeFinalObservation','collectorRetrievedAt'],['nativeFinalObservation','providerRecordUpdatedAt'],
    ['communityScoreObservation','collectorRetrievedAt'],['review','recordedAt']]){
    const j=structuredClone(journal);j.settlements.at(-1)[path[0]][path[1]]='2099-01-01T00:00:00.000Z';
    assert.throws(()=>validateRetainedJournal(j,now),/FUTURE_OR_INVALID_OBSERVATION_TIME/);
  }
  let clock=now;const feed=createJournalEvidenceFeed({fallbackJournal:journal,clock:()=>clock,fetchImpl:null});
  assert.ok(await feed.get());clock=Date.parse(result.verifiedAt)-1;
  assert.equal(feed.peekSnapshot().journal,null);assert.equal(await feed.get(),null);
});

test('canonical snapshot digest is order independent but rejects non-JSON records',()=>{
  assert.equal(reviewedResultDigest({b:2,a:1}),reviewedResultDigest({a:1,b:2}));
  for(const value of [undefined,NaN,()=>{},new Date(),{get a(){return 1;}},new Array(2),Object.assign([],{extra:true})])assert.throws(()=>reviewedResultDigest(value));
});

// Shape-valid assertions must never bypass their immutable journal bindings.
for(const [name,mutate] of [
  ['prior digest',f=>f.result.review.retainedResultSha256='f'.repeat(64)],
  ['all snapshots digest',f=>f.result.review.allFrozenSnapshotsSha256='f'.repeat(64)],
  ['missing prior binding',f=>f.result.review.retainedResultSha256=null],
  ['revision gap',f=>f.result.revision+=1],
  ['rewritten prior',f=>f.journal.settlements[0].verifiedAt='2026-11-09T18:00:00.000Z'],
])test(`direct published reviewed append rejects ${name} before grading or feed adoption`,async()=>{
  const f=reviewedBdlFixture(),baseline=structuredClone(f.journal);mutate(f);
  assert.equal(isReviewedBdlSettlement(f.result,f.snapshot),true,'adversary passes isolated record shape');
  f.journal.settlements.push(f.result);
  assert.throws(()=>validateRetainedJournal(f.journal,f.now),/REVIEWED_BDL_HISTORY_BINDING_MISMATCH/);
  const {gradeRetainedGames}=await import('../src/game-grading.mjs');
  assert.equal(gradeRetainedGames(f.journal,{now:f.now}).available,false);
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>f.now,
    fetchImpl:async()=>new Response(JSON.stringify(f.journal))});
  await feed.get();assert.deepEqual(feed.peekSnapshot().journal,baseline);
  assert.equal(feed.status().lastError,'PUBLIC_JOURNAL_UNAVAILABLE_OR_INVALID');
});

test('valid public reviewed append is adopted, but native mappings cannot change in later direct revisions',async()=>{
  const f=reviewedBdlFixture(),baseline=structuredClone(f.journal);f.journal.settlements.push(f.result);
  const feed=createJournalEvidenceFeed({fallbackJournal:baseline,clock:()=>f.now,
    fetchImpl:async()=>new Response(JSON.stringify(f.journal))});
  await feed.get();assert.deepEqual(feed.peekSnapshot().journal,f.journal);assert.equal(feed.status().lastError,null);
  for(const key of ['providerGameId','providerHomeTeamId','providerAwayTeamId']){
    const j=structuredClone(f.journal),next=structuredClone(f.result);
    next.revision++;next.review.retainedResultSha256=reviewedResultDigest(f.result);
    next.review.receiptSha256='b'.repeat(64);next.nativeFinalObservation[key]+=100;
    j.settlements.push(next);
    assert.equal(isReviewedBdlSettlement(next,f.snapshot),true);
    assert.throws(()=>validateRetainedJournal(j,f.now),/REVIEWED_BDL_NATIVE_MAPPING_CONFLICT/);
  }
});
