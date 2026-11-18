# Test isolation from deployment credentials

Run the suite with `npm test` (or `npm test -- tests/name.test.mjs`). Never run
`node --test` directly in a deployment environment. Hosted staging verification
scripts are separate, explicitly dispatched tasks, not unit-test discovery.

The npm test launcher starts a fresh Node test process **before test discovery**
with a minimal allowlisted environment: executable search, Windows runtime paths,
and temporary directory paths only. It does not inherit provider keys, database
URLs/passwords, operator tokens, BETQ feature switches, GitHub credentials, HOME,
proxy settings, or arbitrary future application settings. Locale, timezone and
NODE_ENV are explicitly fixed. Caller NODE_OPTIONS are replaced in test workers.
Tests that intentionally configure a feature must supply explicit synthetic inputs.

An owned preload propagates to test subprocesses and refuses non-loopback TCP
connections. Local HTTP/TLS fixture servers remain supported. This is defense in
depth for trusted tests, not a security sandbox against malicious code: native
modules, UDP, a changed prototype, or deliberately overriding child environment
can bypass it. It does not change production behavior or credentials.

The launcher itself starts after Node has interpreted its caller's NODE_OPTIONS.
Therefore untrusted preloads must not be configured on the outer build process.
Package installation continues to require `npm ci --ignore-scripts --no-audit
--no-fund`; the test wrapper does not sanitize package installation. Build-only
jobs should not receive production credentials where the hosting platform supports
that separation.

Regression tests start the launcher under synthetic poisoned deployment settings
and prove those values are absent before imports, the default snapshot factory is
disabled without loading its driver, remote TCP is rejected, and subprocess tests
inherit the guard. No real credentials or database endpoint are used by this test.
