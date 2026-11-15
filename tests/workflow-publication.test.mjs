import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../.github/workflows/', import.meta.url);
const fixed = ['nfl-replay', 'market-challenge', 'risk-stress', 'residual-research',
  'promotion-power', 'margin-research', 'shadow-lock'];
const read = name => readFile(new URL(name + '.yml', root), 'utf8');
const events = text => text.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] || '';

test('Every test-running workflow job installs locked dependencies before tests without lifecycle scripts', async () => {
  let testedJobs = 0;
  for (const name of await readdir(root)) {
    if (!name.endsWith('.yml')) continue;
    const text = await readFile(new URL(name, root), 'utf8');
    const jobs = text.split(/^jobs:\n/m)[1]?.split(/^  [a-zA-Z0-9_-]+:\n/m) || [];
    for (const job of jobs) {
      const firstTest = job.search(/\bnpm test\b/);
      if (firstTest < 0) continue;
      testedJobs++;
      const install = job.indexOf('npm ci --ignore-scripts --no-audit --no-fund');
      assert.ok(install >= 0 && install < firstTest, `${name}: install must precede npm test`);
    }
  }
  assert.equal(testedJobs, 14);
});

test('Collector dependency installation cannot inherit its operator bearer', async () => {
  const text = await read('capture-evidence');
  const install = text.split(/^      - /m).find(step => step.includes('run: npm ci '));
  assert.ok(install);
  assert.match(install, /^        env:\n          BETQ_OPERATOR_REFRESH_TOKEN: ''\n/m);
  assert.doesNotMatch(install, /secrets\.|if:|npm install|--ignore-scripts=false/);
});

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
    assert.match(text, /operatorRequest/, name);
    assert.match(text, /BETQ_OPERATOR_REFRESH_TOKEN: \$\{\{ secrets.BETQ_OPERATOR_REFRESH_TOKEN \}\}/, name);
    assert.match(text, /OPERATOR_TOKEN_MISSING/, name);
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
  assert.match(script, /operatorRequest\('\/api\/slate'\)/);
  assert.match(text, /BETQ_OPERATOR_REFRESH_TOKEN: \$\{\{ secrets.BETQ_OPERATOR_REFRESH_TOKEN \}\}/);
});


test('Collector compatibility failure skips capture without blocking results reconciliation',async()=>{
  const workflow=await read('capture-evidence');
  assert.match(workflow,/BETQ_CAPTURE_SKIP_REASON=PRODUCTION_PREFLIGHT_UNAVAILABLE/);
  assert.match(workflow,/reconciling results only/);
  assert.match(workflow,/if: env.BETQ_OPERATOR_REFRESH_TOKEN != ''/);
  const script=await readFile(new URL('../scripts/capture-evidence.mjs',import.meta.url),'utf8');
  assert.match(script,/process.env.BETQ_CAPTURE_SKIP_REASON/);
  assert.match(script,/STARVED: NO_ELIGIBLE_FRESH_CAPTURES/);
});

test('Collector preflight has a bounded retry window leaving time for results reconciliation',async()=>{
  const text=await read('capture-evidence');
  assert.match(text,/timeout-minutes: 12/);
  assert.match(text,/for attempt in \{1\.\.3\}; do/);
  assert.match(text,/curl --max-time 20 -fsS/);
  assert.match(text,/if \[\[ "\$attempt" -lt 3 \]\]; then sleep 5; fi/);
  assert.doesNotMatch(text,/sleep 12|\{1\.\.12\}/);
});
