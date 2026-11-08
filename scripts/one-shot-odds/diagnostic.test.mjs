import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MAIN_SHA, REPOSITORY, BRANCH, WORKFLOW_REF, preparedApproval, approvedContext,
  contextFromEnvironment, runOneShot} from './run.mjs';
import {workflowBindingMatches, allowedDiagnosticChanges} from './verify.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const now = Date.parse('2026-11-08T12:00:00.000Z');
const key = 'synthetic_test_key_not_a_real_credential';
const config = {mainSha: MAIN_SHA, expectedRunNumber: 69, repositorySecretName: 'SYNTHETIC_ODDS_KEY'};
const context = {approved: 'true', repositorySecretConfirmed: 'true', repository: REPOSITORY,
  actor: 'SpencerPhoenix', triggeringActor: 'SpencerPhoenix', workflowSha: 'a'.repeat(40),
  event: 'workflow_dispatch', ref: BRANCH, workflowRef: WORKFLOW_REF, runAttempt: '1', runNumber: '69',
  runnerDebug: '0', expectedSha: 'a'.repeat(40), actualSha: 'a'.repeat(40), currentMainSha: MAIN_SHA,
  expiresAt: '2026-11-08T12:10:00.000Z'};
const options = extra => ({context, config, apiKey: key, clock: () => now, ...extra});
function response(url, {status = 200, redirected = false, responseUrl = url,
  headers = {'x-requests-remaining': '6000', 'x-requests-used': '4000', 'x-requests-last': '1'}} = {}) {
  return {status, redirected, url: responseUrl, headers: new Headers(headers),
    body: {cancel: async () => {}}, text() {throw Error('BODY MUST NOT BE READ');},
    json() {throw Error('BODY MUST NOT BE READ');}};
}
const forbidden = async () => {throw Error('FORBIDDEN_TRANSPORT');};

test('incomplete template deliberately cannot run or bind any secret', async () => {
  const local = {mainSha: MAIN_SHA, expectedRunNumber: null, repositorySecretName: null};
  assert.equal(local.repositorySecretName, null);
  assert.equal(local.expectedRunNumber, null);
  assert.equal(preparedApproval(local), false);
  let calls = 0;
  const output = await runOneShot(options({config: local, fetchImpl: async () => {calls++;}}));
  assert.equal(output.status, 'NOT_APPROVED');
  assert.equal(calls, 0);
});

test('reviewed synthetic context accepts precisely one workflow run number', () => {
  assert.equal(approvedContext(context, config, now), true);
  for (const runNumber of ['68', '70', '069', '69.0', '', null])
    assert.equal(approvedContext({...context, runNumber}, config, now), false);
});

for (const [field, value] of Object.entries({approved: 'false', repositorySecretConfirmed: 'false',
  repository: 'elsewhere/BETQ-ai', event: 'push', ref: 'refs/heads/main', workflowRef: WORKFLOW_REF + 'extra',
  actor: 'another-user', triggeringActor: 'another-user', workflowSha: 'b'.repeat(40),
  runAttempt: '2', runNumber: '70', runnerDebug: '1', expectedSha: 'b'.repeat(40),
  actualSha: 'b'.repeat(40), currentMainSha: '0'.repeat(40), expiresAt: '2026-11-08T12:00:00.000Z'})) {
  test(`unapproved ${field} stops before transport`, async () => {
    let calls = 0;
    const output = await runOneShot(options({context: {...context, [field]: value},
      fetchImpl: async () => {calls++;}}));
    assert.equal(output.status, 'NOT_APPROVED'); assert.equal(calls, 0);
  });
}

for (const expiresAt of ['2026-11-08T12:15:00.001Z', '2026-11-08T12:10:00Z',
  '2026-11-08T12:10:00.000+00:00', '2026-11-08 12:10', 'not a date', '', null]) {
  test(`noncanonical or excessive expiry rejects: ${expiresAt}`, () => {
    assert.equal(approvedContext({...context, expiresAt}, config, now), false);
  });
}

test('missing, placeholder or changed preparation cannot authorize spending', () => {
  for (const changed of [{mainSha: '0'.repeat(40)}, {expectedRunNumber: null}, {expectedRunNumber: 0},
    {expectedRunNumber: -1}, {expectedRunNumber: 1.5}, {expectedRunNumber: 1e15},
    {repositorySecretName: null}, {repositorySecretName: 'UNCONFIRMED'},
    {repositorySecretName: 'PLACEHOLDER_KEY'}, {repositorySecretName: 'GITHUB_TOKEN'},
    {repositorySecretName: 'SECRET\nINJECT'}])
    assert.equal(approvedContext(context, {...config, ...changed}, now), false);
  assert.equal(approvedContext(context, config, NaN), false);
  assert.equal(approvedContext(context, config, now + 0.1), false);
});

test('credential validation and invalid timeout do not call transport', async () => {
  for (const apiKey of [undefined, '', '\n' + key, key + ' ', 'short', 'a'.repeat(257), 'foo:bar'.repeat(5)]) {
    const output = await runOneShot(options({apiKey, fetchImpl: forbidden}));
    assert.equal(output.providerRequests, 0);
    assert.match(output.status, /CREDENTIAL/);
  }
  for (const timeoutMs of [0, -1, Infinity, 15_001, 1.1]) {
    const output = await runOneShot(options({timeoutMs, fetchImpl: forbidden}));
    assert.equal(output.status, 'INVALID_LOCAL_CONFIGURATION'); assert.equal(output.providerRequests, 0);
  }
});

test('exactly one fixed NFL h2h US GET with no redirects or arbitrary parameters', async () => {
  const calls = [];
  const output = await runOneShot(options({fetchImpl: async (url, request) => {
    calls.push({url, request}); return response(url);
  }}));
  assert.equal(calls.length, 1);
  const {url, request} = calls[0], parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.the-odds-api.com');
  assert.equal(parsed.pathname, '/v4/sports/americanfootball_nfl/odds/');
  assert.deepEqual(Object.fromEntries(parsed.searchParams), {apiKey: key, regions: 'us', markets: 'h2h',
    oddsFormat: 'american', dateFormat: 'iso'});
  assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'manual');
  assert.deepEqual(request.headers, {Accept: 'application/json'});
  assert.equal(request.signal.aborted, true);
  assert.equal(output.status, 'HTTP_OK'); assert.equal(output.providerRequests, 1);
  assert.deepEqual(output.quota, {remaining: 6000, used: 4000, lastRequestCost: 1});
  assert.equal(output.productionRequests, 0); assert.equal(output.journalWrites, 0);
  assert.equal(output.retries, 0); assert.equal(output.redirectsFollowed, 0);
  assert.ok(!JSON.stringify(output).includes(key)); assert.ok(!JSON.stringify(output).includes('https:'));
});

for (const status of [301, 302, 303, 307, 308]) {
  test(`redirect ${status} never follows Location`, async () => {
    let calls = 0;
    const output = await runOneShot(options({fetchImpl: async url => {
      calls++; return response(url, {status, headers: {location: 'https://evil.invalid/?key=' + key}});
    }}));
    assert.equal(output.status, 'REDIRECT_BLOCKED'); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(output).includes(key));
  });
}

test('redirected or mismatched response URL is rejected with no body read', async () => {
  for (const changed of [{redirected: true}, {responseUrl: ''},
    {responseUrl: 'https://evil.invalid/'}, {responseUrl: 'https://api.the-odds-api.com/other'}]) {
    const output = await runOneShot(options({fetchImpl: async url => response(url, changed)}));
    assert.equal(output.status, 'UNEXPECTED_RESPONSE_ORIGIN');
  }
});

for (const [status, expected] of [[401, 'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'],
  [403, 'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'], [429, 'RATE_LIMITED'],
  [400, 'PROVIDER_HTTP_ERROR'], [500, 'PROVIDER_HTTP_ERROR'], [503, 'PROVIDER_HTTP_ERROR']]) {
  test(`HTTP ${status} is sanitized and never retried`, async () => {
    let calls = 0;
    const output = await runOneShot(options({fetchImpl: async url => {
      calls++; return response(url, {status});
    }}));
    assert.equal(output.status, expected); assert.equal(calls, 1); assert.equal(output.httpStatus, status);
  });
}

test('numeric quota headers are tightly bounded and never echoed as strings', async () => {
  for (const malicious of [key, 'https://evil.invalid/' + key, '1e3', '-1', '1.5', 'NaN',
    '01', '12345678901234567890', '1;echo unsafe']) {
    const output = await runOneShot(options({fetchImpl: async url => response(url,
      {headers: {'x-requests-remaining': malicious, 'x-requests-used': malicious, 'x-requests-last': malicious}})}));
    assert.equal(output.status, 'HTTP_OK_QUOTA_UNVERIFIED');
    assert.deepEqual(output.quota, {remaining: null, used: null, lastRequestCost: null});
    assert.ok(!JSON.stringify(output).includes(malicious));
  }
});

test('zero cost, missing cost and unexpected larger cost are distinguished', async () => {
  for (const [value, status] of [['0', 'HTTP_OK'], ['1', 'HTTP_OK'], ['2', 'UNEXPECTED_REPORTED_COST'],
    [null, 'HTTP_OK_QUOTA_UNVERIFIED']]) {
    const output = await runOneShot(options({fetchImpl: async url => response(url,
      {headers: value === null ? {} : {'x-requests-last': value}})}));
    assert.equal(output.status, status);
    assert.equal(output.quota.lastRequestCost, value === null ? null : Number(value));
  }
});

test('malformed response and thrown errors cannot disclose key, URL or body', async () => {
  for (const fetchImpl of [async () => {throw Error('https://example.invalid/?apiKey=' + key);},
    async () => ({status: 999}), async () => ({status: key}),
    async url => ({...response(url), headers: {get() {throw Error(key);}}})]) {
    const output = await runOneShot(options({fetchImpl}));
    assert.ok(['REQUEST_FAILED', 'INVALID_PROVIDER_RESPONSE'].includes(output.status));
    assert.equal(output.providerRequests, 1);
    assert.ok(!JSON.stringify(output).includes(key)); assert.ok(!JSON.stringify(output).includes('https:'));
  }
});

test('timeout is bounded even when mocked fetch ignores abort; no retry follows', async () => {
  let calls = 0, signal;
  const output = await runOneShot(options({timeoutMs: 5, fetchImpl: (_url, request) => {
    calls++; signal = request.signal; return new Promise(() => {});
  }}));
  assert.equal(output.status, 'REQUEST_TIMEOUT'); assert.equal(calls, 1); assert.equal(signal.aborted, true);
});

test('late response after deadline is cancelled and not read', async () => {
  let resolve, cancelled = 0;
  const pending = runOneShot(options({timeoutMs: 5, fetchImpl: url => new Promise(done => {
    resolve = () => done({...response(url), body: {cancel: async () => {cancelled++;}}});
  })}));
  assert.equal((await pending).status, 'REQUEST_TIMEOUT');
  resolve(); await new Promise(done => setImmediate(done));
  assert.ok(cancelled > 0);
});

test('CLI without exact GitHub approval exits without a request and prints only fixed diagnostic JSON', () => {
  const env = {PATH: process.env.PATH, HOME: '/tmp', ODDS_ONE_SHOT_KEY: key};
  const output = spawnSync(process.execPath, ['scripts/one-shot-odds/run.mjs'], {cwd: root, env, encoding: 'utf8'});
  assert.equal(output.status, 1); assert.equal(output.stderr, '');
  const value = JSON.parse(output.stdout);
  assert.equal(value.status, 'NOT_APPROVED'); assert.equal(value.providerRequests, 0);
  assert.ok(!output.stdout.includes(key));
});

test('environment maps only approval metadata, never the credential', () => {
  const result = contextFromEnvironment({ODDS_ONE_SHOT_KEY: key, ODDS_APPROVED: 'true',
    GITHUB_RUN_NUMBER: '69', GITHUB_WORKFLOW_REF: WORKFLOW_REF});
  assert.equal(result.approved, 'true'); assert.equal(result.runNumber, '69');
  assert.equal(result.workflowRef, WORKFLOW_REF); assert.ok(!JSON.stringify(result).includes(key));
});

test('workflow is manual, read-only, pinned, final-step-only credential with no package install', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/live-probe.yml', import.meta.url), 'utf8');
  assert.match(workflow, /^name: BETQ production feed probe\n/);
  assert.match(workflow, /\non:\n  workflow_dispatch:\n/);
  assert.doesNotMatch(workflow, /\n  (push|schedule|pull_request|workflow_run|repository_dispatch):/);
  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(workflow, /: write|npm (ci|install)|upload-artifact|pull_request_target/);
  assert.ok(workflow.includes('ODDS_ONE_SHOT_KEY: ${{ secrets.ODDS_API_KEY }}'));
  assert.equal((workflow.match(/secrets\./g) || []).length, 1);
  const local = JSON.parse(readFileSync(new URL('./approval.json', import.meta.url)));
  assert.equal(local.repositorySecretName, 'ODDS_API_KEY');
  assert.equal(local.expectedRunNumber, 71);
  assert.equal(preparedApproval(local), true);
  assert.ok(workflow.includes(`github.run_number == ${local.expectedRunNumber}`));
  assert.ok(workflow.includes("github.actor == 'SpencerPhoenix'"));
  assert.ok(workflow.includes("github.triggering_actor == 'SpencerPhoenix'"));
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.ok(workflow.includes(`github.ref == '${BRANCH}'`));
  assert.equal((workflow.match(/git ls-remote --exit-code/g) || []).length, 2);
  assert.equal((workflow.match(/node scripts\/one-shot-odds\/run.mjs/g) || []).length, 1);
  assert.equal((workflow.match(/uses: [\w/-]+@[a-f0-9]{40}/g) || []).length, 2);
  assert.ok(workflow.indexOf('npm test') < workflow.indexOf('ODDS_ONE_SHOT_KEY:'));
  assert.doesNotMatch(workflow, /betq-ai\.onrender|\/api\/slate/);
});

test('all baseline application files, data and other workflows stay byte-identical', () => {
  const git = args => execFileSync('git', args, {cwd: root, maxBuffer: 20_000_000});
  const paths = git(['ls-tree', '-r', '--name-only', MAIN_SHA]).toString().trim().split('\n');
  for (const path of paths) {
    if (path === '.github/workflows/live-probe.yml') continue;
    assert.deepEqual(readFileSync(new URL('../../' + path, import.meta.url)), git(['show', `${MAIN_SHA}:${path}`]), path);
  }
});

test('secret binding must be the sole real final-step binding, not a matching comment', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/live-probe.yml', import.meta.url), 'utf8');
  assert.equal(workflowBindingMatches(workflow, 'ODDS_API_KEY'), true);
  for (const changed of [workflow.replace('ODDS_ONE_SHOT_KEY:', '# ODDS_ONE_SHOT_KEY:'),
    workflow.replace('secrets.ODDS_API_KEY', 'secrets.ANOTHER_KEY'),
    workflow.replace('    env:\n', '    env:\n      EARLY_KEY: ${{ secrets.ODDS_API_KEY }}\n'),
    workflow.replace('    env:\n', '    env:\n      EARLY_KEY: ${{ true && secrets.ODDS_API_KEY }}\n'),
    workflow.replace('    env:\n', "    env:\n      EARLY_KEY: ${{ format('{0}', secrets.ODDS_API_KEY) }}\n"),
    workflow + '      - run: echo unsafe\n',
    workflow.replace('node scripts/one-shot-odds/run.mjs', 'echo skip'),
    workflow.replace('secrets.ODDS_API_KEY', 'secrets[inputs.secret_name]')])
    assert.equal(workflowBindingMatches(changed, 'ODDS_API_KEY'), false);
});

test('baseline path allowlist admits the actual README and rejects all non-diagnostic changes', () => {
  assert.equal(allowedDiagnosticChanges(['.github/workflows/live-probe.yml',
    'scripts/one-shot-odds/README.md', 'scripts/one-shot-odds/approval.json',
    'scripts/one-shot-odds/diagnostic.test.mjs', 'scripts/one-shot-odds/run.mjs',
    'scripts/one-shot-odds/verify.mjs']), true);
  for (const path of ['data/evidence/nfl-2026.json', 'src/odds.mjs', 'package.json',
    'scripts/one-shot-odds/new-file.mjs', '.github/workflows/capture-evidence.yml', ''])
    assert.equal(allowedDiagnosticChanges(['scripts/one-shot-odds/README.md', path]), false);
  assert.equal(allowedDiagnosticChanges([]), false);
});


test('proposed local configuration admits only run 71 and rejects consumed or additional runs', () => {
  const local = JSON.parse(readFileSync(new URL('./approval.json', import.meta.url)));
  assert.equal(approvedContext({...context, runNumber: '71'}, local, now), true);
  for (const runNumber of ['69', '70', '72', '071', '71.0'])
    assert.equal(approvedContext({...context, runNumber}, local, now), false);
  assert.equal(approvedContext({...context, runNumber: '71', runAttempt: '2'}, local, now), false);
});
