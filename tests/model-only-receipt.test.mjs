import test from 'node:test';import assert from 'node:assert/strict';
import {syntheticDeliveryArtifact} from './fixtures/model-delivery.mjs';
import {evaluateOnDemandGame} from '../src/on-demand-game.mjs';
import {freezeModelOnlyReceipt,assertModelOnlyReceipt,assertModelOnlyAppend} from '../src/model-only-receipt.mjs';
const now=Date.parse('2026-11-17T00:00:00.000Z'),iso=n=>new Date(n).toISOString();
const artifact=syntheticDeliveryArtifact('2026-11-16T21:00:00.000Z','2026-11-15');
const options=()=>({artifact,requestStartedAt:iso(now-2000),receivedAt:iso(now+1000)});
function response(){return evaluateOnDemandGame('2026_10_LAC_BAL',{artifact,now,schedule:{available:true,receipt:{observedAt:iso(now-5000),sourceUrl:'https://www.nfl.com/scores/2026/week-10',sourceBodySha256:'a'.repeat(64),games:[{gameId:'2026_10_LAC_BAL',providerGameId:'fixture-provider',home:'BAL',away:'LAC',kickoff:'2026-11-17T01:15:00.000Z',neutralSite:false,final:false,scheduleStatus:'SCHEDULED',summaryPhase:'PREGAME'}]}}});}
test('Freeze exact odds-free model response as separate nonqualified receipt',()=>{
 const r=response(),record=freezeModelOnlyReceipt(r,options());assertModelOnlyReceipt(record,{artifact});
 assert.equal(record.response.baseline.homeWinProbability,r.baseline.homeWinProbability);
 assert.equal(record.qualifiedScoringEligible,false);assert.equal(record.marketEvidenceEligible,false);
 assert.equal(record.remoteDurableArchiveConfirmed,false);assert.equal(record.independentlyAttestedCaptureTime,false);
 r.baseline.homeWinProbability=.99;assert.notEqual(record.response.baseline.homeWinProbability,.99);
});
test('Reject future/stale times, wrong fixture, model changes and market additions',()=>{
 const mutations=[r=>r.evaluatedAt=iso(now+2000),r=>r.fixture.sourceUrl='https://evil.test',r=>r.fixture.home='New York Giants',r=>r.fixture.kickoff=iso(now),r=>r.validUntil=iso(now+600000),r=>r.baseline.homeWinProbability=.99,r=>r.modelIdentity.artifactCanonicalSha256='b'.repeat(64),r=>r.market.available=true,r=>r.verifiedBettingEdge=true,r=>r.rawBookmakerQuotes={secret:1},r=>r.fixture.extra=1];
 for(const mutate of mutations){const r=response();mutate(r);assert.throws(()=>freezeModelOnlyReceipt(r,options()));}
 assert.throws(()=>freezeModelOnlyReceipt(response(),{...options(),receivedAt:iso(now+301000)}));
 assert.throws(()=>freezeModelOnlyReceipt(response(),{...options(),requestStartedAt:iso(now+500)}));
});
test('Digest and append custody reject changes, removal or duplicates',()=>{
 const r=freezeModelOnlyReceipt(response(),options());assertModelOnlyAppend([r],[r]);
 const changed=structuredClone(r);changed.response.baseline.homeWinProbability=.9;
 assert.throws(()=>assertModelOnlyReceipt(changed,{artifact}));assert.throws(()=>assertModelOnlyAppend([r],[changed]));assert.throws(()=>assertModelOnlyAppend([r],[]));assert.throws(()=>assertModelOnlyAppend([],[r,r]));
});
