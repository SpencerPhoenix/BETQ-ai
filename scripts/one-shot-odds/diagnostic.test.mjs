import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MAIN_SHA, REPOSITORY, BRANCH, WORKFLOW_REF, preparedApproval, approvedContext,
  contextFromEnvironment, runOneShot, summarizeH2hTimestamps, MAX_DIAGNOSTIC_BODY_BYTES} from './run.mjs';
import {workflowBindingMatches, allowedDiagnosticChanges} from './verify.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const now = Date.parse('2026-11-08T12:00:00.000Z');
const key = 'synthetic_test_key_not_a_real_credential';
const window = {requestDateUtc: '2026-11-08', commenceTimeFrom: '2026-11-08T12:05:00Z', commenceTimeTo: '2026-11-08T23:59:59Z'};
const config = {...window, mainSha: MAIN_SHA, expectedRunNumber: 69, repositorySecretName: 'SYNTHETIC_ODDS_KEY'};
const context = {approved: 'true', repositorySecretConfirmed: 'true', repository: REPOSITORY,
  actor: 'SpencerPhoenix', triggeringActor: 'SpencerPhoenix', workflowSha: 'a'.repeat(40),
  event: 'workflow_dispatch', ref: BRANCH, workflowRef: WORKFLOW_REF, runAttempt: '1', runNumber: '69',
  runnerDebug: '0', expectedSha: 'a'.repeat(40), actualSha: 'a'.repeat(40), currentMainSha: MAIN_SHA,
  expiresAt: '2026-11-08T12:10:00.000Z'};
const options = extra => ({context, config, apiKey: key, clock: () => now, ...extra});
function response(url, {status = 200, redirected = false, responseUrl = url,
  headers = {'x-requests-remaining': '6000', 'x-requests-used': '4000', 'x-requests-last': '1'}, body = []} = {}) {
  return {status, redirected, url: responseUrl, headers: new Headers(headers),
    body: new Response(typeof body === 'string' ? body : JSON.stringify(body)).body, text() {throw Error('UNBOUNDED BODY READ');},
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
    oddsFormat: 'decimal', dateFormat: 'iso', commenceTimeFrom: window.commenceTimeFrom, commenceTimeTo: window.commenceTimeTo});
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
  assert.equal(local.expectedRunNumber, 72);
  assert.equal(preparedApproval(local), true); // Reviewed same-day future kickoff bounds.
  assert.equal(local.requestDateUtc, '2026-11-08');
  assert.equal(local.commenceTimeFrom, '2026-11-08T16:50:00Z');
  assert.equal(local.commenceTimeTo, '2026-11-08T23:59:59Z');
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


test('reviewed run 72 still requires a valid window and cannot rearm other run numbers', () => {
  const local = JSON.parse(readFileSync(new URL('./approval.json', import.meta.url)));
  assert.equal(approvedContext({...context, runNumber: '72'}, local, now), false);
  assert.equal(approvedContext({...context, runNumber: '72'}, {...local,...window}, now), true);
  for (const runNumber of ['69', '70', '71', '73', '072', '72.0'])
    assert.equal(approvedContext({...context, runNumber}, {...local,...window}, now), false);
  assert.equal(approvedContext({...context, runNumber: '72', runAttempt: '2'}, {...local,...window}, now), false);
});

const market = value => ({key: 'h2h', last_update: value});
const bodyWith = markets => [{commence_time: '2026-11-08T18:00:00Z', bookmakers: [{markets}]}];
const counted = body => runOneShot(options({fetchImpl: async url => response(url, {body})}));

test('only h2h market timestamp aggregate counts escape a successful response', async () => {
  const body = bodyWith([market('2026-11-08T11:59:58Z'), market('2026-11-08T06:59:58.123-05:00'),
    {key: 'h2h'}, market(null), market(123), market('2026-11-08T11:59:58'),
    {key: 'spreads', last_update: 'ignored'}]);
  body[0].id = key; body[0].home_team = 'PRIVATE_TEAM_SENTINEL';
  body[0].bookmakers[0].last_update = '2026-11-08T12:00:00Z';
  body[0].bookmakers[0].markets[0].outcomes = [{name: 'SECRET_OUTCOME', price: 1.23456789}];
  body[0].provider_message = 'https://example.invalid/?apiKey=' + key;
  const output = await counted(body), encoded = JSON.stringify(output);
  assert.equal(output.status, 'HTTP_OK');
  assert.deepEqual(output.bodyDiagnostic, {status: 'COUNTED', timestampRule: 'EXPLICIT_ISO_CALENDAR_INSTANT',
    h2hMarkets: 6, lastUpdatePresent: 5, lastUpdateMissing: 1, lastUpdateParseable: 2, lastUpdateInvalid: 3});
  for (const forbidden of [key, 'PRIVATE_TEAM_SENTINEL', 'SECRET_OUTCOME', '1.23456789', '2026-', 'https:'])
    assert.ok(!encoded.includes(forbidden));
});

test('empty response and absence of h2h markets are explicitly inconclusive', async () => {
  assert.equal((await counted([])).bodyDiagnostic.status, 'EMPTY_RESPONSE_INCONCLUSIVE');
  assert.equal((await counted(bodyWith([{key: 'totals', last_update: '2026-11-08T11:59:58Z'}]))).bodyDiagnostic.status,
    'NO_H2H_MARKETS_INCONCLUSIVE');
  assert.equal((await counted([])).bodyDiagnostic.h2hMarkets, 0);
});

test('strict timestamp parseability never borrows bookmaker time or normalizes invalid source dates', () => {
  const invalid = [null, 0, true, {}, '', '2026-11-31T12:00:00Z', '2026-02-29T12:00:00Z',
    '2026-11-08T24:00:00Z', '2026-11-08T12:00:60Z', '2026-11-08T12:00:00+24:00',
    '2026-11-08T12:00:00+00:60', '2026-11-08T12:00:00.1234Z', '2026-11-08 12:00:00Z', '2026-11-08T12:00:00'];
  const valid = ['2024-02-29T12:00:00Z', '2026-11-08T12:00:00.1Z', '2026-11-08T12:00:00.123+05:30'];
  const body = bodyWith([...invalid, ...valid].map(market));
  body[0].bookmakers[0].last_update = '2026-11-08T11:59:59Z';
  const counts = summarizeH2hTimestamps(body);
  assert.equal(counts.lastUpdateParseable, valid.length); assert.equal(counts.lastUpdateInvalid, invalid.length);
  assert.equal(summarizeH2hTimestamps(bodyWith([{key: 'h2h'}])).lastUpdateMissing, 1);
});

for (const [label, body] of [['object', {}], ['null-event', [null]], ['missing-books', [{}]],
  ['null-book', [{bookmakers: [null]}]], ['missing-markets', [{bookmakers: [{}]}]],
  ['null-market', bodyWith([null])], ['bad-market-key', bodyWith([{key: 1}])]]) {
  test('malformed response shape rejects without exposing partial counts: ' + label, async () => {
    const output = await counted(body);
    assert.equal(output.status, 'HTTP_OK_BODY_DIAGNOSTIC_FAILED');
    assert.ok(['INVALID_RESPONSE_SCHEMA', 'OUT_OF_SCOPE_RESPONSE'].includes(output.bodyDiagnostic.status));
    assert.equal(output.bodyDiagnostic.h2hMarkets, null);
  });
}

test('response arrays and h2h totals have explicit limits', () => {
  assert.equal(summarizeH2hTimestamps(Array(257).fill({})).status, 'RESPONSE_LIMIT_EXCEEDED');
  assert.equal(summarizeH2hTimestamps([{bookmakers: Array(257).fill({})}]).status, 'RESPONSE_LIMIT_EXCEEDED');
  assert.equal(summarizeH2hTimestamps(bodyWith(Array(65).fill({key:'h2h'}))).status, 'RESPONSE_LIMIT_EXCEEDED');
  const huge=[{bookmakers:Array.from({length:157},()=>({markets:Array.from({length:64},()=>({key:'h2h'}))}))}];
  assert.equal(summarizeH2hTimestamps(huge).status,'RESPONSE_LIMIT_EXCEEDED');
});

test('non-JSON and invalid UTF-8 bodies are sanitized while known HTTP and quota survive', async () => {
  for (const body of ['not JSON ' + key, '{"unterminated":"' + key]) {
    const output = await counted(body);
    assert.equal(output.status,'HTTP_OK_BODY_DIAGNOSTIC_FAILED');assert.equal(output.bodyDiagnostic.status,'INVALID_JSON');
    assert.equal(output.httpStatus,200);assert.equal(output.quota.lastRequestCost,1);
    assert.ok(!JSON.stringify(output).includes(key));
  }
  const output=await runOneShot(options({fetchImpl:async url=>({...response(url),body:new Response(Uint8Array.of(255)).body})}));
  assert.equal(output.bodyDiagnostic.status,'INVALID_JSON');
});

test('actual streamed body bytes are bounded even without a trustworthy Content-Length', async () => {
  let cancel=0,reads=0;
  const output=await runOneShot(options({fetchImpl:async url=>({...response(url),body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(MAX_DIAGNOSTIC_BODY_BYTES+1)};},
    cancel:async()=>{cancel++;}})}})}));
  assert.equal(output.bodyDiagnostic.status,'BODY_TOO_LARGE');assert.equal(reads,1);assert.equal(cancel,1);
  const declared=await runOneShot(options({fetchImpl:async url=>response(url,{headers:{'content-length':String(MAX_DIAGNOSTIC_BODY_BYTES+1)}})}));
  assert.equal(declared.bodyDiagnostic.status,'BODY_TOO_LARGE');
});

test('tiny or empty chunks are bounded independently from body bytes', async () => {
  let reads=0,cancelled=0;
  const output=await runOneShot(options({fetchImpl:async url=>({...response(url),body:{getReader:()=>({
    read:async()=>{reads++;return {done:false,value:new Uint8Array(0)};},cancel:async()=>{cancelled++;}})}})}));
  assert.equal(output.bodyDiagnostic.status,'BODY_TOO_FRAGMENTED');assert.equal(reads,4097);assert.equal(cancelled,1);
});

test('stalled body deadline cancels the active reader and preserves known transport accounting', async () => {
  let calls=0,cancelled=0,resolveRead;
  const output=await runOneShot(options({timeoutMs:5,fetchImpl:async url=>{
    calls++;return {...response(url),body:{getReader:()=>({read:()=>new Promise(resolve=>{resolveRead=resolve;}),
      cancel:async()=>{cancelled++;resolveRead?.({done:true});}}),cancel:async()=>{throw Error('reader lock');}}};
  }}));
  assert.equal(output.status,'REQUEST_TIMEOUT');assert.equal(output.httpStatus,200);assert.equal(output.quota.lastRequestCost,1);
  assert.equal(calls,1);assert.ok(cancelled>=1);assert.equal(output.bodyDiagnostic,undefined);
});

test('error and redirect body readers are never acquired', async () => {
  for (const status of [301,401,403,429,500]) {
    let acquired=0;
    const output=await runOneShot(options({fetchImpl:async url=>({...response(url,{status}),body:{
      getReader(){acquired++;throw Error(key);},cancel:async()=>{}}})}));
    assert.equal(acquired,0);assert.equal(output.providerRequests,1);assert.equal(output.bodyDiagnostic,undefined);
  }
});

test('stream failure is sanitized with no retry or reflected body error', async () => {
  let calls=0;
  const output=await runOneShot(options({fetchImpl:async url=>{calls++;return {...response(url),body:{getReader:()=>({
    read:async()=>{throw Error('https://bad.invalid/?key='+key);},cancel:async()=>{}})}};}}));
  assert.equal(output.bodyDiagnostic.status,'BODY_UNREADABLE');assert.equal(calls,1);assert.ok(!JSON.stringify(output).includes(key));
});

test('approval pins same-day UTC bounds and rejects stale, unbounded, malformed or future-day scope before fetching', async () => {
  for (const change of [{requestDateUtc:null},{commenceTimeFrom:null},{commenceTimeTo:null},
    {commenceTimeFrom:'2026-11-08T11:59:59Z'},{commenceTimeFrom:'2026-11-08T12:10:01Z'},
    {commenceTimeFrom:'2026-11-08T12:05:00.000Z'},{commenceTimeTo:'2026-11-09T00:00:00Z'},
    {requestDateUtc:'2026-11-09',commenceTimeFrom:'2026-11-09T12:05:00Z',commenceTimeTo:'2026-11-09T23:59:59Z'},
    {requestDateUtc:'2026-11-31',commenceTimeFrom:'2026-11-31T12:05:00Z',commenceTimeTo:'2026-11-31T23:59:59Z'}]) {
    const output=await runOneShot(options({config:{...config,...change},fetchImpl:forbidden}));
    assert.equal(output.status,'NOT_APPROVED');assert.equal(output.providerRequests,0);
  }
});

test('unexpected out-of-scope or already-started response events cannot produce timestamp counts', async () => {
  for (const kickoff of [undefined,'bad','2026-11-08T12:00:00Z','2026-11-08T12:04:59Z','2026-11-09T00:00:00Z']) {
    const body=bodyWith([market('2026-11-08T11:59:58Z')]);body[0].commence_time=kickoff;
    const output=await counted(body);assert.equal(output.bodyDiagnostic.status,'OUT_OF_SCOPE_RESPONSE');
    assert.equal(output.bodyDiagnostic.h2hMarkets,null);
  }
  let ticks=0;
  const output=await runOneShot(options({clock:()=>ticks++===0?now:Date.parse('2026-11-08T18:00:00Z'),
    fetchImpl:async url=>response(url,{body:bodyWith([market('2026-11-08T11:59:58Z')])})}));
  assert.equal(output.bodyDiagnostic.status,'OUT_OF_SCOPE_RESPONSE');
});

test('real stalled WHATWG response stream is cancelled and its reader lock released on deadline', async () => {
  let cancelled=0;
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('['));},cancel(){cancelled++;}});
  const output=await runOneShot(options({timeoutMs:5,fetchImpl:async url=>({...response(url),body})}));
  assert.equal(output.status,'REQUEST_TIMEOUT');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,1);assert.equal(body.locked,false);
});


test('published-window proposal permits only run 72 before its exact future cutoff', () => {
  const local = JSON.parse(readFileSync(new URL('./approval.json', import.meta.url)));
  const current = Date.parse('2026-11-08T16:40:00.000Z');
  const approval = {...context, runNumber: '72', expiresAt: '2026-11-08T16:54:00.000Z'};
  assert.equal(approvedContext(approval, local, current), true);
  for (const runNumber of ['71', '73', '072'])
    assert.equal(approvedContext({...approval, runNumber}, local, current), false);
  assert.equal(approvedContext({...approval, runAttempt: '2'}, local, current), false);
  assert.equal(approvedContext({...approval, expiresAt: '2026-11-08T16:49:59.000Z'}, local, current), false);
  assert.equal(approvedContext(approval, local, Date.parse('2026-11-08T16:50:00.000Z')), false);
  assert.equal(approvedContext(approval, local, Date.parse('2026-11-08T16:50:00.001Z')), false);
  assert.equal(approvedContext({...approval, expiresAt: '2026-11-09T16:54:00.000Z'}, local,
    Date.parse('2026-11-09T16:40:00.000Z')), false);
});
