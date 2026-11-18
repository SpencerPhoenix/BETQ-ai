# Owner session adapter: disabled preparation only

This module does not create an account, install an authentication service, enroll
credentials, enable a route, or authorize provider spending. It is not a complete
production login system. The owner-refresh trial and provider-budget ledgers are
still mandatory. No production environment variables or data are changed.

## Integration contract

`createOwnerSessionAdapter` is disabled unless explicitly constructed with
`enabled:true`. There is no environment fallback. Supply an exact HTTPS origin,
a verified owner subject, an atomic durable session store and shared rate store.
Missing dependencies deny access. Connect `adapter.resolveSession` to the refresh
boundary only after separate security review. Do not accept owner identity from
request bodies, bearer headers, display names, or forwarded IP headers.

`establishSession` is an unwired server function. It additionally requires an
injected `verifyLogin(req)` that actually validates and **consumes** a one-use
server-bound WebAuthn/OIDC challenge and returns
`{verified:true,subject:<verified owner>,challengeConsumed:true}`. This callback
must validate expected relying party/issuer, audience, origin, challenge/state,
nonce, expiry, and provider-specific proof (including PKCE where applicable).
A callback returning fixed booleans is a test double, not authentication.
The HTTP integration must bound the proof request body before invoking it.
No credentials or authentication provider have been provisioned in this change.

After verified login, 32 random bytes form an opaque session cookie. Only its
SHA-256 hash reaches storage. The cookie uses `__Host-`, Path=/, Secure, HttpOnly,
SameSite=Strict, a 900-second maximum age, and no Domain attribute. The independent
session CSRF token is returned in a private, no-store response and must be kept
in memory, not a URL, logs, or localStorage. Never send an operator bearer or
provider key to the browser. A future CSRF bootstrap endpoint must itself require
the verified session and prohibit cross-origin/cached responses.

## Durable session-store requirements (not implemented here)

- `replaceOwner(record)` atomically revokes **all** previous owner sessions and
  saves the new hashed session record; return `{stored:true}` only after commit.
  The raw cookie is never passed to this method. Failed/uncertain issuance returns
  no cookie. One device login invalidates previous device sessions deliberately.
- `readAndTouch({sessionHash,now,idleMs})` must transactionally lock/read the row,
  reject revoked, absolute-expired, idle-expired, future-created, future-last-seen
  or malformed records **before any touch**, and return the **pre-touch** record.
  Only a valid row may have lastSeenAt advanced. Returning an already refreshed
  lastSeenAt is forbidden: it could hide idle expiry. The adapter independently
  checks the original timestamps again. Do not extend expiresAt on activity.
- `revoke({sessionHash,userId})` must permanently revoke the matching session and
  return `{revoked:true}` only after commit. Logout requires same-origin POST and
  the session CSRF token, then expires the cookie. An uncertain store result is
  not reported as a successful logout. It does not revoke an already in-flight
  provider request; the trial/credit ledgers bound that request independently.
- Production implementations must use verified TLS, bounded operations, fixed
  schemas, parameterized SQL, least privilege, no secret-bearing logs, and
  database-backed concurrency tests. Mock tests are not proof of these properties.

Sessions have an absolute 15-minute lifetime and five-minute idle timeout. The
adapter rejects local clock rollback; the durable store must enforce equivalent
clock safety across instances/restarts. Exact session records are server-private.

## Shared abuse controls (durable implementation still required)

`rateStore.consume({scope,key,limit,windowMs})` atomically consumes a bounded
allowance across instances and returns `{allowed:true}` only on admission. It
must expire old counters without allowing arbitrary keys to grow storage. All
keys/scopes here are fixed or derived from the configured owner, never attacker
IP headers. Store failures deny access.

Buckets: login 5/minute globally, session lookup 30/minute globally, authenticated
owner access 6/minute across tabs/devices, and logout 10/minute separately. The
separate logout bucket permits revocation after access allowance is exhausted.
These are conservative defaults, not a distributed denial-of-service guarantee.
Shared global limits can temporarily deny the owner during abuse. Production
edge/request-size protections remain necessary. No rolling-window guarantee is
claimed until the concrete rate-store implementation is reviewed.

## Activation blockers

1. Approved real owner identity and authentication/enrollment method.
2. Reviewed durable session/rate stores with atomic expiry/revocation tests.
3. Bounded same-origin HTTP login/logout/CSRF integration and browser tests for
   cookie flags, logout/replay, multiple tabs/devices, and login challenge expiry.
4. Independent security review and explicit approval of credential storage.
5. Separate approval/provisioning of the trial ledger, provider budget and caps.

The adapter is not wired into the production server or UI. Existing disabled
behavior is unchanged. This change cannot be described as completed owner login.
