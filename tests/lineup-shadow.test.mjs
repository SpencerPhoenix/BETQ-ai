import test from 'node:test';import assert from 'node:assert/strict';
import {makeQBCandidateNews,reviewQBCandidate} from '../src/shadow-latency.mjs';
import {freezeReviewedQbFeatures} from '../src/lineup-shadow.mjs';
const now=Date.parse('2026-11-16T18:00:00.000Z');
const event={eventId:'synthetic-game',homeTeam:'Home',awayTeam:'Away',kickoffAt:'2026-11-17T01:15:00.000Z'};
function source(status='OUT',observed=now-60000,reviewed=now-30000){
 const c=makeQBCandidateNews({eventId:event.eventId,team:'Home',qbName:'Synthetic QB',status,sourceKind:'NFL_OFFICIAL',sourceUrl:'https://www.nfl.com/news/synthetic',kickoffAt:event.kickoffAt,sourcePublishedAt:'2026-11-15T18:00:00.000Z'},{observedAt:observed});
 const r=reviewQBCandidate(c,{reviewerId:'synthetic-reviewer',reviewedAt:reviewed,sourceEvidenceDigest:'a'.repeat(64)});return {c,r};
}
test('freezes source-bound categorical features, not probability or starter certainty',()=>{
 const {c,r}=source(),input={event,candidates:[c],reviews:[r]},before=JSON.stringify(input),v=freezeReviewedQbFeatures(input,{now});
 assert.equal(v.sides.home.reportedCounts.OUT,1);assert.equal(v.sides.away.coverage,'UNKNOWN');assert.equal(v.sides.home.starterIdentityVerified,false);
 assert.equal(v.probabilityAdjustment,null);assert.equal(v.modelPromotionAllowed,false);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(freezeReviewedQbFeatures(input,{now}),v);
});
test('old publisher date cannot make late observation or review available earlier',()=>{
 for(const [o,r] of [[now+1000,now+2000],[now-60000,now+1000]]){
  const x=source('OUT',o,r),v=freezeReviewedQbFeatures({event,candidates:[x.c],reviews:[x.r]},{now});assert.equal(v.sides.home.coverage,'UNKNOWN');
 }
});
test('genuinely newer observations supersede, equal-time contradictory statuses stay unknown',()=>{
 const a=source('QUESTIONABLE'),b=source('OUT',now-10000,now-5000);
 let v=freezeReviewedQbFeatures({event,candidates:[a.c,b.c],reviews:[a.r,b.r]},{now});assert.equal(v.sides.home.reportedCounts.OUT,1);
 const c=source('OUT');v=freezeReviewedQbFeatures({event,candidates:[a.c,c.c],reviews:[a.r,c.r]},{now});
 assert.equal(v.sides.home.coverage,'CONFLICTED');assert.equal(v.sides.home.reported.length,0);
});
test('identity conflicts, unreviewed sources and altered candidate hashes do not enter features',()=>{
 const x=source();let v=freezeReviewedQbFeatures({event:{...event,kickoffAt:'2026-11-17T02:00:00.000Z'},candidates:[x.c],reviews:[x.r]},{now});assert.equal(v.sides.home.coverage,'UNKNOWN');
 v=freezeReviewedQbFeatures({event,candidates:[x.c]},{now});assert.equal(v.sides.home.coverage,'UNKNOWN');
 x.c.status='STARTER_CONFIRMED';v=freezeReviewedQbFeatures({event,candidates:[x.c],reviews:[x.r]},{now});assert.equal(v.sides.home.coverage,'UNKNOWN');
});
test('duplicate immutable records are idempotent; mutations fail',()=>{
 const x=source();assert.equal(freezeReviewedQbFeatures({event,candidates:[x.c,x.c],reviews:[x.r,x.r]},{now}).sides.home.reported.length,1);
 assert.throws(()=>freezeReviewedQbFeatures({event,candidates:[x.c,{...x.c,status:'QUESTIONABLE'}],reviews:[x.r]},{now}),/MUTATED/);
 assert.throws(()=>freezeReviewedQbFeatures({event,candidates:[x.c],reviews:[x.r,{...x.r,reviewerId:'other'}]},{now}),/CONFLICTING/);
});
test('postkickoff or invalid freeze scope rejected',()=>{
 assert.throws(()=>freezeReviewedQbFeatures({event},{now:Date.parse(event.kickoffAt)}),/SCOPE/);
 assert.throws(()=>freezeReviewedQbFeatures({event:{...event,homeTeam:'Away'}},{now}),/SCOPE/);
});
