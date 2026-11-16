import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compatibleEvidenceHealth,MARKET_CAPTURE_CONTRACT,describeMarketCaptureContract,validMarketCaptureContract} from '../src/evidence-compat.mjs';

const good=(version='0.9.0')=>({
  status:'ok',app:'BETQ.ai',version,marketCaptureContract:describeMarketCaptureContract(),
  odds:{configured:true,budget:{used:0,limit:12}},
  nflModel:{available:true,version:'nfl-elo-1'},
  forwardEvidence:{status:'COLLECTING_FORWARD_EVIDENCE',prospectiveGames:17,settledGames:0},
  nflIntelligence:{startingQuarterbacksVerified:false}
});
test('Prospective journal is compatible on 0.9+ without hardcoded 0.4 version constraint',()=>{
  for(const version of ['0.4.1','0.8.0','0.9.0','0.10.0','1.0.0']){
    const r=compatibleEvidenceHealth(good(version));
    assert.equal(r.compatible,true,version);
    assert.equal(r.noOddsCreditsUsedByThisCheck,true);
  }
});
test('Read-only health preflight rejects absent source or broken journal before paid odds',()=>{
  const cases=[
    null,{},good('broken'),
    {...good(),status:'bad'},
    {...good(),odds:{configured:false}},
    {...good(),nflModel:{available:false}},
    {...good(),forwardEvidence:null},
    {...good(),forwardEvidence:{status:'COLLECTING_FORWARD_EVIDENCE',prospectiveGames:-3}},
    {...good(),app:'NOT_BETQ'}
  ];
  for(const sample of cases){
    assert.equal(compatibleEvidenceHealth(sample).compatible,false);
  }
});
test('Collector workflow consumes only read-only health for compatibility and retains unchanged quota schedule',async()=>{
  const wf=await readFile(new URL('../.github/workflows/capture-evidence.yml',import.meta.url),'utf8');
  const cli=await readFile(new URL('../scripts/verify-evidence-health.mjs',import.meta.url),'utf8');
  assert.match(wf,/node scripts\/verify-evidence-health\.mjs/);
  assert.match(wf,/https:\/\/betq-ai\.onrender\.com\/api\/health/);
  assert.ok(!wf.includes('0\\.4\\.'));
  assert.ok(!cli.includes('/api/slate'));
  assert.match(cli,/compatibleEvidenceHealth/);
  assert.match(wf,/cron: '41 11 \* \* \*'/);
  assert.match(wf,/run: node scripts\/capture-evidence\.mjs/);
});


test('market producer descriptor is immutable, detached and precisely bounded',()=>{
  assert.equal(Object.isFrozen(MARKET_CAPTURE_CONTRACT),true);
  assert.equal(validMarketCaptureContract(MARKET_CAPTURE_CONTRACT),true);
  for(const value of [undefined,null,false,[],{}])assert.equal(validMarketCaptureContract(value),false);
  const a=describeMarketCaptureContract(),b=describeMarketCaptureContract();
  assert.notEqual(a,b);assert.deepEqual(a,b);
  a.maximumQuoteAgeMs=999999;assert.equal(b.maximumQuoteAgeMs,600000);
  assert.equal(MARKET_CAPTURE_CONTRACT.maximumQuoteAgeMs,600000);
  assert.equal(b.minimumDistinctBooks,3);assert.equal(b.historicalBackfillAllowed,false);
  assert.equal(b.scope,'PRODUCER_CAPABILITY_ONLY');
});

test('every missing or mismatched market producer capability blocks compatibility',()=>{
  for(const contract of [undefined,null])assert.equal(compatibleEvidenceHealth({...good(),marketCaptureContract:contract}).reason,'MARKET_CAPTURE_CONTRACT_MISSING');
  for(const contract of [true,[],{},'ABSOLUTE_OLDEST_QUOTE_AT_CAPTURE_V1'])
    assert.equal(compatibleEvidenceHealth({...good(),marketCaptureContract:contract}).reason,'MARKET_CAPTURE_CONTRACT_MISMATCH');
  for(const [key,value] of Object.entries(MARKET_CAPTURE_CONTRACT)){
    const absent=describeMarketCaptureContract();delete absent[key];
    const changed=describeMarketCaptureContract();changed[key]=typeof value==='boolean'?!value:typeof value==='number'?value+1:value+'-different';
    for(const contract of [absent,changed])assert.equal(compatibleEvidenceHealth({...good(),marketCaptureContract:contract}).compatible,false,key);
  }
});

test('model availability ordering and prerequisite distinctions are preserved',()=>{
  const old=good();delete old.marketCaptureContract;
  assert.equal(compatibleEvidenceHealth({...old,nflModel:{available:false}}).reason,'NO_NFL_MODEL_SOURCE');
  assert.equal(compatibleEvidenceHealth({...old,forwardEvidence:null}).reason,'NO_FORWARD_EVIDENCE_CONTRACT');
  const capabilityOnly={...good(),captureReadiness:{ready:false},collectionHealth:{liveFreshnessVerified:false}};
  assert.equal(compatibleEvidenceHealth(capabilityOnly).compatible,true);
});
