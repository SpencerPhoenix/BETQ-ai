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


import {projectModelOnlyResponse} from '../src/model-only-projection.mjs';
const display=()=>({available:false,starterVerified:false,probabilitiesAdjusted:false,reason:'DEPTH_CONTEXT_UNAVAILABLE',teams:[]});
test('collector strips only recognized display context; frozen receipt equals original forecast',()=>{
 const original=response(),enriched={...structuredClone(original),depthContext:display()};
 assert.throws(()=>freezeModelOnlyReceipt(enriched,options()));
 const record=freezeModelOnlyReceipt(projectModelOnlyResponse(enriched),options());
 assert.deepEqual(record,freezeModelOnlyReceipt(original,options()));assertModelOnlyReceipt(record,{artifact});
 assert.ok(Object.hasOwn(enriched,'depthContext'));assert.ok(!Object.hasOwn(record.response,'depthContext'));
 assert.deepEqual(projectModelOnlyResponse(original),original);
});
test('projection cannot strip unknown fields or weaken original safety checks',()=>{
 for(const mutate of [r=>r.extra=true,r=>r.market.available=true,r=>r.fixture.extra=true,r=>r.injuryAdjusted=true,r=>r.modelIdentity.artifactCanonicalSha256='b'.repeat(64),r=>r.baseline.homeWinProbability=.99,r=>r.evaluatedAt=iso(now+2000)]){
  const r={...response(),depthContext:display()};mutate(r);assert.throws(()=>freezeModelOnlyReceipt(projectModelOnlyResponse(r),options()));
 }
 for(const d of [null,[],{...display(),starterVerified:true},{...display(),probabilitiesAdjusted:true},{...display(),secret:1},{...display(),teams:[{team:'BAL',player:'a',playerId:'1',extra:true}]},{...display(),reason:'x'.repeat(20001)}])assert.throws(()=>projectModelOnlyResponse({...response(),depthContext:d}));
});
test('known available display context is ignored, not interpreted as model evidence',()=>{
 const d={...display(),available:true,reason:null,teams:[{team:'BAL',player:'Display Only',playerId:'1'}],sourceUrl:'display-only',validUntil:'display-only'};
 assert.deepEqual(freezeModelOnlyReceipt(projectModelOnlyResponse({...response(),depthContext:d}),options()),freezeModelOnlyReceipt(response(),options()));
});


test('recognized numeric source player ID remains discard-only context',()=>{
 const d={...display(),available:true,reason:null,teams:[{team:'BAL',player:'Display Only',playerId:123}]};
 assert.deepEqual(freezeModelOnlyReceipt(projectModelOnlyResponse({...response(),depthContext:d}),options()),freezeModelOnlyReceipt(response(),options()));
 for(const playerId of [-1,Infinity,1.5,{},1000000000000])assert.throws(()=>projectModelOnlyResponse({...response(),depthContext:{...d,teams:[{...d.teams[0],playerId}]}}));
});
