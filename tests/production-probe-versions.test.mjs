import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Legacy production probes derive expected version from checkout, not obsolete releases',async()=>{
  for(const name of ['market-production-audit','phase4-production-audit','pricing-production-audit','v08-production-audit','release-041-smoke','shadow-production-audit']){
    const source=await readFile(new URL(`../.github/workflows/${name}.yml`,import.meta.url),'utf8');
    assert.match(source,/actions\/checkout@v4/);
    assert.match(source,/readFile\('package.json','utf8'\)/);
    assert.match(source,/version[!=]==?expectedVersion/);
    assert.doesNotMatch(source,/v0\.7\.0|0\\\.4/);
    assert.doesNotMatch(source,/mode=live|Bearer |headers[^\n]*Authorization/i);
  }
});
