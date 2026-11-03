import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateJournal} from '../src/evidence.mjs';
import {isEligibleFirstSnapshot} from '../src/market-sequential.mjs';
import {summarizeProspectiveDirection} from '../src/prospective-direction.mjs';

const original=JSON.parse(readFileSync(new URL('../data/evidence/nfl-2026.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(original.snapshots.find(isEligibleFirstSnapshot));
const journal=s=>({...structuredClone(original),snapshots:[s],settlements:[]});

test('sequential read-side eligibility refuses stale quotes and accepts the exact ten-minute bound',()=>{
  const s=fixture();
  const at=Date.parse(s.capturedAt);
  assert.equal(isEligibleFirstSnapshot(s),true);
  assert.equal(isEligibleFirstSnapshot({...s,marketNewestQuoteAt:new Date(at-600000).toISOString()}),true);
  for(const quote of ['2020-01-01T00:00:00.000Z',new Date(at-600001).toISOString()])
    assert.equal(isEligibleFirstSnapshot({...s,marketNewestQuoteAt:quote}),false);
  const received=at+60000;
  const laterReceipt={...s,sourceReceivedAt:new Date(received).toISOString()};
  assert.equal(isEligibleFirstSnapshot({...laterReceipt,
    marketNewestQuoteAt:new Date(received-600000).toISOString()}),true);
  assert.equal(isEligibleFirstSnapshot({...laterReceipt,
    marketNewestQuoteAt:new Date(received-600001).toISOString()}),false);
});

test('future and impossible model outcome cutoffs fail journal and scoring checks',()=>{
  const s=fixture();
  for(const cutoff of ['2027-01-01','2026-02-30']){
    const invalid={...s,modelLastResultDate:cutoff};
    assert.equal(isEligibleFirstSnapshot(invalid),false,cutoff);
    assert.throws(()=>validateJournal(journal(invalid)),/Invalid journal observation/);
  }
  // Date precision cannot prove or disprove ordering within a valid same day.
  assert.equal(isEligibleFirstSnapshot({...s,modelLastResultDate:s.modelBuiltAt.slice(0,10)}),true);
  const afterBuild={...s,modelBuiltAt:'2026-10-30T12:00:00.000Z',modelLastResultDate:'2026-11-01'};
  assert.equal(isEligibleFirstSnapshot(afterBuild),false);
  assert.throws(()=>validateJournal(journal(afterBuild)),/Invalid journal observation/);
});

test('legacy missing cutoff is preserved but not certified for sequential or direction scoring',()=>{
  const s=fixture();delete s.modelLastResultDate;
  const j=journal(s),before=JSON.stringify(j);
  assert.equal(validateJournal(j),j);
  assert.equal(isEligibleFirstSnapshot(s),false);
  assert.equal(summarizeProspectiveDirection(j).excluded.invalidSource,1);
  assert.equal(JSON.stringify(j),before);
});

test('direction audit rejects stale benchmark timestamps on either side of a pair',()=>{
  const first=fixture(),second={...first,id:first.id+'-later'};
  const at=Date.parse(first.capturedAt)+30*60000;
  second.capturedAt=new Date(at).toISOString();
  second.sourceReceivedAt=new Date(at-1000).toISOString();
  second.marketNewestQuoteAt=new Date(at-2000).toISOString();
  first.modelHomeProbability=second.modelHomeProbability=0.65;
  first.marketHomeProbability=0.50;second.marketHomeProbability=0.55;
  const make=()=>({...journal(first),snapshots:[structuredClone(first),structuredClone(second)]});
  assert.equal(summarizeProspectiveDirection(make()).candidateMarketMovements,1);
  for(const index of [0,1]){
    const j=make();j.snapshots[index].marketNewestQuoteAt='2020-01-01T00:00:00.000Z';
    assert.equal(summarizeProspectiveDirection(j).candidateMarketMovements,0);
  }
});

test('all frozen production snapshots remain valid without rewriting their provenance',()=>{
  const before=JSON.stringify(original);
  assert.equal(validateJournal(original),original);
  assert.ok(original.snapshots.length>0);
  // Do not freeze the live journal's size: future legitimate captures may grow it.
  assert.ok(original.snapshots.every(s=>s.marketHomeProbability==null||isEligibleFirstSnapshot(s)));
  assert.equal(JSON.stringify(original),before);
});
