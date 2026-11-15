import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../.github/workflows/', import.meta.url);
const fixed = ['nfl-replay', 'market-challenge', 'risk-stress', 'residual-research',
  'promotion-power', 'margin-research', 'shadow-lock'];
const read = name => readFile(new URL(name + '.yml', root), 'utf8');
const events = text => text.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] || '';

test('All seven previously unsafe publishers restrict both push and manual runs to main', async () => {
  for (const name of fixed) {
    const text = await read(name);
    assert.match(events(text), /^  push:\n    branches: \[main\]\n/m, name);
    assert.match(events(text), /^  workflow_dispatch:/m, name);
    assert.match(text, /^jobs:\n  [a-z-]+:\n    if: github.ref == 'refs\/heads\/main'\n/m, name);
  }
});

test('Every main writer is guarded before checkout and cannot publish a feature-branch dispatch', async () => {
  let publishers = 0;
  for (const name of await readdir(root)) {
    if (!name.endsWith('.yml')) continue;
    const text = await readFile(new URL(name, root), 'utf8');
    if (!/git push origin HEAD:main/.test(text)) continue;
    publishers++;
    const jobs = text.split(/^  [a-z-]+:\n/m).filter(section => /git push origin HEAD:main/.test(section));
    for (const job of jobs) {
      assert.match(job, /^    if: github.ref == 'refs\/heads\/main'\n/m, name);
      assert.ok(job.indexOf("if: github.ref == 'refs/heads/main'") < job.indexOf('actions/checkout@'), name);
    }
    if (/^  push:/m.test(events(text))) assert.match(events(text), /^  push:\n    branches: \[main\]/m, name);
    assert.doesNotMatch(events(text), /^  (pull_request|pull_request_target|workflow_run):/m, name);
  }
  assert.equal(publishers, 11);
});

test('Paid probes remain manual-only and mark their sole live request as explicitly paid', async () => {
  for (const name of ['live-probe', 'model-production-probe']) {
    const text = await read(name);
    assert.match(events(text), /^  workflow_dispatch:/m, name);
    assert.doesNotMatch(events(text), /^  (push|schedule|pull_request|pull_request_target|workflow_run):/m, name);
    assert.match(text, /x-betq-paid-request/, name);
    assert.equal((text.match(/\/api\/slate\?[^'\n]*mode=live|\/api\/slate\?mode=live[^'\n]*/g) || []).length, 1, name);
    assert.match(text, /(?:read|request)\('\/api\/slate\?[^']*',\s*true\)/, name);
  }
});

test('The existing evidence collection schedule and deliberate paid request are preserved', async () => {
  const text = await read('capture-evidence');
  assert.deepEqual([...events(text).matchAll(/cron: '([^']+)'/g)].map(match => match[1]), [
    '41 11 * * *', '15 16 * * 0', '15 17 * * 0', '15 21 * * 0',
    '15 22 * * 0', '35 0 * * 1', '35 1 * * 1'
  ]);
  const script = await readFile(new URL('../scripts/capture-evidence.mjs', import.meta.url), 'utf8');
  assert.match(script, /headers:\{Accept:'application\/json','x-betq-paid-request':'true'\}/);
});
