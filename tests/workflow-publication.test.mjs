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
  'update-injuries': ['24 10 * * *'],
  'update-depth-context': ['17 8,18 * * *']
};
const auditSchedules = {'retained-evidence-audit': ['53 */6 * * *'], 'injury-coverage-audit': ['40 12 * * *']};
// New schedule explicitly reviewed for isolated model-only custody, not market collection.
const modelOnlySchedules = {'model-only-scheduled': ['7,22,37,52 * * * *']};
// User-requested durable descriptive finals use a separate evidence-only branch.
const officialResultSchedules = {'official-results': ['17 * * * *']};
const writerSchedules = {...schedules,...modelOnlySchedules,...officialResultSchedules};
const writers = [...manualWriters, ...Object.keys(writerSchedules)];
// Existing workflows retain reviewed PR16 hashes; the read-only audit and offline browser CI amendment have their own reviewed hashes.
// Pinning their complete definitions also catches inline/job-level permission
// or API-write changes that a text search for `git push` cannot classify.
const readOnlyBaseline = {
  // GitHub-read-only, manual restricted-Neon-staging probe; no production/provider access.
  'neon-staging-verify': '81cd2c35dfa110b9380aeef00db79e5e9aa4315afb42b3d9a3dcebde2366f2c8',
  // Manual fixed-endpoint, quota-free observation; no data publication or ledger writes.
  'odds-quota-diagnostic': '4224b9912059092720da1ac79d7067af5ded4c1c91a2db4b7b6c8e6c9e7e092b',
  'injury-coverage-audit': 'b8ebc10e8fe51d63e8e91dee90b1d8e63d7fb7964de130b025ba2a53d584f311',
  // New manual encrypted sample reviewed separately; no automatic collection.
  'bdl-result-sample': '7dd8a44daaed324435cef33ee1547c54188b121ab8551113a99b18844abde1d4',
  'retained-evidence-audit': '24a6bc9009daf141496935498722ace6ef3146ca64002bd79b20fe5da6c96991',
  ci: '8be7ec2388c8fc47976e09f1d165b13146f066a9def5d7f91e2214ea8f7be62f',
  'audit-reliability': '7727e532ecd9231b0258dac0ad457ceeb263d48939e0958721432ea3258a8a51',
  'prospective-direction-audit': '546569fd5dade84b14e9a78a4bbd7a3a955287c211cc623337a8e10f673db688',
  'live-probe': 'd7830d7e50c4525e6127076f0b79674fd3a721bdf043a5095c4b96131429e351',
  'model-production-probe': '7a9c3a604d788413c855a2ad96e124c0286b7be7f0f4fbb19eefe85ebf7e8c4a',
  'market-production-audit': '5c2f3455323c386cc8bba3ba04c1651df17a7f3b4dbe879a986730bd4ab0993c',
  'phase4-production-audit': 'b6f4ac2323c1c3f83f428abfd544efad29df154c62591eb41181c6aa3373fc3a',
  'pricing-production-audit': 'b9da5f35e0d7eee4b5057f2fd2c79379b4484a64b98c0c020e888c7f1b2950c1',
  'release-041-smoke': '2c9abcaafd5add3e3d33e85e62513f993876fcca118823384d69a73e5b4522e4',
  'shadow-production-audit': '731473c61a93aa6d14853811c0247ef58d5c36cf1f81416bc0b5d10ddc509b0c',
  'v08-production-audit': '9bccf99ed61213aa9da3121628d69029fe96268de28760f5ed02fca0b716ff60'
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
  assert.equal(testedJobs, 17);
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
    assertWriterEvents(text, name, writerSchedules[name]);
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
    assertWriterEvents(text, name, writerSchedules[stem]);
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
  assert.deepEqual(found, {...writerSchedules,...auditSchedules});
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


test('Browser release CI preserves reviewed integrity job and uses isolated offline fixtures', async () => {
  const workflow=await read('ci');
  const original=workflow.split('  offline-browser:')[0];
  assert.equal(createHash('sha256').update(original).digest('hex'),'b811cd5dcd24f07336eb7264ba97e0b5c371b60e6f4cb6ae87802a855f37cb34');
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


test('Model-only schedule publishes only a reserved ledger, with isolated credential scope',async()=>{
 const text=await read('model-only-scheduled');
 assert.doesNotMatch(text.split('    steps:')[0],/runner\./);
 assert.match(text,/LEDGER_PATH=\$RUNNER_TEMP\/betq-model-only\/ledger.json/);
 assert.match(text,/>> \"\$GITHUB_ENV\"/);
 assert.match(text,/contents: write/);assert.doesNotMatch(text,/actions: write|permissions: write-all|secrets\.|ODDS_API_KEY|BETQ_OPERATOR_REFRESH_TOKEN|DATABASE_URL/);
 assert.match(text,/group: betq-model-only-scheduled-publication\n  cancel-in-progress: false/);
 assert.match(text,/persist-credentials: false/);
 const steps=text.split(/^      - /m);
 const tokenSteps=steps.filter(s=>s.includes('GITHUB_TOKEN:'));
 assert.equal(tokenSteps.length,2);for(const step of tokenSteps)assert.match(step,/run: node scripts\/publish-model-only-ledger\.mjs (reserve|final)/);
 assert.ok(text.indexOf('publish-model-only-ledger.mjs reserve')<text.indexOf('run-model-only-cycle.mjs capture'));
 assert.match(text,/if: always\(\)/);assert.match(text,/actions\/upload-artifact@v4/);
 const publisher=await readFile(new URL('../scripts/publish-model-only-ledger.mjs',import.meta.url),'utf8');
 assert.match(publisher,/BRANCH='evidence\/model-only-scheduled'/);
 assert.match(publisher,/force:false/);assert.match(publisher,/actual.data!==content/);
 assert.match(publisher,/delete env.GITHUB_TOKEN/);assert.match(publisher,/response.headers.get\('date'\)/);
});
