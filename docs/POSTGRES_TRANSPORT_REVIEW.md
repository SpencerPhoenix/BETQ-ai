# PostgreSQL transport and failure-handling review

Local follow-up to retained-dossier candidate `bb4487d`, 2026-11-07. The guarded and dossier commits are preserved. No production database, account, key, trust store, environment setting, provider or deployment was changed.

## Findings and fixes

1. **Connection-string TLS override.** pg 8.23.1 merges URI query settings over explicit pool settings. Real PostgreSQL tests demonstrated that `sslmode=disable` enabled plaintext and `sslmode=no-verify` accepted an untrusted certificate despite an explicit verified-TLS pool option. The shared parser now rejects all query/fragment options and encoded socket hosts, passes explicit connection fields instead of a URI, and fixes verified TLS plus negotiation. This is used by the credit ledger, private shadow runtime and private CLI. Forced native-driver selection is rejected because this validation covers the locked JavaScript driver, not untested libpq behavior.
2. **Idle connection failure.** An idle pool error could terminate the process through an unhandled EventEmitter error. Pools now register one error handler. Failed idle clients are removed by pg; later admission still requires a fresh successful durable transaction.
3. **Active connection and uncertain COMMIT.** A local TCP proxy let PostgreSQL commit, then dropped the completion before the client received it. The reservation stayed durable, but an unhandled checked-out-client error crashed the process. Transaction-scoped guards now handle active and late client errors, discard failed clients, and reject uncertain outcomes without retries. Both ledger transactions and private capture use the guard. No reservation is refunded or released on uncertainty.

Configuration validation errors do not contain the URI or password. No certificate-verification bypass is added. Trusted test connections used a temporary test CA supplied only to the test process; no system trust configuration changed.

## Verification

- **433 offline tests passed, zero failed/skipped**, plus syntax and whitespace checks.
- Real PostgreSQL **17.11**, locked JavaScript **pg 8.23.1**: **24 integration cases passed**.
- Separate real idle-disconnect/reconnect case: **1 passed**.
- Separate real private-store cases: **3 passed**, covering repeatable schema initialization, eight concurrent synthetic captures producing three unique records, and idempotent candidate/review writes with private fields excluded from aggregate output.
- Test-process/database source hashes were recorded and matched the final implementation before commit.

The 24-case suite covered schema constraints, missing/null baselines, cap/floor policy, 24 connections across four pools, 12 separate processes, application SIGKILL before and after COMMIT, actual TCP COMMIT acknowledgement loss, partial-write termination, SQL-error rollback, reconciliation monotonicity/idempotence, concurrent reserve/reconciliation, prior-day unresolved charges, real five-second lock timeout, missing schema/privilege denial, TLS trust and identity rejection, URI downgrade rejection, immediate database crash/WAL recovery with fsync and synchronous commit enabled, and offline recovery/top-up preserving charged history.

The UTC boundary test used an actual prior-day row, not a wall-clock midnight wait. All source requests and evidence in these tests were synthetic/local. No odds provider was contacted. The disposable PostgreSQL server was stopped after the checks.

## Privilege limit and remaining gates

One of the 24 cases intentionally verifies a **limit**, not successful enforcement: a runtime role that may update `remaining_credits` can raise that balance using arbitrary direct SQL. Its grants did reject DDL, account seeding, ledger deletion and account-policy changes, but column grants alone cannot enforce balance monotonicity. Normal application admission enforces the policy; this is not a tamper-resistant database interface against a compromised SQL-capable runtime. Stronger enforcement needs separately reviewed database routines/triggers and permissions.

These checks do not certify a production topology, credentials, TLS issuer, managed-database failover, backup recovery, network policy or role grants. Those remain operator release checks. Browser/mobile/assistive-technology QA also remains unverified because this environment could not launch Chromium. Local verification is not publication or deployment approval.
