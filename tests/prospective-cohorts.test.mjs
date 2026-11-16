import test from 'node:test';
import assert from 'node:assert/strict';
import {auditProspectiveCohorts} from '../src/prospective-cohorts.mjs';
import {syntheticScoringJournal} from './fixtures/source-corroborated.mjs';
import {emptyJournal} from '../src/evidence.mjs';
const now=Date.parse('2026-11-16T12:00:00Z');
const fixture=n=>({...syntheticScoringJournal(n,n),provenance:emptyJournal(2026).provenance});
test('classifies home and away underdogs symmetrically without outcome selection',()=>{
 const j=fixture(4);
 [[.7,.4],[.3,.6],[.7,.6],[.3,.4]].forEach(([p,q],i)=>Object.assign(j.snapshots[i],{modelHomeProbability:p,marketHomeProbability:q}));
 const before=JSON.stringify(j),v=auditProspectiveCohorts(j,{now});
 assert.equal(v.available,true);assert.equal(v.directionCohorts.MODEL_FAVORS_MARKET_UNDERDOG.n,2);
 assert.equal(v.directionCohorts.MODEL_FAVORS_MARKET_FAVORITE.n,2);
 assert.equal(v.overall.metrics,null);assert.equal(JSON.stringify(j),before);
});
test('no direction and even market are not forced into favorite or underdog',()=>{
 const j=fixture(2);j.snapshots[0].modelHomeProbability=.5;j.snapshots[1].marketHomeProbability=.5;
 const v=auditProspectiveCohorts(j,{now});assert.equal(v.directionCohorts.MODEL_NO_DIRECTION.n,1);assert.equal(v.directionCohorts.MARKET_EVEN.n,1);
});
test('missing quote provenance excludes market cohort without hindsight backfill',()=>{
 const j=fixture(1),s=j.snapshots[0];delete s.marketOldestQuoteAt;
 j.snapshots.push({...s,id:'later',capturedAt:'2026-11-07T12:01:00.000Z',marketOldestQuoteAt:s.marketNewestQuoteAt});
 const v=auditProspectiveCohorts(j,{now});assert.equal(v.coverage.strictPairedGames,0);
});
test('each model and direction cohort separately requires 30 outcomes',()=>{
 const j=fixture(30);j.snapshots.forEach((s,i)=>{s.modelVersion=i<15?'A':'B';s.modelHomeProbability=i<15?.7:.3;});
 const v=auditProspectiveCohorts(j,{now});assert.equal(v.coverage.strictPairedGames,30);
 assert.ok(v.overall.metrics);assert.equal(v.overall.metrics.weekSensitivity.available,false);
 for(const c of v.modelVersionCohorts)assert.equal(c.metrics,null);
 assert.equal(v.directionCohorts.MODEL_FAVORS_MARKET_UNDERDOG.metrics,null);
 assert.equal(v.directionCohorts.MODEL_FAVORS_MARKET_FAVORITE.metrics,null);
 assert.equal(v.modelPromotionAllowed,false);
});
test('invalid evidence fails closed',()=>{
 assert.equal(auditProspectiveCohorts(null,{now}).available,false);
});
