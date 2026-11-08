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

export function preparedApproval(config) {
  return config?.mainSha === MAIN_SHA && Number.isSafeInteger(config.expectedRunNumber) &&
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
    expiry > now && expiry <= now + 15 * 60_000;
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
  let timer, response, attempted = 0;
  const target = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/');
  target.search = new URLSearchParams({apiKey, regions: 'us', markets: 'h2h',
    oddsFormat: 'american', dateFormat: 'iso'}).toString();
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
    const status = httpStatus === 200
      ? quota.lastRequestCost === null ? 'HTTP_OK_QUOTA_UNVERIFIED'
        : quota.lastRequestCost > 1 ? 'UNEXPECTED_REPORTED_COST' : 'HTTP_OK'
      : httpStatus === 401 || httpStatus === 403 ? 'AUTHENTICATION_OR_ENTITLEMENT_REQUIRED'
        : httpStatus === 429 ? 'RATE_LIMITED' : 'PROVIDER_HTTP_ERROR';
    // Do not read response bodies, arbitrary headers, URLs, provider messages or odds.
    return clean(result(status, attempted, {httpStatus, quota}));
  })();
  try {
    return await Promise.race([operation, new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); cancelBody();
        resolve(result('REQUEST_TIMEOUT', attempted)); }, timeoutMs);
    })]);
  } catch { return result(controller.signal.aborted ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED', attempted); }
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
