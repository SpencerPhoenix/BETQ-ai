import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {describeModelDelivery,compareModelDelivery,compareModelHealth,assertSlateModelDelivery,MODEL_DELIVERY_POLICY} from '../src/model-delivery.mjs';
import {syntheticDeliveryArtifact,modelHealthFixture} from './fixtures/model-delivery.mjs';
import {createHandler} from '../src/server.mjs';
import {predictNflEvent} from '../src/nfl-elo.mjs';
import {validSnapshotChronology} from '../src/evidence-integrity.mjs';
import {observationsFromSlate} from '../src/evidence.mjs';
const NOW=Date.parse('2026-11-07T12:00:00.000Z'),iso=n=>new Date(n).toISOString();
const artifact=()=>syntheticDeliveryArtifact('2026-11-07T11:00:00.000Z','2026-11-06');
const TOKEN='OFFLINE_OPERATOR_FIXTURE_0123456789';
const raw={id:'fixture-event',home_team:'Kansas City Chiefs',away_team:'Las Vegas Raiders',commence_time:'2026-11-08T18:00:00.000Z',bookmakers:[]};
const rows=[{game_id:'2026_09_LV_KC',season:2026,game_type:'REG',gameday:'2026-11-08',home_team:'KC',away_team:'LV'}];
function slate(a=artifact()) {const identity=describeModelDelivery(a,NOW);return {demo:false,source:'THE_ODDS_API_V4',sport:'americanfootball_nfl',market:'h2h',receivedAt:iso(NOW),nflModelDelivery:identity,events:[{id:raw.id,homeTeam:raw.home_team,awayTeam:raw.away_team,commenceTime:raw.commence_time,independentModel:{...predictNflEvent(raw,a,NOW),deliveryIdentity:identity}}]};}
test('Canonical artifact identity is deterministic across object order, but binds nested contents',()=>{
 const a=artifact(),b=Object.fromEntries(Object.entries(a).reverse());b.ratings=Object.fromEntries(Object.entries(a.ratings).reverse());
 const id=describeModelDelivery(a,NOW);assert.equal(id.available,true);assert.match(id.artifactCanonicalSha256,/^[a-f0-9]{64}$/);
 assert.equal(id.policy,MODEL_DELIVERY_POLICY);assert.deepEqual(describeModelDelivery(b,NOW),id);
 for(const mutate of [x=>x.ratings.KC+=1,x=>x.params.scale+=.01,x=>x.holdout.n+=1,x=>x.source.extractedUTC='different']){
  const changed=structuredClone(a);mutate(changed);assert.equal(compareModelDelivery(a,describeModelDelivery(changed,NOW),NOW).compatible,false);
 }
 assert.equal(id.authentication,'RUNTIME_HTTPS_ASSERTION_NOT_INDEPENDENT_ATTESTATION');assert.equal(id.automaticPromotion,false);
});
for(const [name,mutate] of [
 ['future build',a=>a.generatedAt=iso(NOW+1)],['noncanonical build',a=>a.generatedAt='2026-11-07T11:00:00Z'],
 ['future cutoff',a=>a.lastGameDate='2026-11-07'],['invalid day',a=>a.lastGameDate='2026-11-31'],
 ['missing source',a=>delete a.source],['different source',a=>a.source.project='unknown'],
 ['stale build',a=>{a.generatedAt='2026-10-01T00:00:00.000Z';a.lastGameDate='2026-09-30';}],
 ['stale results',a=>a.lastGameDate='2026-09-30'],['nonfinite nested value',a=>a.ratings.BUF=NaN],
 ['wrong version',a=>a.version='unknown']])test('Fail-closed artifact identity: '+name,()=>{const a=artifact();mutate(a);assert.equal(describeModelDelivery(a,NOW).available,false);});
test('Health binds the exact artifact and rejects missing, old, future or inconsistent metadata',()=>{
 const a=artifact(),h=modelHealthFixture(a,NOW);assert.equal(compareModelHealth(a,h,NOW).compatible,true);
 for(const stamp of [null,'bad',iso(NOW+1),iso(NOW-60001),'2026-11-07T12:00:00Z'])assert.equal(compareModelHealth(a,{...h,serverTime:stamp},NOW).compatible,false);
 for(const value of [null,{}, {...h.nflModel.deliveryIdentity,artifactCanonicalSha256:'a'.repeat(64)}, {...h.nflModel.deliveryIdentity,modelBuiltAt:iso(NOW-1)}])
  assert.equal(compareModelHealth(a,{...h,nflModel:{deliveryIdentity:value}},NOW).compatible,false);
});
test('Slate recheck binds all available projection identities and does not relabel a race',()=>{
 const a=artifact(),s=slate(a);assert.doesNotThrow(()=>assertSlateModelDelivery(s,a,NOW));
 for(const mutate of [x=>delete x.nflModelDelivery,x=>x.nflModelDelivery={...x.nflModelDelivery,artifactCanonicalSha256:'b'.repeat(64)},x=>delete x.events[0].independentModel.deliveryIdentity,
  x=>x.events[0].independentModel.modelVersion='other',x=>x.events[0].independentModel.throughGameDate='2026-11-05',x=>x.events[0].independentModel.modelBuiltAt=iso(NOW-1)]){
  const changed=structuredClone(s);mutate(changed);assert.throws(()=>assertSlateModelDelivery(changed,a,NOW));
 }
});
test('New captured hash is retained; legacy snapshots remain unmodified and valid',()=>{
 const s=observationsFromSlate(slate(),rows,NOW,2026).accepted[0];assert.ok(s);assert.equal(s.modelArtifactCanonicalSha256,describeModelDelivery(artifact(),NOW).artifactCanonicalSha256);assert.equal(s.modelDeliveryPolicy,MODEL_DELIVERY_POLICY);
 assert.equal(validSnapshotChronology(s,{requireProvenance:true}),true);
 const legacy=structuredClone(s);delete legacy.modelArtifactCanonicalSha256;delete legacy.modelDeliveryPolicy;const before=structuredClone(legacy);
 assert.equal(validSnapshotChronology(legacy,{requireProvenance:true}),true);assert.deepEqual(legacy,before);
 for(const update of [{modelArtifactCanonicalSha256:'bad'},{modelDeliveryPolicy:'wrong'},{modelArtifactCanonicalSha256:null}])assert.equal(validSnapshotChronology({...s,...update}),false);
});
async function serverFixture(t,a=artifact()){
 let calls=0;const source={status:()=>({configured:true}),getOdds:async()=>{calls++;return {events:[raw],receivedAt:iso(NOW),cacheHit:false,quota:null};}};
 const server=http.createServer(createHandler({source,nflArtifact:a,nflEfficiency:null,nflInjuries:null,evidenceFeed:null,injuryFeed:{get:async()=>({artifact:null}),status:()=>({available:false})},clock:()=>NOW,operatorRefreshToken:TOKEN}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 return {url:'http://127.0.0.1:'+server.address().port,calls:()=>calls};
}
test('Expected hash rejects mismatch/malformed/unavailable delivery before source access, regardless of paid intent',async t=>{
 const f=await serverFixture(t);
 for(const hash of ['b'.repeat(64),'bad','']){
  const r=await fetch(f.url+'/api/slate?mode=live',{headers:{'x-betq-expected-model-sha256':hash,'x-betq-paid-request':'true',authorization:'Bearer '+TOKEN}});
  assert.equal(r.status,409);assert.equal((await r.json()).error.code,'MODEL_DELIVERY_MISMATCH');assert.equal(f.calls(),0);
 }
 const stale=artifact();stale.generatedAt='2026-10-01T00:00:00.000Z';stale.lastGameDate='2026-09-30';const g=await serverFixture(t,stale);
 assert.equal((await fetch(g.url+'/api/slate',{headers:{'x-betq-expected-model-sha256':'b'.repeat(64)}})).status,409);assert.equal(g.calls(),0);
});
test('Health, model and slate identify the same private frozen artifact; input mutation cannot hot-reload it',async t=>{
 const a=artifact(),expected=describeModelDelivery(a,NOW),f=await serverFixture(t,a);a.ratings.KC+=100;a.generatedAt=iso(NOW+1);
 const health=await (await fetch(f.url+'/api/health')).json();assert.deepEqual(health.nflModel.deliveryIdentity,expected);assert.equal(f.calls(),0);
 const model=await (await fetch(f.url+'/api/model/nfl')).json();assert.deepEqual(model.deliveryIdentity,expected);assert.equal(f.calls(),0);
 const r=await fetch(f.url+'/api/slate',{headers:{'x-betq-expected-model-sha256':expected.artifactCanonicalSha256,'x-betq-paid-request':'true',authorization:'Bearer '+TOKEN}});
 assert.equal(r.status,200);const result=await r.json();assert.equal(f.calls(),1);assert.deepEqual(result.nflModelDelivery,expected);assert.deepEqual(result.events[0].independentModel.deliveryIdentity,expected);
});
test('Readiness CLI still performs no fetch or credential handling',()=>{
 const source=readFileSync(new URL('../scripts/verify-evidence-health.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|process\.env/);
});

for(const available of ['true',1,{},[]])test('Nonboolean availability cannot bypass per-event model binding: '+JSON.stringify(available),()=>{
 const a=artifact(),s=slate(a);s.events[0].independentModel.available=available;delete s.events[0].independentModel.deliveryIdentity;
 assert.throws(()=>assertSlateModelDelivery(s,a,NOW),/MODEL_AVAILABILITY_TYPE_INVALID/);assert.equal(observationsFromSlate(s,rows,NOW,2026).accepted.length,0);
});
test('Direct derivation rejects inconsistent claimed identity rather than retaining a misleading hash',()=>{
 const s=slate();s.events[0].independentModel.deliveryIdentity={...s.events[0].independentModel.deliveryIdentity,modelBuiltAt:'2026-11-07T10:00:00.000Z'};
 const derived=observationsFromSlate(s,rows,NOW,2026);assert.equal(derived.accepted.length,0);assert.equal(derived.skipped[0].reason,'MODEL_DELIVERY_BINDING_INVALID');
});
