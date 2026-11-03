/**
 * Pure, testable release-health classification for the read-only Render audit.
 * The single network probe is GET /api/health, never a sports/odds endpoint.
 */
const sha40 = /^[0-9a-f]{40}$/i;
const versionPattern = /^\d+\.\d+\.\d+$/;

export const RELEASE_STATES = Object.freeze({
  OK:'OK', STALE:'STALE', HTTP_ERROR:'HTTP_ERROR',
  TIMEOUT:'TIMEOUT', SCHEMA:'SCHEMA', UNREACHABLE:'UNREACHABLE'
});

function state(status,details={}) {
  return {status, ...details};
}
function expectedValid(expectedVersion,expectedCommit) {
  return typeof expectedVersion==='string' && versionPattern.test(expectedVersion) &&
    typeof expectedCommit==='string' && sha40.test(expectedCommit);
}

/** Classifies an HTTP 200 decoded /api/health response, with no I/O. */
export function classifyHealthResponse({httpStatus,body,expectedVersion,expectedCommit}) {
  if(!expectedValid(expectedVersion,expectedCommit)) throw Error('INVALID_EXPECTED_RELEASE');
  if (!Number.isInteger(httpStatus) || httpStatus<100 || httpStatus>599)
    return state(RELEASE_STATES.SCHEMA,{reason:'INVALID_HTTP_STATUS'});
  if(httpStatus!==200)
    return state(RELEASE_STATES.HTTP_ERROR,{httpStatus,reason:'NON_200_HEALTH'});
  if (!body || typeof body!=='object' || Array.isArray(body) ||
      body.app!=='BETQ.ai' || body.status!=='ok' ||
      typeof body.version!=='string' || !versionPattern.test(body.version))
    return state(RELEASE_STATES.SCHEMA,{httpStatus,reason:'INVALID_HEALTH_CONTRACT'});
  const actualVersion=body.version;
  const actualCommit=typeof body.commit==='string'&&sha40.test(body.commit)
    ?body.commit.toLowerCase():null;
  // Legacy deployed versions lack commit metadata: report as stale, not a
  // generic bad response, when the version itself is clearly different.
  if(actualVersion!==expectedVersion)
    return state(RELEASE_STATES.STALE,{httpStatus,reason:'VERSION_MISMATCH',
      actualVersion,actualCommit,expectedVersion,expectedCommit});
  if(!actualCommit)
    return state(RELEASE_STATES.SCHEMA,{httpStatus,reason:'MISSING_OR_INVALID_COMMIT',
      actualVersion,actualCommit});
  if(actualCommit!==expectedCommit.toLowerCase())
    return state(RELEASE_STATES.STALE,{httpStatus,reason:'COMMIT_MISMATCH',
      actualVersion,actualCommit,expectedVersion,expectedCommit});
  return state(RELEASE_STATES.OK,{httpStatus,reason:'VERSION_AND_COMMIT_MATCH',
    actualVersion,actualCommit,expectedVersion,expectedCommit});
}

/** Single bounded fetch with deterministic, non-throwing operational outcome. */
export async function probeDeploymentHealth({
  fetchImpl=globalThis.fetch,baseUrl='https://betq-ai.onrender.com',
  expectedVersion,expectedCommit,timeoutMs=15000
}={}) {
  if(!expectedValid(expectedVersion,expectedCommit))throw Error('INVALID_EXPECTED_RELEASE');
  if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)
    throw Error('INVALID_HEALTH_PROBE_CONFIGURATION');
  let response;
  try {
    response=await fetchImpl(baseUrl+'/api/health',{
      method:'GET',headers:{Accept:'application/json'},
      signal:AbortSignal.timeout(timeoutMs)
    });
  } catch(error) {
    const timedOut=error?.name==='AbortError'||error?.name==='TimeoutError'||
      error?.cause?.code==='ETIMEDOUT';
    return state(timedOut?RELEASE_STATES.TIMEOUT:RELEASE_STATES.UNREACHABLE,
      {reason:timedOut?'HEALTH_TIMEOUT':'NETWORK_UNREACHABLE'});
  }
  if(!response || !Number.isInteger(response.status))
    return state(RELEASE_STATES.SCHEMA,{reason:'INVALID_HTTP_RESPONSE'});
  if(response.status!==200)
    return classifyHealthResponse({
      httpStatus:response.status,body:null,expectedVersion,expectedCommit});
  let payload;
  try {
    const raw=await response.text();
    if(typeof raw!=='string'||raw.length>32000)
      return state(RELEASE_STATES.SCHEMA,{reason:'INVALID_HEALTH_BODY_SIZE',httpStatus:200});
    payload=JSON.parse(raw);
  } catch(error) {
    const timedOut=error?.name==='AbortError'||error?.name==='TimeoutError';
    return state(timedOut?RELEASE_STATES.TIMEOUT:RELEASE_STATES.SCHEMA,
      {reason:timedOut?'HEALTH_TIMEOUT':'INVALID_HEALTH_JSON',httpStatus:200});
  }
  return classifyHealthResponse({httpStatus:response.status,body:payload,
    expectedVersion,expectedCommit});
}
