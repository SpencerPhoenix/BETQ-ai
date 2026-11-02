import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compatibleEvidenceHealth} from '../src/evidence-compat.mjs';

const good=(version='0.9.0')=>({
  status:'ok',app:'BETQ.ai',version,
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
