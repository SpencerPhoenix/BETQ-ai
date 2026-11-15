import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicKey} from 'node:crypto';

const text=readFileSync(new URL('../.github/workflows/bdl-result-sample.yml',import.meta.url),'utf8');

test('private sample workflow is manual, read-only, serialized and main-only',()=>{
  assert.match(text,/\n  workflow_dispatch:\n/);
  assert.doesNotMatch(text,/\n  (schedule|push|pull_request|pull_request_target|workflow_run):/);
  assert.match(text,/permissions:\n  contents: read\n/);
  assert.doesNotMatch(text,/contents: write|id-token: write|secrets: inherit/);
  assert.match(text,/if: github.ref == 'refs\/heads\/main'/);
  assert.match(text,/cancel-in-progress: false/);
  assert.match(text,/persist-credentials: false/);
});

test('only collection gets the named key and untrusted game input is env quoted',()=>{
  assert.equal((text.match(/secrets\./g)||[]).length,1);
  assert.match(text,/BALLDONTLIE_API_KEY: \$\{\{ secrets\.Balldontlie_api_key \}\}/);
  assert.match(text,/BETQ_SAMPLE_GAME_ID: \$\{\{ inputs\.game_id \}\}/);
  assert.match(text,/--game-id "\$BETQ_SAMPLE_GAME_ID"/);
  assert.ok(text.indexOf('npm test')<text.indexOf('BALLDONTLIE_API_KEY:'));
  assert.doesNotMatch(text,/run:.*\$\{\{/);
});

test('artifact paths allow only ciphertext and sanitized summary with expiry',()=>{
  assert.match(text,/betq-bdl-sample\/envelope\.json/);
  assert.match(text,/betq-bdl-sample\/summary\.json/);
  assert.match(text,/retention-days: 14/);
  assert.doesNotMatch(text,/path:.*\*|\.pem\n\s+retention|ledger\.json|frozen-journal\.json|response\.json/);
});

test('committed review recipient is public RSA3072 only',()=>{
  const pem=readFileSync(new URL('../config/bdl-sample-recipient.pem',import.meta.url),'utf8');
  assert.match(pem,/^-----BEGIN PUBLIC KEY-----\n/);
  assert.doesNotMatch(pem,/PRIVATE/);
  const key=createPublicKey(pem);
  assert.equal(key.asymmetricKeyType,'rsa');
  assert.equal(key.asymmetricKeyDetails.modulusLength,3072);
});
