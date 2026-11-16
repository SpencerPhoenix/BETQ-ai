import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {reviewedBdlFixture} from './fixtures/bdl-reviewed-result.mjs';
import {BDL_REVIEWED_RESULT_POLICY,reviewedResultDigest,isReviewedBdlSettlement} from '../src/bdl-reviewed-result.mjs';
import {gradeRetainedGames} from '../src/game-grading.mjs';
import {buildGameDossier} from '../src/game-dossier.mjs';
import {recomputeJournalEvidence} from '../src/evidence-journal-feed.mjs';
import {isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';

const ui=vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/game-grades.js',import.meta.url),'utf8'),ui);
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const segment=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
vm.runInContext(readFileSync(new URL('../public/retained-forecasts.js',import.meta.url),'utf8')+
  segment('  const esc =','  const persist =')+segment('  // Dossiers are read only','  async function loadRetainedGames()')+
  'globalThis.dossier={validDossier,dossierHTML};',ui);
function bind(f){
  f.result.review.firstFrozenSnapshotSha256=reviewedResultDigest(f.snapshot);
  f.result.review.allFrozenSnapshotsSha256=reviewedResultDigest([...f.journal.snapshots].sort((a,b)=>
    a.capturedAt.localeCompare(b.capturedAt)||(a.id<b.id?-1:a.id>b.id?1:0)));
  return f;
}
function views(f=reviewedBdlFixture()){
  assert.equal(isReviewedBdlSettlement(f.result,f.snapshot),true);
  f.journal.settlements.push(f.result);
  const before=JSON.stringify(f.journal),grades=gradeRetainedGames(f.journal,{now:f.now}),
    dossier=buildGameDossier(f.journal,{gameId:f.snapshot.gameId,now:f.now});
  assert.equal(JSON.stringify(f.journal),before);
  assert.equal(grades.available,true);assert.equal(dossier.available,true);
  return {...f,grades,dossier,game:grades.games[0]};
}
test('reviewed BDL has one distinct descriptive cohort, identical model metrics and no V2 promotion',()=>{
  const f=reviewedBdlFixture(),before=recomputeJournalEvidence(f.journal,f.now),v=views(f),after=recomputeJournalEvidence(v.journal,v.now);
  assert.equal(v.game.status,'GRADED');assert.equal(v.dossier.result.scoringEligible,true);
  assert.deepEqual(v.game.metrics,v.dossier.result.metrics);
  assert.ok(Math.abs(v.game.metrics.modelBrier-.16)<1e-12);
  assert.ok(Math.abs(v.game.metrics.modelLogLoss+Math.log(.6))<1e-12);
  assert.equal(v.game.metrics.modelCorrect,true);
  assert.equal(v.game.result.sourceCorroborated,false);assert.equal(isSourceCorroboratedSettlement(v.result,v.snapshot),false);
  assert.equal(v.game.result.aggregateScoringEligible,false);assert.equal(v.dossier.result.qualification,'REVIEWED_BDL_SEPARATE_DESCRIPTIVE_COHORT');
  assert.deepEqual(v.game.result.qualificationDetails,v.dossier.result.qualificationDetails);
  assert.equal(v.grades.coverage.reviewedBdlGradedGames,1);assert.equal(v.grades.coverage.sourceCorroboratedV2GradedGames,0);
  assert.equal(after.quarantine.rawResultCount,before.quarantine.rawResultCount+1);
  assert.deepEqual({...after,quarantine:before.quarantine},before,'reviewed metadata changes only the raw revision count, not V2 summary');
  assert.equal(ui.BETQGameGrades.valid(v.grades),true);assert.equal(ui.dossier.validDossier(v.dossier,'gameId',v.snapshot.gameId),true);
});
test('missing oldest quote leaves model metrics but no market metrics in either surface',()=>{
  const f=reviewedBdlFixture();delete f.snapshot.marketOldestQuoteAt;const v=views(bind(f));
  for(const metric of ['marketBrier','marketLogLoss','marketCorrect','brierImprovement'])assert.equal(v.game.metrics[metric],null);
  assert.equal(v.game.status,'GRADED');assert.deepEqual(v.game.metrics,v.dossier.result.metrics);
  const table=ui.BETQGameGrades.html(v.grades),detail=ui.dossier.dossierHTML(v.dossier);
  assert.match(table,/Market log loss: Not scored/);assert.match(detail,/Market Brier \/ log loss<\/dt><dd>Not scored \/ Not scored/);
  for(const rendered of [table,detail])for(const label of ['BDL native final + nflverse score agreement','BALLDONTLIE_NFLVERSE_REVIEWED',BDL_REVIEWED_RESULT_POLICY,
    'Operator-reviewed, not independently authenticated','Source independence unverified','not official league certification','provider publication time unverified'])assert.ok(rendered.includes(label),label);
});
test('BDL output projects only allowed review facts and never provider IDs, bodies or receipt digests',()=>{
  const v=views(),serialized=JSON.stringify({grades:v.grades,dossier:v.dossier});
  for(const hidden of ['nativeFinalObservation','communityScoreObservation','receiptSha256','ledgerEntrySha256','encryptedArtifactSha256',
    'bodySha256','providerGameId','providerHomeTeamId','providerAwayTeamId',v.result.review.receiptSha256,v.result.review.ledgerSha256])assert.ok(!serialized.includes(hidden),hidden);
  assert.equal(v.game.result.qualificationDetails.githubRunUrl,v.result.review.githubRunUrl);
  assert.equal(v.game.result.qualificationDetails.sourceAuthenticityIndependentlyVerified,false);
});
test('a later eligible capture never replaces the original incomplete model baseline',()=>{
  const f=reviewedBdlFixture(),later={...f.snapshot,id:'later-model',capturedAt:'2026-11-07T12:01:00.000Z'};
  delete f.snapshot.modelLastResultDate;f.journal.snapshots.push(later);const v=views(bind(f));
  assert.equal(v.game.baselineSnapshotId,f.snapshot.id);assert.equal(v.dossier.result.baselineSnapshotId,f.snapshot.id);
  assert.equal(v.game.status,'UNGRADED');assert.equal(v.game.metrics,null);assert.equal(v.dossier.result.metrics,null);
  assert.equal(v.dossier.latestSnapshot.eligibility.model,true);assert.equal(v.dossier.result.scoringEligible,false);
  assert.equal(v.grades.coverage.reviewedBdlGradedGames,0);assert.equal(ui.dossier.validDossier(v.dossier,'gameId',v.snapshot.gameId),true);
});
test('same-time snapshots preserve codepoint ID baseline regardless of input ordering',()=>{
  for(const reverse of [false,true]){
    const f=reviewedBdlFixture();f.snapshot.id='A-first';f.result.review.firstFrozenSnapshotId=f.snapshot.id;
    f.journal.snapshots.push({...f.snapshot,id:'z-last',modelHomeProbability:.9});if(reverse)f.journal.snapshots.reverse();
    const v=views(bind(f));assert.equal(v.game.baselineSnapshotId,'A-first');assert.equal(v.dossier.result.baselineSnapshotId,'A-first');
    assert.ok(Math.abs(v.game.metrics.modelBrier-.16)<1e-12);
  }
});
test('reviewed 50/50 model retains losses but never fabricates a directional pick',()=>{
  const f=reviewedBdlFixture();f.snapshot.modelHomeProbability=.5;const v=views(bind(f));
  assert.equal(v.game.metrics.modelCorrect,null);assert.equal(v.game.metrics.modelBrier,.25);
  assert.match(ui.BETQGameGrades.html(v.grades),/Model: No directional pick/);
  assert.match(ui.dossier.dossierHTML(v.dossier),/Model direction<\/dt><dd>No directional pick/);
});
test('reviewed ties are visible but excluded from both per-game metric displays',()=>{
  const f=reviewedBdlFixture({prior:false});
  for(const r of [f.result,f.result.nativeFinalObservation,f.result.communityScoreObservation])r.awayScore=27;
  f.result.outcome='TIE';f.result.resultHash=createHash('sha256').update(f.snapshot.gameId+'|27|27').digest('hex').slice(0,24);
  const v=views(f);assert.equal(v.game.status,'TIE_EXCLUDED');assert.equal(v.game.metrics,null);assert.equal(v.dossier.result.metrics,null);
  assert.equal(v.dossier.result.scoringEligible,false);assert.equal(ui.BETQGameGrades.valid(v.grades),true);
});
test('attempting to attach a reviewed result to a kickoff conflict fails the full journal closed',()=>{
  const f=reviewedBdlFixture();f.journal.snapshots.push({...f.snapshot,id:'later-conflict',capturedAt:'2026-11-07T12:01:00.000Z',commenceTime:'2026-11-08T18:20:00.000Z'});
  bind(f);f.journal.settlements.push(f.result);
  const grades=gradeRetainedGames(f.journal,{now:f.now}),dossier=buildGameDossier(f.journal,{gameId:f.snapshot.gameId,now:f.now});
  assert.equal(grades.available,false);assert.equal(grades.reason,'INVALID_RETAINED_JOURNAL');
  assert.equal(dossier.available,false);assert.equal(dossier.reason,'INVALID_RETAINED_JOURNAL');
});
test('eight bundled real kickoff quarantines and frozen histories remain unchanged',()=>{
  const j=JSON.parse(readFileSync(new URL('../data/evidence/nfl-2026.json',import.meta.url),'utf8')),before=JSON.stringify(j),now=Date.parse('2026-11-17T00:00:00Z');
  const grades=gradeRetainedGames(j,{now}),quarantined=grades.games.filter(g=>g.status==='SCHEDULE_CONFLICT_QUARANTINED');
  assert.equal(quarantined.length,8);
  for(const g of quarantined)assert.equal(buildGameDossier(j,{gameId:g.gameId,now}).reason,'SCHEDULE_CONFLICT_QUARANTINED');
  assert.equal(JSON.stringify(j),before);
});
test('newer unqualified result cannot fall back to an older reviewed grade',()=>{
  const f=reviewedBdlFixture();f.journal.settlements.push(f.result);
  f.journal.settlements.push({...f.journal.settlements[0],revision:3,verifiedAt:'2026-11-10T18:00:00.000Z'});
  const grades=gradeRetainedGames(f.journal,{now:f.now}),dossier=buildGameDossier(f.journal,{gameId:f.snapshot.gameId,now:f.now});
  assert.equal(grades.games[0].result.revision,3);assert.equal(grades.games[0].metrics,null);assert.equal(dossier.result.metrics,null);
});
test('both clients reject false independent, official or aggregate reviewed-result claims',()=>{
  const v=views();
  for(const key of ['aggregateScoringEligible','sourceIndependenceVerified','officialLeagueCertification','historicalAsOfVerified','sourceAuthenticityIndependentlyVerified','providerPublicationTimeVerified']){
    const grades=structuredClone(v.grades),dossier=structuredClone(v.dossier);
    grades.games[0].result.qualificationDetails[key]=true;dossier.result.qualificationDetails[key]=true;
    assert.equal(ui.BETQGameGrades.valid(grades),false,key);assert.equal(ui.dossier.validDossier(dossier,'gameId',v.snapshot.gameId),false,key);
  }
  for(const mutate of [r=>r.sourceCorroborated=true,r=>r.source='NFLVERSE_SCHEDULES',r=>r.qualificationDetails.policyId='SOURCE_CORROBORATED_SETTLEMENT_V2',r=>r.qualificationDetails=null]){
    const grades=structuredClone(v.grades),dossier=structuredClone(v.dossier);mutate(grades.games[0].result);mutate(dossier.result);
    assert.equal(ui.BETQGameGrades.valid(grades),false);assert.equal(ui.dossier.validDossier(dossier,'gameId',v.snapshot.gameId),false);
  }
});
test('cohort counts and dossier metric/baseline contradictions fail closed',()=>{
  const f=reviewedBdlFixture();delete f.snapshot.marketOldestQuoteAt;const v=views(bind(f));
  for(const changes of [{reviewedBdlGradedGames:0},{sourceCorroboratedV2GradedGames:1},{reviewedBdlGradedGames:undefined,sourceCorroboratedV2GradedGames:undefined}]){
    const d=structuredClone(v.grades);Object.assign(d.coverage,changes);assert.equal(ui.BETQGameGrades.valid(d),false);
  }
  for(const mutate of [r=>r.metrics=null,r=>r.metrics.modelBrier=null,r=>r.metrics.marketBrier=0,r=>r.baselineSnapshotId='later']){
    const d=structuredClone(v.dossier);mutate(d.result);assert.equal(ui.dossier.validDossier(d,'gameId',v.snapshot.gameId),false);
  }
});
