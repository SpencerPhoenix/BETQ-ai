import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectBdlOutcomeSample} from '../src/bdl-sample-collector.mjs';
import {importReviewedBdlBundle} from '../src/bdl-reviewed-import.mjs';
import {emptyJournal} from '../src/evidence.mjs';
import {isReviewedBdlSettlement} from '../src/bdl-reviewed-result.mjs';
import {isSourceCorroboratedSettlement} from '../src/settlement-qualification.mjs';
import {syntheticBdlOutcomeInput} from './fixtures/bdl-outcome-candidate.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function fixture(){
 const f=syntheticBdlOutcomeInput(),event=JSON.parse(Buffer.from(f.bdlBytes)).data,now=Date.parse(f.evaluatedAt);
 f.journal.provenance=emptyJournal(2026).provenance;
 const responses=[f.nflverseBytes,JSON.stringify({data:[event],meta:{per_page:100}}),f.bdlBytes];
 const sample=await collectBdlOutcomeSample({journal:f.journal,gameId:f.gameId,apiKey:'fabricated-fixture-key'},
  {clock:()=>now,fetchImpl:async()=>new Response(responses.shift())});assert.equal(sample.ok,true);
 return {bundle:sample.privateBundle,journal:f.journal,now:now+3600000,provenance:{githubRepository:'SpencerPhoenix/BETQ-ai',
  githubRunId:'12345',githubCommitSha:'a'.repeat(40),githubRunUrl:'https://github.com/SpencerPhoenix/BETQ-ai/actions/runs/12345',encryptedArtifactSha256:'b'.repeat(64)}};
}
function setList(f,payload){const bytes=Buffer.from(typeof payload==='string'?payload:JSON.stringify(payload)),m=f.bundle.mappingList;
 Object.assign(m,{base64:bytes.toString('base64'),byteLength:bytes.length,sha256:sha(bytes)});}
test('replay derives one allowlisted descriptive revision, no raw bytes, old journal preserved',async()=>{
 const f=await fixture(),original=JSON.stringify(f),r=importReviewedBdlBundle(f),record=r.journal.settlements.at(-1);
 assert.equal(JSON.stringify(f),original);assert.deepEqual(r.journal.snapshots,f.journal.snapshots);
 assert.equal(isReviewedBdlSettlement(record,f.journal.snapshots[0]),true);assert.equal(isSourceCorroboratedSettlement(record,f.journal.snapshots[0]),false);
 assert.equal(record.verifiedAt,f.bundle.ledger.entries[0].recordedAt);assert.notEqual(record.verifiedAt,new Date(f.now).toISOString());
 assert.equal(record.review.ledgerEntrySha256,f.bundle.ledger.entries[0].entrySha256);assert.equal(r.review.providerRequests,0);
 for(const marker of ['bodyBase64','mappingList','fabricated-fixture-key','archives','publicRedistributionAuthorized'])assert.equal(JSON.stringify(r).includes(marker),false);
 assert.equal(record.sourceAuthenticityIndependentlyVerified,false);assert.equal(record.sourceIndependenceVerified,false);
 assert.equal(f.bundle.ledger.flags.sourceUseRightsEstablished,false);assert.equal(f.bundle.ledger.flags.publicRedistributionAuthorized,false);
});
test('changed whole baseline, replay summary, entry, archive or future clock fails closed',async()=>{
 for(const change of [f=>{f.journal.provenance.new='changed';},f=>{f.bundle.summary.distinctReviewedGames=2;},
  f=>{f.bundle.ledger.entries[0].candidate.homeScore++;},f=>{f.bundle.ledger.archives[0].bodyBase64='AAAA';},
  f=>{f.now=Date.parse(f.bundle.ledger.entries[0].recordedAt)-1;},f=>{f.bundle.raw='secret';}]){
  const f=await fixture();change(f);assert.throws(()=>importReviewedBdlBundle(f));
 }
});
test('run/hash provenance fields are bounded and exact, with no pretending to authenticate metadata',async()=>{
 for(const change of [p=>{p.githubRepository='other/repo';},p=>{p.githubRunId='0';},p=>{p.githubRunUrl+='?secret=x';},
  p=>{p.githubCommitSha='main';},p=>{p.encryptedArtifactSha256='invalid';},p=>{p.token='secret';}]){
  const f=await fixture();change(f.provenance);assert.throws(()=>importReviewedBdlBundle(f));
 }
});
test('mapping archive integrity, chronology, pagination and ambiguity fail closed',async()=>{
 for(const change of [f=>{f.bundle.mappingList.sha256='a'.repeat(64);},f=>{f.bundle.mappingList.retrievedAt='2026-11-09T18:04:00.000Z';},
  f=>{const p=JSON.parse(Buffer.from(f.bundle.mappingList.base64,'base64'));p.meta.per_page=1;setList(f,p);},
  f=>{const p=JSON.parse(Buffer.from(f.bundle.mappingList.base64,'base64'));p.meta.next_cursor=1;setList(f,p);},
  f=>{const p=JSON.parse(Buffer.from(f.bundle.mappingList.base64,'base64'));p.data.push({...p.data[0],id:p.data[0].id+1});setList(f,p);},
  f=>{const p=JSON.parse(Buffer.from(f.bundle.mappingList.base64,'base64'));p.data[0].home_team_score++;setList(f,p);},
  f=>{setList(f,'{"data":[],"d\\u0061ta":[],"meta":{"per_page":100}}');}]){
  const f=await fixture();change(f);assert.throws(()=>importReviewedBdlBundle(f));
 }
});
test('import has no network or decryption dependency and refuses a second baseline replay',async()=>{
 const f=await fixture(),oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('NO_NETWORK_ALLOWED');};
 try{const r=importReviewedBdlBundle(f);assert.throws(()=>importReviewedBdlBundle({...f,journal:r.journal}),/REVIEW_BASELINE_CHANGED/);}finally{globalThis.fetch=oldFetch;}
});
