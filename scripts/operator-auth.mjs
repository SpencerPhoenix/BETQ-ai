/** Operator-only request construction. Never import into the public browser.
 * BETQ_OPERATOR_APPROVED_ORIGIN explicitly approves an alternate HTTPS origin.
 * BETQ_PRODUCTION_URL alone cannot redirect credentials to a different host.
 */
export const DEFAULT_OPERATOR_ORIGIN = 'https://betq-ai.onrender.com';
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw Error('OPERATOR_ORIGIN_INVALID');
  return url.origin;
}
export function operatorRequest(path, env = process.env) {
  const token = env.BETQ_OPERATOR_REFRESH_TOKEN?.trim();
  if (!token) throw Error('OPERATOR_TOKEN_MISSING');
  if (!/^[A-Za-z0-9._~-]{32,512}$/.test(token)) throw Error('OPERATOR_TOKEN_INVALID');
  const approved = origin(env.BETQ_OPERATOR_APPROVED_ORIGIN || DEFAULT_OPERATOR_ORIGIN);
  const target = origin(env.BETQ_PRODUCTION_URL || DEFAULT_OPERATOR_ORIGIN);
  const endpoint = new URL(path, target);
  if (endpoint.username || endpoint.password || endpoint.hash || target !== approved || endpoint.origin !== approved || !['/api/slate','/api/scores'].includes(endpoint.pathname))
    throw Error('OPERATOR_ORIGIN_NOT_APPROVED');
  return { endpoint, options: { redirect: 'error', signal: AbortSignal.timeout(100000),
    headers: { Accept: 'application/json', 'x-betq-paid-request': 'true', Authorization: 'Bearer ' + token } } };
}
