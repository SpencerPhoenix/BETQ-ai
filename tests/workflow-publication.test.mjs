import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../.github/workflows/', import.meta.url);
const isWorkflowFile = name => /\.ya?ml$/.test(name);
const workflowStem = name => name.replace(/\.ya?ml$/, '');
const manualWriters = ['nfl-replay', 'market-challenge', 'risk-stress', 'residual-research',
  'promotion-power', 'margin-research', 'shadow-lock'];
// Exact schedules retained from reviewed PR16, not newly selected collection times.
const schedules = {
  'capture-evidence': ['41 11 * * *', '15 16 * * 0', '15 17 * * 0', '15 21 * * 0',
    '15 22 * * 0', '35 0 * * 1', '35 1 * * 1'],
  'train-efficiency': ['37 10 * * 2'],
  'train-nfl': ['17 11 * * *'],
  'update-injuries': ['24 10 * * *']
};
const auditSchedules = {'retained-evidence-audit': ['53 */6 * * *']};
const writers = [...manualWriters, ...Object.keys(schedules)];
// Existing workflows retain reviewed PR16 hashes; the read-only audit and offline browser CI amendment have their own reviewed hashes.
// Pinning their complete definitions also catches inline/job-level permission
// or API-write changes that a text search for `git push` cannot classify.
const readOnlyBaseline = {
  // New manual encrypted sample reviewed separately; no automatic collection.
  'bdl-result-sample': 'faf6f437119254f3b57f9f78177ff95d066e147837e836783e5ddc5e462acd67',
  'retained-evidence-audit': '413e2cba527b1ae7f1712e869f6d7f2457164ede2dd0a85b37b0b0498a21723b',
  ci: '2dadb4f7fb2302a4d71ff9cc82faf35ee98f5ca4606c26bbfda9fffccd443913',
  'audit-reliability': '87ac38b4fb4f0a7925b16eacf0f50ac662c0a50a6cbe02d8ee74780c5c0de846',
  'prospective-direction-audit': 'd23a2966566e0558eed4fac023c6b965b71e8556085fe0cd0b186fb68efde07e',
  'live-probe': '789cdb21b8abad55806a02309bc5ff77958d82b34658b05b16706349e45b0b1d',
  'model-production-probe': '1a76b04624798a2e830ce5837fbfff1b27e5d9beeae137feb4b38611b242bafc',
  'market-production-audit': 'ff51027383743c392acdaf437312a0bc8eed9886b1ff0efb3b3175ae95cce079',
  'phase4-production-audit': '3f07ee1eabc299b057d07eefe62f2badfeedddc8129cf3285cec72132b5b777e',
  'pricing-production-audit': '24955d46bfb623ec2310f7c06f3844b04c2c89a637797b5ff788661eab6b6c03',
  'release-041-smoke': '6e7e6043ecec5c09ad7d678baf3e0713102c221e3317bdb410c65918db926912',
  'shadow-production-audit': '432fc7137830754f1aaf0be4c932aae3441407fa585c16e84c32c43ca91d1323',
  'v08-production-audit': '58324e89c1d460f6abf7325daea5d51eaf27658f502e5be8eb7cd2c175374182'
};
const read = name => readFile(new URL(name + '.yml', root), 'utf8');
const events = text => text.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] || '';
const assertWriterEvents = (text, name, cron = []) => {
  assert.equal((text.match(/^(?:on|'on'|"on")\s*:/gm) || []).length, 1, name);
  const actual = events(text).split('\n').filter(line => line.trim() && !line.trimStart().startsWith('#')).join('\n');
  const expected = ['  workflow_dispatch:', ...(cron.length ? ['  schedule:', ...cron.map(value => `    - cron: '${value}'`)] : [])].join('\n');
  // Exact allowlist excludes push, PR, workflow_run, repository_dispatch, aliases,
  // duplicate event keys and unreviewed input/schedule changes.
  assert.equal(actual, expected, name);
};

test('Global workflow discovery includes both YAML extensions', () => {
  assert.equal(isWorkflowFile('writer.yml'), true);
  assert.equal(isWorkflowFile('writer.yaml'), true);
  assert.equal(workflowStem('writer.yml'), 'writer');
  assert.equal(workflowStem('writer.yaml'), 'writer');
  assert.equal(isWorkflowFile('writer.yaml.disabled'), false);
  assert.equal(isWorkflowFile('README.md'), false);
});

test('Every workflow filename is reviewed, including alternative YAML extensions', async () => {
  const expected = [...writers, ...Object.keys(readOnlyBaseline)].map(name => name + '.yml').sort();
  const actual = (await readdir(root)).filter(isWorkflowFile).sort();
  // New/renamed files require explicit review regardless of trigger syntax,
  // permission syntax, reusable workflows or the mechanism used to publish.
  assert.deepEqual(actual, expected);
});

test('Every test-running workflow job installs locked dependencies before tests without lifecycle scripts', async () => {
  let testedJobs = 0;
  for (const name of await readdir(root)) {
    if (!isWorkflowFile(name)) continue;
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
  assert.equal(testedJobs, 16);
});

test('Collector dependency installation cannot inherit its operator bearer', async () => {
  const text = await read('capture-evidence');
  const install = text.split(/^      - /m).find(step => step.includes('run: npm ci '));
  assert.ok(install);
  assert.match(install, /^        env:\n          BETQ_OPERATOR_REFRESH_TOKEN: ''\n/m);
  assert.doesNotMatch(install, /secrets\.|if:|npm install|--ignore-scripts=false/);
});

test('All writers are manual or retain only their exact existing schedules, never push-triggered', async () => {
  for (const name of writers) {
    const text = await read(name);
    assertWriterEvents(text, name, schedules[name]);
    assert.match(text, /^jobs:\n  [a-z-]+:\n    if: github.ref == 'refs\/heads\/main'\n/m, name);
  }
});

test('Every main writer is guarded before checkout and cannot publish a feature-branch dispatch', async () => {
  const publishers = [];
  for (const name of await readdir(root)) {
    if (!isWorkflowFile(name)) continue;
    const text = await readFile(new URL(name, root), 'utf8');
    if (!/\bgit\s+push\b|^\s+contents:\s*write\b|^permissions:\s*write-all\b/m.test(text)) continue;
    const stem = workflowStem(name);
    publishers.push(stem);
    assert.ok(writers.includes(stem), `${name}: unreviewed writer workflow`);
    assertWriterEvents(text, name, schedules[stem]);
    const jobs = text.split(/^jobs:\n/m)[1]?.split(/^  [a-zA-Z0-9_-]+:\n/m).filter(section => section.trim()) || [];
    assert.equal(jobs.length, 1, `${name}: review additional writer jobs`);
    for (const job of jobs) {
      assert.match(job, /^    if: github.ref == 'refs\/heads\/main'\n/m, name);
      assert.ok(job.indexOf("if: github.ref == 'refs/heads/main'") < job.indexOf('actions/checkout@'), name);
    }
  }
  assert.deepEqual(publishers.sort(), [...writers].sort());
});

test('Writer trigger validation rejects push, indirect triggers, duplicate on keys and changed schedules', async () => {
  const text = await read('train-nfl');
  for (const changed of [
    text.replace('  workflow_dispatch:', '  push:\n    branches: [main]\n  workflow_dispatch:'),
    text.replace('  workflow_dispatch:', '  workflow_run:\n    workflows: [CI]\n  workflow_dispatch:'),
    text.replace('  workflow_dispatch:', '  repository_dispatch:\n  workflow_dispatch:'),
    text.replace("17 11 * * *", "18 11 * * *"),
    text + '\n"on": [push]\n'
  ]) assert.throws(() => assertWriterEvents(changed, 'mutated train-nfl', schedules['train-nfl']));
});

test('Writer schedules are unchanged and the read-only audit has its reviewed independent schedule', async () => {
  const found = {};
  for (const name of await readdir(root)) {
    if (!isWorkflowFile(name)) continue;
    const text = await readFile(new URL(name, root), 'utf8');
    const cron = [...events(text).matchAll(/cron: '([^']+)'/g)].map(match => match[1]);
    if (cron.length) found[workflowStem(name)] = cron;
  }
  assert.deepEqual(found, {...schedules,...auditSchedules});
});

test('Read-only workflows match their explicitly reviewed baselines', async () => {
  // Explicit baseline receipts make changes to triggers, permissions, code or
  // credential scope visible instead of silently skipping validation for release.
  for (const [name, hash] of Object.entries(readOnlyBaseline)) {
    const text = await read(name);
    assert.equal(createHash('sha256').update(text).digest('hex'), hash, name);
    assert.match(text, /^permissions:\n  contents: read\n/m, name);
  }
});

test('Research and dependency writers receive no provider, database or operator credentials', async () => {
  for (const name of writers.filter(name => name !== 'capture-evidence')) {
    const text = await read(name);
    assert.doesNotMatch(text, /\bsecrets\b|ODDS_API_KEY|BETQ_OPERATOR_REFRESH_TOKEN|BETQ_BUDGET_DATABASE_URL|BETQ_SHADOW_DATABASE_URL/, name);
  }
});

test('Lockfile root metadata agrees with the package without changing dependency declarations', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.version, packageJson.version);
  assert.equal(lock.packages[''].version, packageJson.version);
  assert.equal(lock.name, packageJson.name);
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);
  assert.deepEqual(lock.packages[''].engines, packageJson.engines);
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


test('Browser release CI preserves original integrity job and uses isolated offline fixtures', async () => {
  const workflow=await read('ci');
  const original=workflow.split('  offline-browser:')[0];
  assert.equal(createHash('sha256').update(original).digest('hex'),'ca2067ffe3be3fde292c80c8952cb538f9f227cb237bb9ea4a01256a6c9ed456');
  const browser=workflow.split('  offline-browser:')[1];
  assert.ok(browser);assert.match(browser,/timeout-minutes: 15/);
  assert.match(browser,/python -m venv \.browser-venv/);
  assert.match(browser,/pip install playwright==1\.62\.0/);
  assert.match(browser,/playwright install --with-deps chromium/);
  assert.match(browser,/ui-audit-browser game-strategies-browser retained-forecasts-browser release-browser/);
  assert.match(browser,/if: always\(\)/);
  assert.match(browser,/actions\/upload-artifact@v4/);
  assert.doesNotMatch(browser,/secrets\.|contents: write|git push|workflow_dispatch|ODDS_API_KEY|BETQ_OPERATOR_REFRESH_TOKEN/);
  for(const name of ['ui-audit-browser','game-strategies-browser','retained-forecasts-browser','release-browser']){
    const script=await readFile(new URL(name+'.py',new URL('./',import.meta.url)),'utf8');
    assert.match(script,/context\.route\('\*\*\/\*',\s*route_all\)/);
    assert.match(script,/service_workers=['"]block['"]/);
    assert.match(script,/unexpected/);assert.match(script,/route\.abort\(\)/);
    assert.match(script,/game-grades\.js/);assert.match(script,/retained-forecasts\.js/);
    assert.match(script,/os\.environ\.get\('CHROMIUM_PATH'\)/);
  }
});
