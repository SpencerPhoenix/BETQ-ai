import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createSyntheticEvidenceArchive,replaySyntheticEvidence,syntheticCodePayload}
  from '../src/evidence-archive.mjs';
import {makeArchiveFixture} from './fixtures/archive-fixture.mjs';

const hash=text=>createHash('sha256').update(text).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const rehash=bundle=>{
  const {manifestSha256,...body}=bundle;
  bundle.manifestSha256=hash(canonical(body));return bundle.manifestSha256;
};
const replay=bundle=>replaySyntheticEvidence(bundle,{expectedManifestSha256:bundle.manifestSha256});

test('archive defaults OFF and cannot be activated by environment or truthy strings',()=>{
  const before=process.env.BETQ_EVIDENCE_ARCHIVE_ENABLED;
  process.env.BETQ_EVIDENCE_ARCHIVE_ENABLED='true';
  try{
    const archive=createSyntheticEvidenceArchive();
    assert.deepEqual(archive.status(),{enabled:false,syntheticOnly:true,
      liveCaptureEnabled:false,durableStorageConfigured:false});
    for(const action of ['appendReceipt','freezeForecast','freezeSettlement','exportBundle'])
      assert.throws(()=>archive[action]({}),/EVIDENCE_ARCHIVE_DISABLED/);
    assert.throws(()=>createSyntheticEvidenceArchive({enabled:'true'}),/EXPLICIT_BOOLEAN_ENABLE_REQUIRED/);
  }finally{
    if(before===undefined)delete process.env.BETQ_EVIDENCE_ARCHIVE_ENABLED;
    else process.env.BETQ_EVIDENCE_ARCHIVE_ENABLED=before;
  }
});

test('exact bytes survive deterministic local export/import and replay without network',async()=>{
  const f=makeArchiveFixture();
  assert.deepEqual(makeArchiveFixture().bundle,f.bundle);
  const directory=await mkdtemp(join(tmpdir(),'betq-archive-fixture-'));
  const oldFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('NETWORK_MUST_NOT_BE_CALLED');};
  try{
    const path=join(directory,'synthetic.json');
    await writeFile(path,JSON.stringify(f.bundle));
    const restored=JSON.parse(await readFile(path,'utf8'));
    const result=replaySyntheticEvidence(restored,{expectedManifestSha256:f.bundle.manifestSha256});
    assert.equal(result.verified,true);
    assert.equal(result.archivedBlobs,4);
    assert.equal(result.distinctReceipts,6);
    assert.equal(result.homeProbability,0.4937503255);
    assert.equal(result.outcome,'AWAY');
    assert.equal(result.productionModelValidated,false);
    assert.equal(result.publisherAuthenticityVerified,false);
    assert.equal(result.collectorClockAttested,false);
    assert.equal(result.paidRequests,0);
    assert.equal(result.wageringAuthorized,false);
    assert.equal(result.verifiedROI,null);
    assert.equal(result.verifiedCLV,null);
    assert.equal(restored.blobs.find(b=>b.sha256===f.features.blobSha256).content,f.featureBytes);
  }finally{globalThis.fetch=oldFetch;await rm(directory,{recursive:true,force:true});}
});

test('content deduplication never collapses independent collector receipts',()=>{
  const f=makeArchiveFixture();
  assert.equal(f.features.blobSha256,f.repeated.blobSha256);
  assert.notEqual(f.features.receiptId,f.repeated.receiptId);
  assert.equal(f.primary.blobSha256,f.secondary.blobSha256);
  assert.notEqual(f.primary.receiptId,f.secondary.receiptId);
  const same=f.append('SYNTHETIC_FEATURES',f.featureBytes,f.features.collectorReceivedAt);
  assert.deepEqual(same,f.features);
  assert.deepEqual(f.archive.exportBundle(),f.bundle);
  assert.equal(same.publisherPublishedAt,null);
  assert.equal(same.publicationTimeVerified,false);
});

test('live identifiers, extra payload fields and invented publisher times fail closed',()=>{
  const f=makeArchiveFixture();
  for(const source of ['ESPN_SITE_SCOREBOARD_UNOFFICIAL','NFLVERSE_SCHEDULES','THE_ODDS_API_V4'])
    assert.throws(()=>f.append(source,f.featureBytes,f.features.collectorReceivedAt),/SYNTHETIC_SOURCE_REQUIRED/);
  for(const content of [f.featureBytes.replace('true','false'),
    JSON.stringify({synthetic:true,gameId:'SYNTHETIC_GAME_001',signal:0.25,url:'https://example.com'})])
    assert.throws(()=>f.append('SYNTHETIC_FEATURES',content,f.features.collectorReceivedAt));
  assert.throws(()=>f.archive.appendReceipt({sourceKind:'SYNTHETIC_FEATURES',content:f.featureBytes,
    collectorReceivedAt:f.features.collectorReceivedAt,publisherPublishedAt:'2026-01-01T09:00:00.000Z'}),/ARCHIVE_SCHEMA_INVALID/);
  assert.deepEqual(f.archive.exportBundle(),f.bundle);
});

test('frozen forecast and settlement cannot be overwritten or mutated through returned objects',()=>{
  const f=makeArchiveFixture();
  assert.deepEqual(f.archive.freezeForecast(f.forecastInput),f.bundle.forecast);
  assert.deepEqual(f.archive.freezeSettlement(f.settlementInput),f.bundle.settlement);
  assert.throws(()=>f.archive.freezeForecast({...f.forecastInput,frozenAt:'2026-01-01T09:11:00.000Z'}),/FORECAST_ALREADY_FROZEN/);
  assert.throws(()=>f.archive.freezeSettlement({...f.settlementInput,verifiedAt:'2026-01-01T15:11:00.000Z'}),/SETTLEMENT_ALREADY_FROZEN/);
  f.features.collectorReceivedAt='2020-01-01T00:00:00.000Z';
  f.bundle.blobs[0].content='changed';
  assert.equal(replay(f.archive.exportBundle()).verified,true);
});

test('late feature, model or code receipts cannot enter the frozen pregame forecast',()=>{
  for(const [role,key,payload] of [
    ['SYNTHETIC_FEATURES','inputReceiptId',{synthetic:true,gameId:'SYNTHETIC_GAME_001',signal:0.25}],
    ['SYNTHETIC_MODEL','modelReceiptId',{synthetic:true,modelId:'fixture-logit-v1',intercept:-0.2,slope:0.7,trainedThrough:'2025-12-31T23:00:00.000Z'}],
    ['SYNTHETIC_CODE','codeReceiptId',syntheticCodePayload()]
  ]){
    const f=makeArchiveFixture();
    const late=f.append(role,payload,'2026-01-01T09:10:00.001Z');
    assert.throws(()=>f.archive.freezeForecast({...f.forecastInput,[key]:late.receiptId}),/FUTURE_FORECAST_INPUT/);
  }
  const f=makeArchiveFixture();
  assert.throws(()=>f.archive.freezeForecast({...f.forecastInput,frozenAt:f.forecastInput.kickoffAt}),/FORECAST_NOT_PREGAME/);
});

test('both synthetic final sources must match game, kickoff and both scores',()=>{
  for(const altered of [{gameId:'SYNTHETIC_OTHER'},
    {kickoffAt:'2026-01-02T12:00:00.000Z'},{homeScore:18},{awayScore:25}]){
    const f=makeArchiveFixture();
    const bad=f.append('SYNTHETIC_SECONDARY_FINAL',{...f.scores,...altered},'2026-01-01T15:07:00.000Z');
    assert.throws(()=>f.archive.freezeSettlement({...f.settlementInput,secondaryReceiptId:bad.receiptId}),
      /SETTLEMENT_GAME_MISMATCH|FINAL_SOURCE_DISAGREEMENT/);
  }
  const f=makeArchiveFixture();
  assert.throws(()=>f.archive.freezeSettlement({...f.settlementInput,secondaryReceiptId:f.primary.receiptId}),/DISTINCT_RECEIPTS_REQUIRED/);
  const again=f.append('SYNTHETIC_PRIMARY_FINAL',f.scores,'2026-01-01T15:06:00.000Z');
  assert.throws(()=>f.archive.freezeSettlement({...f.settlementInput,secondaryReceiptId:again.receiptId}),/MISSING_OR_WRONG_SOURCE_RECEIPT/);
  assert.throws(()=>f.archive.freezeSettlement({...f.settlementInput,verifiedAt:'2026-01-01T15:06:00.000Z'}),/SETTLEMENT_CHRONOLOGY_INVALID/);
});

test('single-byte tampering and a coherently rehashed replacement fail against the retained anchor',()=>{
  const f=makeArchiveFixture(),anchor=f.bundle.manifestSha256;
  const changed=structuredClone(f.bundle);changed.blobs[0].content+=' ';
  assert.throws(()=>replaySyntheticEvidence(changed,{expectedManifestSha256:anchor}),/MANIFEST_HASH_MISMATCH/);
  rehash(changed);
  assert.throws(()=>replaySyntheticEvidence(changed,{expectedManifestSha256:anchor}),/MANIFEST_HASH_MISMATCH/);
  const replacement=makeArchiveFixture({signal:0.5}).bundle;
  assert.equal(replay(replacement).verified,true);
  assert.throws(()=>replaySyntheticEvidence(replacement,{expectedManifestSha256:anchor}),/MANIFEST_HASH_MISMATCH/);
  assert.throws(()=>replaySyntheticEvidence(f.bundle),/EXPECTED_MANIFEST_REQUIRED/);
});

test('self-consistent outer hash cannot conceal bad blob bytes, missing references or duplicate records',()=>{
  for(const mutate of [
    b=>{b.blobs[0].content+=' ';},
    b=>{b.blobs.pop();},
    b=>{b.receipts.pop();},
    b=>{b.blobs.push(structuredClone(b.blobs[0]));},
    b=>{b.receipts.push(structuredClone(b.receipts[0]));},
    b=>{const content='Unreferenced arbitrary payload';b.blobs.push({sha256:hash(content),
      byteLength:Buffer.byteLength(content),content});},
    b=>{b.forecast.homeProbability=0.99;},
    b=>{b.settlement.outcome='HOME';},
    b=>{b.receipts[0].collectorReceivedAt='2026-01-01';},
    b=>{b.schema='unknown-version';}
  ]){
    const b=makeArchiveFixture().bundle;mutate(b);rehash(b);
    assert.throws(()=>replay(b));
  }
});

test('archived code is matched to the trusted synthetic scorer and is never evaluated',()=>{
  const f=makeArchiveFixture();
  assert.throws(()=>f.append('SYNTHETIC_CODE',JSON.stringify({synthetic:true,
    source:'globalThis.__archiveExecuted = true;'}),'2026-01-01T09:00:00.000Z'),/UNSUPPORTED_ARCHIVED_CODE/);
  assert.equal(globalThis.__archiveExecuted,undefined);
});

test('incomplete bundles, oversize payloads, impossible dates and future training cutoffs fail closed',()=>{
  const a=createSyntheticEvidenceArchive({enabled:true});
  assert.throws(()=>a.exportBundle(),/ARCHIVE_BUNDLE_INCOMPLETE/);
  const f=makeArchiveFixture();
  assert.throws(()=>f.append('SYNTHETIC_FEATURES',' '.repeat(65537),f.features.collectorReceivedAt),/ARCHIVE_BLOB_SIZE_INVALID/);
  assert.throws(()=>f.append('SYNTHETIC_FEATURES','\ud800',f.features.collectorReceivedAt),/ARCHIVE_UTF8_INVALID/);
  for(const at of ['2026-02-30T09:00:00.000Z','2026-01-01','2026-01-01T09:00:00'])
    assert.throws(()=>f.append('SYNTHETIC_FEATURES',f.featureBytes,at),/ARCHIVE_TIMESTAMP_INVALID/);
  const model=f.append('SYNTHETIC_MODEL',{synthetic:true,modelId:'fixture-logit-v1',intercept:-0.2,
    slope:0.7,trainedThrough:'2026-01-02T00:00:00.000Z'},'2026-01-01T09:00:00.000Z');
  assert.throws(()=>f.archive.freezeForecast({...f.forecastInput,modelReceiptId:model.receiptId}),/FUTURE_MODEL_CUTOFF/);
});

test('bounded receipt capacity rejects additional entries without changing prior evidence',()=>{
  const f=makeArchiveFixture();
  for(let i=6;i<32;i++)f.append('SYNTHETIC_FEATURES',f.featureBytes,
    new Date(Date.parse('2026-01-01T10:00:00.000Z')+i*1000).toISOString());
  const full=f.archive.exportBundle();
  assert.equal(full.receipts.length,32);
  assert.throws(()=>f.append('SYNTHETIC_FEATURES',f.featureBytes,'2026-01-01T11:00:00.000Z'),/ARCHIVE_CAPACITY_EXCEEDED/);
  assert.deepEqual(f.archive.exportBundle(),full);
  assert.equal(replay(full).verified,true);
});

test('committed synthetic bundle is reproducible and the CLI is OFF unless explicitly opted in',async()=>{
  const path=new URL('./fixtures/evidence-archive/synthetic-v1.json',import.meta.url);
  const saved=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(saved,makeArchiveFixture().bundle);
  const script=new URL('../scripts/replay-evidence-fixture.mjs',import.meta.url);
  const run=args=>spawnSync(process.execPath,[script.pathname,...args],{encoding:'utf8'});
  const disabled=run([]);
  assert.equal(disabled.status,0);
  assert.equal(JSON.parse(disabled.stdout).enabled,false);
  const explicit=run(['--synthetic-fixture']);
  assert.equal(explicit.status,0,explicit.stderr);
  const report=JSON.parse(explicit.stdout);
  assert.equal(report.verified,true);
  assert.equal(report.syntheticOnly,true);
  assert.equal(report.fixtureOrigin,'FABRICATED_REPOSITORY_FIXTURE');
  assert.equal(report.filesWritten,0);
  assert.equal(report.productionEvidenceChanged,false);
  assert.notEqual(run(['--live']).status,0);
  assert.notEqual(run(['--synthetic-fixture','--output=somewhere']).status,0);
});

test('archive proof has no network, database, credential or production activation path',async()=>{
  const module=await readFile(new URL('../src/evidence-archive.mjs',import.meta.url),'utf8');
  const script=await readFile(new URL('../scripts/replay-evidence-fixture.mjs',import.meta.url),'utf8');
  for(const source of [module,script]){
    assert.doesNotMatch(source,/\bfetch\s*\(|https?:\/\/|process\.env|from\s+['"]pg['"]|\beval\s*\(|new\s+Function\s*\(/);
    assert.doesNotMatch(source,/\b(?:writeFile|mkdir|appendFile|createWriteStream)\s*\(/);
  }
  for(const path of ['src/server.mjs','scripts/capture-evidence.mjs','scripts/reconcile-settlements.mjs']){
    const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.ok(!source.includes('evidence-archive.mjs'));
  }
});
