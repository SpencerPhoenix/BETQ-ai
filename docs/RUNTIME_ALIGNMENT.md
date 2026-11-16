# Runtime alignment (2026-11-16)

## Selected runtime: latest supported Node 26 LTS patch

Official Node release documentation identifies Node 26 as Active LTS and
26.13.1 as the latest security release checked on November 16. Node 22 remains
Maintenance LTS until April 2027, but is not the newest supported line. Node 27
is Alpha and is inappropriate for production. We are **not downgrading** the
already deployed and tested Node 26.13.1 service to Node 22 solely because older
CI jobs used 22.

Bound both package engines and root lockfile metadata to `>=26.13.1 <27`.
Every existing Node workflow now selects `26` with `check-latest: true`, including
training, evidence, audits and browser CI. This keeps current security patches
within the supported major and prevents an unreviewed jump to the next major.
Runtime workflow changes are Node selection plus patch freshness, with
reviewed byte-hash receipts updated. Four remaining legacy production probes
also now derive expected deployed/UI version from checked-out package.json
instead of obsolete hardcoded release numbers; their endpoint and safety checks
are preserved. Triggers, schedules, permission scopes,
secret access and paid-call controls are unchanged. Manual paid workflows remain
manual; publication does not authorize running them.

## Build and health settings

Blueprint build command retains syntax/tests after locked, no-lifecycle install:

`npm ci --ignore-scripts --no-audit --no-fund && npm run check && npm test`

`--ignore-scripts` suppresses dependency lifecycle execution, not the explicit
check/test commands. Dependency versions are unchanged. `/api/health` remains the
Blueprint HTTP health path and `npm start` remains the startup command.

The existing Render service had `npm install && npm run check && npm test` and
an empty health path. Editing repository YAML is not proof those service settings
have changed. Apply/review actual settings separately, without changing secrets,
plan, region, ownership, repository permissions or network access. Inspect for
`NODE_VERSION`, `.node-version` or `.nvmrc` overrides; Render precedence is
environment, .node-version, .nvmrc, engines. Verify actual deploy logs and commit.

A health 200 means the server responds, not that live odds, injury coverage or
predictive accuracy are adequate. Provider readiness remains a separate gate.

Auto-deploy integration is still unverified: on-commit is reported enabled, yet
recent deployments were API-triggered. This patch does not claim to repair a
webhook or grant GitHub App/repository privileges.

## Validation scope

The exact integrated release must pass Node 26.13.1 local tests, source syntax,
CI/browser QA and Render's production build before being called verified. The
new finality and QB-shadow modules remain opt-in/offline; installing this release
does not activate them or change model probabilities.

Sources checked November 16:
- https://nodejs.org/en/about/previous-releases
- https://nodejs.org/en/blog/release/v26.13.1
- https://github.com/nodejs/Release
- https://render.com/docs/node-version
