// Fabricated in-memory unit fixtures only; no official game-page observation occurs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyJournal,summarizeEvidence} from '../src/evidence.mjs';
import {withSyntheticCorroboration} from './fixtures/source-corroborated.mjs';
import {isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {emptyOfficialScoreReviewLedger,officialReviewTarget,appendOfficialScoreReview,
  validateOfficialScoreReviewLedger,summarizeOfficialScoreReviews,assertOfficialScoreReviewExtension,officialReviewDigest} from '../src/official-score-review.mjs';
const AT='2026-11-12T12:00:00.000Z',LATER='2026-11-12T13:00:00.000Z';
function setup(){
  const journal=emptyJournal(2026);journal.provenance.syntheticFixture=true;
  journal.snapshots=[{id:'synthetic-frozen',gameId:'2026_09_LV_KC',providerEventId:'synthetic-provider-id',season:2026,home:'KC',away:'LV',gameDate:'2026-11-10',
    commenceTime:'2026-11-10T18:00:00.000Z',capturedAt:'2026-11-09T12:00:00.000Z',sourceReceivedAt:'2026-11-09T11:59:59.000Z',
    modelBuiltAt:'2026-11-09T11:00:00.000Z',modelVersion:'SYNTHETIC_ONLY',modelLastResultDate:'2026-11-08',modelHomeProbability:.6,
    marketHomeProbability:.55,marketNewestQuoteAt:'2026-11-09T11:59:58.000Z',marketOldestQuoteAt:'2026-11-09T11:59:57.000Z',marketBookCount:4,
    marketBasis:'NO_VIG_MULTI_BOOK_MEDIAN',researchOnly:true,independentModel:true}];
  journal.settlements=[{gameId:'2026_09_LV_KC',gameDate:'2026-11-10',homeScore:24,awayScore:17,outcome:'HOME',source:'NFLVERSE_SCHEDULES',
    resultHash:'a'.repeat(24),verifiedAt:'2026-11-11T20:00:00.000Z',revision:1}];
  const ledger=emptyOfficialScoreReviewLedger(journal),target=officialReviewTarget(journal,journal.snapshots[0].gameId);
  return {journal,ledger,target};
}
function receipt(observedAt=AT){return {method:'INTERACTIVE_AGENT_PAGE_INSPECTION',observations:[{
  url:'https://www.nfl.com/schedules/2026/by-week/week-9',pageType:'SCHEDULE',observedAt,season:2026,gameDate:'2026-11-10',
  gameDateBasis:'SOURCE_GAME_DATE_NOT_PUBLICATION_DATE',home:'KC',away:'LV',sourceHomeLabel:'Kansas City Chiefs',sourceAwayLabel:'Las Vegas Raiders',
  scoreClaim:{homeScore:24,awayScore:17},finalStatus:'FINAL'}]};}
const append=(s,r=receipt(),recordedAt=AT)=>appendOfficialScoreReview(s.ledger,s.journal,{gameId:s.target.gameId,expectedResultSha256:s.target.resultSha256,receipt:r,recordedAt},{clock:()=>Date.parse(recordedAt)});
function resignEntry(e){const {entrySha256,...body}=e;return {...body,entrySha256:officialReviewDigest(body)};}

test('A valid metadata review appends evidence without touching forecasts, settlements or scoring cohort',()=>{
  const s=setup(),before=structuredClone(s.journal),summary=summarizeEvidence(s.journal,Date.parse(AT));
  const out=append(s);assert.equal(out.added,true);assert.equal(out.evidenceRevision,1);assert.equal(out.scoringEligible,false);
  assert.deepEqual(s.journal,before);assert.equal(s.ledger.entries.length,0);
  assert.deepEqual(summarizeEvidence(s.journal,Date.parse(AT)),summary);
  const e=out.ledger.entries[0];assert.equal(e.target.originalResultVerifiedAt,'2026-11-11T20:00:00.000Z');assert.equal(e.recordedAt,AT);
  assert.equal(e.flags.sourceContentSha256,null);assert.equal(e.flags.historicalAsOfVerified,false);
  assert.equal(e.flags.originalSourceArchiveVerified,false);assert.equal(e.flags.sourceUpstreamIndependenceVerified,false);
  assert.equal(isSourceCorroboratedSettlement(e,s.journal.snapshots[0]),false);
  const report=summarizeOfficialScoreReviews(out.ledger,s.journal);assert.equal(report.matchingManualReviews,1);assert.equal(report.qualifiedOutcomes,0);
  assert.equal(report.activation,'DISABLED');assert.equal(report.sourceUseAuthorization,'NOT_ESTABLISHED');
});
test('Same score hash can receive a new evidence revision; exact repeated observation is idempotent',()=>{
  const s=setup();s.ledger=append(s).ledger;
  const repeated=append(s,receipt(),LATER);assert.equal(repeated.added,false);assert.equal(repeated.ledger.entries.length,1);
  const next=append(s,receipt(LATER),LATER);assert.equal(next.added,true);assert.equal(next.evidenceRevision,2);
  assert.equal(next.ledger.entries[0].target.resultHash,next.ledger.entries[1].target.resultHash);
  assert.equal(next.ledger.entries[1].previousGameEntrySha256,next.ledger.entries[0].entrySha256);
  assert.equal(s.journal.settlements.length,1);assertOfficialScoreReviewExtension(s.ledger,next.ledger,s.journal);
});
test('Metadata digest proves metadata only; caller cannot add invented source-body hashes or qualification',()=>{
  for(const [key,value] of [['sourceContentSha256','f'.repeat(64)],['scoringEligible',true],['sourcePublishedAt',AT],['sourceIndependenceVerified',true]]){
    const s=setup(),r=receipt();r[key]=value;assert.throws(()=>append(s,r),/UNEXPECTED_OR_MISSING_FIELDS/);
  }
});
test('Separate score and explicit final references can corroborate the same ordered score pair',()=>{
  const s=setup(),r=receipt();r.observations[0].scoreClaim=null;
  r.observations.push({...receipt().observations[0],url:'https://www.nfl.com/news/synthetic-unit-fixture-not-real',pageType:'RECAP',finalStatus:null});
  assert.equal(append(s,r).added,true);
});
for(const [name,mutate] of [
  ['missing final',r=>r.observations[0].finalStatus=null],['missing score',r=>r.observations[0].scoreClaim=null],
  ['nonterminal',r=>r.observations[0].finalStatus='IN_PROGRESS'],['article score not final',r=>{r.observations[0].pageType='GAME_REPORT';r.observations[0].finalStatus=null;}],
  ['empty claims',r=>{r.observations[0].scoreClaim=null;r.observations[0].finalStatus=null;}],
  ['wrong home score',r=>r.observations[0].scoreClaim.homeScore=17],['reversed score',r=>r.observations[0].scoreClaim={homeScore:17,awayScore:24}],
  ['fractional score',r=>r.observations[0].scoreClaim.homeScore=24.5],['string score',r=>r.observations[0].scoreClaim.homeScore='24'],
  ['wrong team',r=>r.observations[0].home='SEA'],['ambiguous displayed team',r=>r.observations[0].sourceHomeLabel='Kansas'],
  ['swapped displayed team',r=>r.observations[0].sourceHomeLabel='Las Vegas Raiders'],['wrong game date',r=>r.observations[0].gameDate='2026-11-11'],
  ['wrong season',r=>r.observations[0].season=2025],['publication date as game date',r=>r.observations[0].gameDateBasis='PAGE_PUBLISHED_DATE'],
  ['duplicate source',r=>r.observations.push(structuredClone(r.observations[0]))],['prior audit not observation',r=>r.method='PRIOR_AUDIT_REFERENCE']
])test('Reject '+name,()=>{const s=setup(),r=receipt();mutate(r);assert.throws(()=>append(s,r));assert.equal(s.ledger.entries.length,0);});
for(const url of ['http://www.nfl.com/schedule','https://nfl.com.evil.test/schedule','https://www.nfl.com@evil.test/schedule',
  'https://www.nfl.com:444/schedule','https://www.nfl.com/schedule?token=secret','https://www.nfl.com/schedule#final',
  'https://www.nfl.com/has space','https://api.nfl.com/game','https://www.jaguars.com/schedule/'])
  test('Reject unauthorized or ambiguous URL '+url,()=>{const s=setup(),r=receipt();r.observations[0].url=url;assert.throws(()=>append(s,r));});
test('Human and interactive agent review methods remain distinct; automatic collector method rejects',()=>{
  const s=setup(),r=receipt();r.method='HUMAN_PAGE_INSPECTION';assert.equal(append(s,r).ledger.entries[0].receipt.method,'HUMAN_PAGE_INSPECTION');
  r.method='AUTOMATED_SCRAPER';assert.throws(()=>append(s,r),/INVALID_REVIEW_RECEIPT/);
});
for(const [observed,recorded] of [['2026-11-12T12:00:00.001Z',AT],['2026-11-12T10:59:59.999Z',AT],
  ['2026-11-10T20:00:00.000Z','2026-11-10T20:00:00.000Z'],['2026-11-11T19:00:00.000Z','2026-11-11T19:00:00.000Z'],
  ['2026-11-12T12:00:00Z',AT]])test('Reject stale, future, premature or noncanonical review '+observed,()=>assert.throws(()=>append(setup(),receipt(observed),recorded)));
test('New recorded time cannot launder stale source observations into a fresh evidence revision',()=>{
  const s=setup();s.ledger=append(s).ledger;const r=receipt();r.observations[0].url='https://www.nfl.com/news/different-fixture';
  assert.throws(()=>append(s,r,'2026-11-12T14:00:00.000Z'),/STALE_OR_FUTURE_REVIEW/);
});
test('Evidence revision cannot backdate behind prior review, even within one hour',()=>{
  const s=setup();s.ledger=append(s).ledger;const r=receipt('2026-11-12T11:59:00.000Z');
  assert.throws(()=>append(s,r,'2026-11-12T12:01:00.000Z'),/BACKDATED_EVIDENCE_REVISION/);
});
test('Result concurrency binding rejects a new settlement; prior reviews become superseded, not silently transferred',()=>{
  const s=setup();s.ledger=append(s).ledger;s.journal.settlements.push({...s.journal.settlements[0],revision:2,verifiedAt:'2026-11-12T12:30:00.000Z'});
  assert.throws(()=>append(s,receipt(LATER),LATER),/RESULT_CHANGED_REVIEW_AGAIN/);
  assert.equal(summarizeOfficialScoreReviews(s.ledger,s.journal).rows[0].disposition,'REVIEW_SUPERSEDED_BY_SETTLEMENT_REVISION');
  s.target=officialReviewTarget(s.journal,s.target.gameId);assert.equal(append(s,receipt(LATER),LATER).evidenceRevision,2);
});
test('Changed score requires a newly inspected matching receipt; unchanged old score cannot pass',()=>{
  const s=setup();s.ledger=append(s).ledger;s.journal.settlements.push({...s.journal.settlements[0],homeScore:25,resultHash:'b'.repeat(24),revision:2,verifiedAt:'2026-11-12T12:30:00.000Z'});
  s.target=officialReviewTarget(s.journal,s.target.gameId);assert.throws(()=>append(s,receipt(LATER),LATER),/OFFICIAL_SCORE_DISAGREEMENT/);
});
test('Baseline deletion, rewritten result, changed frozen probability and ambiguous identities fail',()=>{
  for(const mutate of [s=>s.journal.snapshots=[],s=>s.journal.settlements[0].homeScore=26,s=>s.journal.snapshots[0].modelHomeProbability=.9]){
    const s=setup();mutate(s);assert.throws(()=>append(s));
  }
  const s=setup();s.journal.snapshots.push({...s.journal.snapshots[0],id:'changed',home:'SEA'});assert.throws(()=>append(s),/AMBIGUOUS/);
});
test('Hash chain detects edit/reorder; previous-ledger comparison detects truncation',()=>{
  const s=setup();const one=append(s).ledger;s.ledger=one;const two=append(s,receipt(LATER),LATER).ledger;
  const changed=structuredClone(two);changed.entries[0].recordedAt=LATER;assert.throws(()=>validateOfficialScoreReviewLedger(changed,s.journal),/INVALID_REVIEW_CHAIN/);
  const reordered=structuredClone(two);reordered.entries.reverse();assert.throws(()=>validateOfficialScoreReviewLedger(reordered,s.journal));
  assert.throws(()=>assertOfficialScoreReviewExtension(two,one,s.journal),/REVIEW_HISTORY_CHANGED/);
  assertOfficialScoreReviewExtension(one,two,s.journal);
});
test('Rehashing eligibility flags still cannot activate the versioned ledger',()=>{
  const s=setup(),l=append(s).ledger;l.entries[0].flags.scoringEligible=true;l.entries[0]=resignEntry(l.entries[0]);
  assert.throws(()=>validateOfficialScoreReviewLedger(l,s.journal),/INVALID_REVIEW_CHAIN/);
  l.activation='ACTIVE';assert.throws(()=>validateOfficialScoreReviewLedger(l,s.journal),/INVALID_LEDGER/);
});
test('Official review cannot use an ambiguous/reused provider identity or a non-nflverse settlement',()=>{
  const s=setup();s.journal.snapshots.push({...s.journal.snapshots[0],id:'alias',gameId:'alias'});assert.throws(()=>officialReviewTarget(s.journal,s.target.gameId),/PROVIDER_IDENTITY_REQUIRES_REVIEW/);
  const z=setup();z.journal.settlements[0].source='OTHER';assert.throws(()=>officialReviewTarget(z.journal,z.target.gameId),/INVALID_RETAINED_RESULT/);
});
test('Retained real-data readiness makes no receipts and preserves byte-identical journal',()=>{
  const path=new URL('./fixtures/retained-20261114/nfl-2026.json',import.meta.url),bytes=readFileSync(path),j=JSON.parse(bytes),before=structuredClone(j);
  const ledger=emptyOfficialScoreReviewLedger(j),r=summarizeOfficialScoreReviews(ledger,j);
  assert.equal(r.evidenceRevisions,0);assert.equal(r.matchingManualReviews,0);assert.equal(r.qualifiedOutcomes,0);
  assert.equal(r.rawResultGames,j.settlements.length);assert.deepEqual(j,before);assert.deepEqual(readFileSync(path),bytes);
});
test('Append clock prevents matching far-future timestamps from pretending to be observed now',()=>{
  const s=setup();assert.throws(()=>appendOfficialScoreReview(s.ledger,s.journal,{gameId:s.target.gameId,expectedResultSha256:s.target.resultSha256,
    receipt:receipt('2099-01-01T00:00:00.000Z'),recordedAt:'2099-01-01T00:00:00.000Z'}),/APPEND_TIME_NOT_CURRENT/);
  assert.throws(()=>appendOfficialScoreReview(s.ledger,s.journal,{gameId:s.target.gameId,expectedResultSha256:s.target.resultSha256,receipt:receipt(),recordedAt:AT},
    {clock:()=>Date.parse(LATER)}),/APPEND_TIME_NOT_CURRENT/);
});
test('Replay validates original chronology without aging out a valid historical review',()=>{
  const s=setup(),l=append(s).ledger;assert.equal(validateOfficialScoreReviewLedger(l,s.journal),l);
});
test('Every entry binds its baseline; removing unrelated baseline history breaks existing entry hashes',()=>{
  const s=setup();s.journal.snapshots.push({...s.journal.snapshots[0],id:'other',gameId:'2026_09_JAX_SEA',home:'SEA',away:'JAX',providerEventId:'other-provider'});
  s.ledger=emptyOfficialScoreReviewLedger(s.journal);const l=append(s).ledger;
  s.journal.snapshots.pop();l.baseline.snapshots.pop();l.baselineSha256=officialReviewDigest(l.baseline);
  assert.throws(()=>validateOfficialScoreReviewLedger(l,s.journal),/INVALID_REVIEW_CHAIN/);
});
test('Duplicate or expanded baseline record shapes fail even if its top digest is recomputed',()=>{
  const s=setup();s.ledger.baseline.snapshots.push(structuredClone(s.ledger.baseline.snapshots[0]));s.ledger.baselineSha256=officialReviewDigest(s.ledger.baseline);
  assert.throws(()=>validateOfficialScoreReviewLedger(s.ledger,s.journal),/INVALID_BASELINE_SNAPSHOT/);
  const t=setup();t.ledger.baseline.snapshots[0].claimedProof=true;t.ledger.baselineSha256=officialReviewDigest(t.ledger.baseline);
  assert.throws(()=>validateOfficialScoreReviewLedger(t.ledger,t.journal),/UNEXPECTED_OR_MISSING_FIELDS/);
});
test('Unknown frozen teams are not legitimized by matching unknown displayed labels',()=>{
  const s=setup();s.journal.snapshots[0].home='NOTANFLTEAM';s.journal.snapshots[0].away='ALSONOT';
  assert.throws(()=>officialReviewTarget(s.journal,s.target.gameId),/INVALID_FROZEN_GAME/);
});
test('Frozen game ID encodes the actual season and home/away identities',()=>{
  const s=setup();s.journal.snapshots[0].gameId='2025_09_LV_KC';s.journal.settlements[0].gameId='2025_09_LV_KC';
  assert.throws(()=>officialReviewTarget(s.journal,'2025_09_LV_KC'),/INVALID_FROZEN_GAME_IDENTITY/);
});
test('Earliest capture uses existing code-point snapshot ID tie-break, never locale-dependent ordering',()=>{
  const s=setup(),base=s.journal.snapshots[0];s.journal.snapshots=[{...base,id:'a'},{...base,id:'A'}];
  assert.equal(officialReviewTarget(s.journal,s.target.gameId).frozenSnapshotId,'A');
});
test('Same exact event under distinct game/provider IDs is not an independent new target',()=>{
  const s=setup();s.journal.snapshots.push({...s.journal.snapshots[0],id:'new-alias',gameId:'2026_10_LV_KC',providerEventId:'different-provider'});
  assert.throws(()=>officialReviewTarget(s.journal,s.target.gameId),/AMBIGUOUS_EVENT_ALIAS/);
});

test('A separately qualifying V2 settlement retains its existing status; official review does not replace that policy',()=>{
  const s=setup(),shot=s.journal.snapshots[0];
  s.journal.settlements[0]=withSyntheticCorroboration({...s.journal.settlements[0],season:shot.season,home:shot.home,away:shot.away,commenceTime:shot.commenceTime},'2026-11-11T20:00:00.000Z');
  s.ledger=emptyOfficialScoreReviewLedger(s.journal);s.target=officialReviewTarget(s.journal,s.target.gameId);
  assert.equal(isSourceCorroboratedSettlement(s.journal.settlements[0],shot),true);
  const before=officialReviewDigest(s.journal);const out=append(s);
  assert.equal(isSourceCorroboratedSettlement(s.journal.settlements[0],shot),true);assert.equal(officialReviewDigest(s.journal),before);
  assert.equal(summarizeOfficialScoreReviews(out.ledger,s.journal).qualifiedOutcomes,0);
});
