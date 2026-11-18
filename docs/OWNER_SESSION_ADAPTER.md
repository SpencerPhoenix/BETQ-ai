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
injected `verifyLogin(req, {proof})` that actually validates and **consumes** a one-use
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

## Durable session stores: prepared implementation

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

Prepared files are `src/owner-session-store.mjs`, `sql/owner-session.sql` and
`src/configured-owner-session.mjs`. They are not wired into normal startup.
The SQL store maintains one active session row per configured owner, uses
transaction-level advisory locking, returns the pre-touch record and permanently
revokes observed expired sessions without extending activity. Database time and
persisted high-water checks prevent a process restart from erasing clock history.
Four fixed rate-scope rows bound counter cardinality. The explicit configuration
wrapper uses verified PostgreSQL TLS and bounded pools; it reads no environment
or implicit credentials. No production migration, runtime role, provider verifier
or owner enrollment has been performed. These prepared adapters still need
approved provisioning and end-to-end production verification.

## Shared abuse controls: prepared fixed-window implementation

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
edge/request-size protections remain necessary. The prepared store uses fixed windows, not a rolling-window algorithm; bursts
across a window boundary can exceed one window allowance within a rolling minute.

## Activation blockers

1. Approved real owner identity and authentication/enrollment method.
2. Review/provision the prepared durable stores with real PostgreSQL authentication
   tests, approved migration and least-privilege role; these are not live.
3. Browser verification of the explicitly injected same-origin HTTP adapter for
   cookie flags, logout/replay, multiple tabs/devices, and login challenge expiry.
4. Independent security review and explicit approval of credential storage.
5. Separate approval/provisioning of the trial ledger, provider budget and caps.

The adapter is not wired into the production server or UI. Existing disabled
behavior is unchanged. This change cannot be described as completed owner login.

## Implemented HTTP shell (still disabled by default)

`createOwnerSessionHttpHandler({enabled:false, origin, adapter})` handles only:

- `POST /api/owner/session`, JSON `{proof}`. The opaque, bounded one-use proof is
  passed to the trusted verifier; its contents never establish identity directly.
- `POST /api/owner/session-info`, JSON `{}`. A valid cookie session is required;
  the response contains only the session-bound CSRF token, not provider tokens.
- `POST /api/owner/logout`, JSON `{csrfToken}`. Both cookie authentication and
  CSRF must pass before durable revocation and cookie deletion.

Every route requires the exact HTTPS Origin and `Sec-Fetch-Site: same-origin`.
GET, query-bearing paths, arrays, extra identity fields, compressed/non-JSON
bodies and bodies over 4096 bytes are rejected. Body reading is time-bounded.
Responses are no-store; no cross-origin allowance or redirect is generated.
Only the exact hardened session cookie is forwarded from the trusted adapter;
errors and arbitrary adapter headers are never returned. Server integration is
explicit `createHandler({ownerSessionHandler})`; normal startup supplies none.
Local HTTP composition is tested with a synthetic verifier and store, not a real
login provider. This does not establish production authentication readiness.

## Provider and owner-binding decision still required

No existing application identity provider was found. Managed Better Auth on Neon
is the recommended candidate, without changing the existing vanilla Node/Render
architecture or rewriting the app to Next.js. **Nothing is enabled by this PR.**
Keep the managed `@neon/auth` wrapper and its documented callback handling; do not
reimplement its OAuth popup, verifier-cookie, or JWT behavior. No dependency has
been installed and no provider compatibility is claimed yet.

The next decision is the approved sign-in identity/method for the sole owner
(for example, the owner's existing Google identity). Then separately approve
provider setup and any required encrypted credential storage. Enroll the exact
server-verified immutable provider subject with its issuer/tenant. Never use a
matching display name or an unverified email to grant owner status, and never
make the first public signer automatically the owner.

A concrete provider integration must validate identity server-side using the
provider's supported server SDK or a reviewed standards-based OIDC library.
Check issuer, audience, signature/allowed algorithms, expiry, nonce/state,
redirect URI and PKCE as applicable, plus transaction/browser binding. Consume
login challenges atomically and prohibit reuse. A reusable access/ID token alone
is not this adapter's one-use proof. A successful provider callback must produce
a short-lived, browser-bound, one-use application exchange proof consumed by
`verifyLogin`; that exchange store and callback integration remain unimplemented.
Do not pass provider tokens in URLs, logs, or application localStorage. Do not
claim that signing out revokes an already-issued third-party JWT.

Neon's current production checklist requires own OAuth app credentials when
using OAuth and custom email-provider setup for production email delivery.
Therefore no promise is made that production OAuth/email is already configured
or free. Review actual provider terms, available account, costs and permitted
storage before provisioning. Sources checked November 18, 2026:
[production checklist](https://neon.com/docs/auth/production-checklist),
[OAuth setup](https://neon.com/docs/auth/guides/setup-oauth).
