/** Isolated, manually approved transport diagnostic. Never imports application code. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const REPOSITORY = 'SpencerPhoenix/BETQ-ai';
export const BRANCH = 'refs/heads/feat/one-shot-odds-diagnostic-20261108';
export const MAIN_SHA = '69ca969eeef474b379a0b8bc729a1cdde348dc6e';
export const WORKFLOW_REF = `${REPOSITORY}/.github/workflows/live-probe.yml@${BRANCH}`;
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const integer = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,9})$/.test(value)
  ? Number(value) : null;

export function validRequestWindow(config) {
  const from = config?.commenceTimeFrom, to = config?.commenceTimeTo, date = config?.requestDateUtc;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      typeof from !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(from) ||
      to !== date + 'T23:59:59Z' || !from.startsWith(date + 'T')) return false;
  const start = Date.parse(from), end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end &&
    new Date(start).toISOString() === from.replace('Z', '.000Z') &&
    new Date(end).toISOString() === to.replace('Z', '.000Z');
}

export function preparedApproval(config) {
  return validRequestWindow(config) && config?.mainSha === MAIN_SHA && Number.isSafeInteger(config.expectedRunNumber) &&
    config.expectedRunNumber > 0 && config.expectedRunNumber <= 1_000_000_000 &&
    typeof config.repositorySecretName === 'string' &&
    /^[A-Z][A-Z0-9_]{0,99}$/.test(config.repositorySecretName) &&
    !/UNCONFIRMED|PLACEHOLDER|GITHUB_/.test(config.repositorySecretName);
}

export function approvedContext(context, config, now) {
  const expiry = Date.parse(context?.expiresAt);
  return preparedApproval(config) && context?.approved === 'true' &&
    context.repositorySecretConfirmed === 'true' && context.repository === REPOSITORY &&
    context.actor === 'SpencerPhoenix' && context.triggeringActor === 'SpencerPhoenix' &&
    context.event === 'workflow_dispatch' && context.ref === BRANCH &&
    context.workflowRef === WORKFLOW_REF && context.runAttempt === '1' &&
    context.runNumber === String(config.expectedRunNumber) && context.runnerDebug !== '1' &&
    sha(context.expectedSha) && context.expectedSha === context.actualSha &&
    context.workflowSha === context.actualSha &&
    context.currentMainSha === MAIN_SHA && Number.isSafeInteger(now) &&
    Number.isFinite(expiry) && new Date(expiry).toISOString() === context.expiresAt &&
    expiry > now && expiry <= now + 15 * 60_000 &&
    config.requestDateUtc === new Date(now).toISOString().slice(0, 10) &&
    Date.parse(config.commenceTimeFrom) > now && Date.parse(config.commenceTimeFrom) <= expiry;
}

export function contextFromEnvironment(env) {
  return {
    approved: env.ODDS_APPROVED, repositorySecretConfirmed: env.ODDS_SECRET_CONFIRMED,
    repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    actor: env.GITHUB_ACTOR, triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    workflowRef: env.GITHUB_WORKFLOW_REF, runAttempt: env.GITHUB_RUN_ATTEMPT,
    runNumber: env.GITHUB_RUN_NUMBER, runnerDebug: env.RUNNER_DEBUG,
    expectedSha: env.ODDS_EXPECTED_SHA, actualSha: env.GITHUB_SHA,
    currentMainSha: env.ODDS_CURRENT_MAIN_SHA, expiresAt: env.ODDS_EXPIRES_AT
  };
}

const result = (status, providerRequests = 0, extra = {}) => ({
  status, mode: 'ONE_SHOT_ODDS_TRANSPORT_DIAGNOSTIC', sport: 'americanfootball_nfl',
  market: 'h2h', region: 'us', providerRequests, retries: 0, redirectsFollowed: 0,
  maximumExpectedCredits: 1, productionRequests: 0, journalWrites: 0, ...extra
});

// No raw values leave these helpers. Date.parse alone accepts impossible or
// timezone-less dates, so require an explicit ISO calendar instant first.
export const MAX_DIAGNOSTIC_BODY_BYTES = 5_000_000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validMarketTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const offset = zone === 'Z' ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return false;
  const at = Date.parse(value), local = new Date(at + offset * 60_000);
  return Number.isFinite(at) && local.getUTCFullYear() === Number(year) &&
    local.getUTCMonth() + 1 === Number(month) && local.getUTCDate() === Number(day) &&
    local.getUTCHours() === Number(hour) && local.getUTCMinutes() === Number(minute) &&
    local.getUTCSeconds() === Number(second) && local.getUTCMilliseconds() === Number((fraction || '').padEnd(3, '0'));
}
const bodyResult = (status, counts = null) => ({status,
  timestampRule: 'EXPLICIT_ISO_CALENDAR_INSTANT',
  h2hMarkets: counts?.h2hMarkets ?? null,
  lastUpdatePresent: counts?.lastUpdatePresent ?? null,
  lastUpdateMissing: counts?.lastUpdateMissing ?? null,
  lastUpdateParseable: counts?.lastUpdateParseable ?? null,
  lastUpdateInvalid: counts?.lastUpdateInvalid ?? null});

export function summarizeH2hTimestamps(value, window = null) {
  if (!Array.isArray(value)) return bodyResult('INVALID_RESPONSE_SCHEMA');
  if (value.length > 256) return bodyResult('RESPONSE_LIMIT_EXCEEDED');
  if (window !== null && (!Number.isSafeInteger(window.observedAt) || !validRequestWindow(window)))
    return bodyResult('INVALID_OBSERVATION_WINDOW');
  const counts = {h2hMarkets: 0, lastUpdatePresent: 0, lastUpdateMissing: 0,
    lastUpdateParseable: 0, lastUpdateInvalid: 0};
  for (const event of value) {
    if (window !== null && (!validMarketTimestamp(event?.commence_time) ||
        Date.parse(event.commence_time) < Date.parse(window.commenceTimeFrom) ||
        Date.parse(event.commence_time) > Date.parse(window.commenceTimeTo) ||
        Date.parse(event.commence_time) <= window.observedAt)) return bodyResult('OUT_OF_SCOPE_RESPONSE');
    if (!record(event) || !Array.isArray(event.bookmakers)) return bodyResult('INVALID_RESPONSE_SCHEMA');
    if (event.bookmakers.length > 256) return bodyResult('RESPONSE_LIMIT_EXCEEDED');
    for (const book of event.bookmakers) {
      if (!record(book) || !Array.isArray(book.markets)) return bodyResult('INVALID_RESPONSE_SCHEMA');
      if (book.markets.length > 64) return bodyResult('RESPONSE_LIMIT_EXCEEDED');
      for (const market of book.markets) {
        if (!record(market) || typeof market.key !== 'string') return bodyResult('INVALID_RESPONSE_SCHEMA');
        if (market.key !== 'h2h') continue;
        if (++counts.h2hMarkets > 10000) return bodyResult('RESPONSE_LIMIT_EXCEEDED');
        if (!Object.hasOwn(market, 'last_update')) { counts.lastUpdateMissing++; continue; }
        counts.lastUpdatePresent++;
        if (validMarketTimestamp(market.last_update)) counts.lastUpdateParseable++;
        else counts.lastUpdateInvalid++;
      }
    }
  }
  return bodyResult(!value.length ? 'EMPTY_RESPONSE_INCONCLUSIVE' :
    !counts.h2hMarkets ? 'NO_H2H_MARKETS_INCONCLUSIVE' : 'COUNTED', counts);
}

async function inspectBody(response, signal, config, clock) {
  let reader;
  const cancelReader = () => { try { Promise.resolve(reader?.cancel()).catch(() => {}); } catch {} };
  try {
    const length = integer(response.headers.get('content-length'));
    if (length !== null && length > MAX_DIAGNOSTIC_BODY_BYTES) return bodyResult('BODY_TOO_LARGE');
    if (typeof response.body?.getReader !== 'function') return bodyResult('BODY_UNREADABLE');
    reader = response.body.getReader();
    signal.addEventListener('abort', cancelReader, {once: true});
    if (signal.aborted) cancelReader();
    const chunks = []; let bytes = 0, chunkCount = 0;
    while (!signal.aborted) {
      const {value, done} = await reader.read();
      if (signal.aborted) return bodyResult('BODY_TIMEOUT');
      if (done) break;
      if (++chunkCount > 4096) return bodyResult('BODY_TOO_FRAGMENTED');
      if (!(value instanceof Uint8Array)) return bodyResult('BODY_UNREADABLE');
      bytes += value.byteLength;
      if (bytes > MAX_DIAGNOSTIC_BODY_BYTES) return bodyResult('BODY_TOO_LARGE');
      chunks.push(value);
    }
    if (signal.aborted) return bodyResult('BODY_TIMEOUT');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, bytes))); }
    catch { return bodyResult('INVALID_JSON'); }
    return summarizeH2hTimestamps(value, {...config, observedAt: clock()});
  } catch { return bodyResult('BODY_UNREADABLE'); }
  finally {
    // Cancellation is best effort and must not create an unbounded new await.
    signal.removeEventListener('abort', cancelReader);
    cancelReader();
    try { reader?.releaseLock?.(); } catch {}
  }
}

/** Only constant enums, bounded numbers and nulls can cross this output boundary. */
export async function runOneShot({context, config, apiKey, fetchImpl = globalThis.fetch,
  clock = Date.now, timeoutMs = 10_000} = {}) {
  let now;
  try {
    now = clock();
    if (!approvedContext(context, config, now)) return result('NOT_APPROVED');
    if (typeof apiKey !== 'string' || !apiKey) return result('CREDENTIAL_REQUIRED');
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(apiKey)) return result('INVALID_CREDENTIAL_FORMAT');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000)
      return result('INVALID_LOCAL_CONFIGURATION');
  } catch { return result('INVALID_LOCAL_CONFIGURATION'); }
  const controller = new AbortController();
  let timer, response, attempted = 0, received = {};
  const target = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
  target.search = new URLSearchParams({apiKey, regions: 'us', markets: 'h2h',
    oddsFormat: 'decimal', dateFormat: 'iso', commenceTimeFrom: config.commenceTimeFrom,
    commenceTimeTo: config.commenceTimeTo}).toString();
  const clean = output => JSON.stringify(output).includes(apiKey) ? result('REDACTED_RESULT', attempted) : output;
  const cancelBody = () => { try { Promise.resolve(response?.body?.cancel()).catch(() => {}); } catch {} };
  const operation = (async () => {
    // This is the sole provider invocation. No health request, retry, redirect or app call.
    attempted = 1;
    response = await fetchImpl(target.href, {method: 'GET', redirect: 'manual',
      headers: {Accept: 'application/json'}, signal: controller.signal});
    if (controller.signal.aborted) { cancelBody(); return result('REQUEST_TIMEOUT', attempted); }
    if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599)
      return result('INVALID_PROVIDER_RESPONSE', attempted);
    if (response.redirected || response.url !== target.href)
      return result('UNEXPECTED_RESPONSE_ORIGIN', attempted);
    const httpStatus = response.status;
    if (httpStatus >= 300 && httpStatus < 400) return result('REDIRECT_BLOCKED', attempted, {httpStatus});
    const quota = {
      remaining: integer(response.headers.get('x-requests-remaining')),
      used: integer(response.headers.get('x-requests-used')),
      lastRequestCost: integer(response.headers.get('x-requests-last'))
    };
    received = {httpStatus, quota};
    const status = httpStatus === 200
      ? quota.lastRequestCost === null ? 'HTTP_OK_QUOTA_UNVERIFIED'
        : quota.lastRequestCost > 1 ? 'UNEXPECTED_REPORTED_COST' : 'HTTP_OK'
      : httpStatus === 401 || httpStatus === 403 ? 'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'
        : httpStatus === 429 ? 'RATE_LIMITED' : 'PROVIDER_HTTP_ERROR';
    // Error/redirect bodies are never inspected. Successful bodies exist only
    // in bounded transient memory; only allowlisted aggregate counts escape.
    if (httpStatus !== 200) return clean(result(status, attempted, received));
    const bodyDiagnostic = await inspectBody(response, controller.signal, config, clock);
    if (controller.signal.aborted) return result('REQUEST_TIMEOUT', attempted, received);
    const bodySucceeded = ['COUNTED', 'EMPTY_RESPONSE_INCONCLUSIVE', 'NO_H2H_MARKETS_INCONCLUSIVE'].includes(bodyDiagnostic.status);
    return clean(result(status === 'HTTP_OK' && !bodySucceeded ? 'HTTP_OK_BODY_DIAGNOSTIC_FAILED' : status,
      attempted, {...received, bodyDiagnostic}));
  })();
  try {
    return await Promise.race([operation, new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); cancelBody();
        resolve(clean(result('REQUEST_TIMEOUT', attempted, received))); }, timeoutMs);
    })]);
  } catch { return clean(result(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED', attempted, received)); }
  finally { clearTimeout(timer); controller.abort(); cancelBody(); }
}

async function main() {
  let apiKey = process.env.ODDS_ONE_SHOT_KEY;
  delete process.env.ODDS_ONE_SHOT_KEY;
  try {
    if (process.argv.length !== 2) throw Error('NO_ARGUMENTS');
    const config = JSON.parse(await readFile(new URL('./approval.json', import.meta.url), 'utf8'));
    const output = await runOneShot({context: contextFromEnvironment(process.env), config, apiKey});
    process.stdout.write(JSON.stringify(output) + '\n');
    if (output.status !== 'HTTP_OK') process.exitCode = 1;
  } catch { process.stdout.write(JSON.stringify(result('LOCAL_PREFLIGHT_FAILED')) + '\n'); process.exitCode = 1; }
  finally { apiKey = undefined; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
