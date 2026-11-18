-- OFFLINE migration only, never invoked by runtime. No identities or credentials seeded.
BEGIN;
CREATE TABLE owner_auth_sessions (
  owner_id text PRIMARY KEY CHECK(length(owner_id) BETWEEN 1 AND 128),
  session_hash text NOT NULL UNIQUE CHECK(session_hash ~ '^[a-f0-9]{64}$'),
  csrf_token text NOT NULL CHECK(csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at_ms bigint NOT NULL CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
  last_seen_ms bigint NOT NULL,
  expires_at_ms bigint NOT NULL CHECK(expires_at_ms <= 9007199254740991),
  high_water_ms bigint NOT NULL CHECK(high_water_ms <= 9007199254740991),
  revoked boolean NOT NULL DEFAULT false,
  CHECK(created_at_ms <= last_seen_ms AND last_seen_ms < expires_at_ms),
  CHECK(expires_at_ms-created_at_ms BETWEEN 1 AND 900000),
  CHECK(high_water_ms >= last_seen_ms)
);
CREATE TABLE owner_auth_rate (
  owner_id text NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 128),
  scope text NOT NULL CHECK(scope IN ('owner-login','owner-auth','owner-access','owner-logout')),
  window_start_ms bigint NOT NULL CHECK(window_start_ms BETWEEN 0 AND 9007199254740991),
  high_water_ms bigint NOT NULL CHECK(high_water_ms BETWEEN window_start_ms AND 9007199254740991),
  used integer NOT NULL CHECK(used >= 0 AND used <= CASE scope WHEN 'owner-login' THEN 5 WHEN 'owner-auth' THEN 30 WHEN 'owner-access' THEN 6 ELSE 10 END),
  PRIMARY KEY(owner_id,scope)
);
COMMIT;
-- Dedicated non-owner runtime: CONNECT database, USAGE schema, SELECT/INSERT on
-- these two tables; UPDATE(session_hash,csrf_token,created_at_ms,last_seen_ms,
-- expires_at_ms,high_water_ms,revoked) sessions; UPDATE(window_start_ms,high_water_ms,used) rate.
-- No DELETE/TRUNCATE/DDL/role administration or blanket default privileges.
-- One session + four rate rows per configured owner, reused in place. Replacing
-- a session invalidates its previous hash atomically; no unbounded token/key history.
-- Limits are fixed-window, not sliding-window guarantees. Grants are not a sandbox
-- against a compromised runtime issuing arbitrary SQL; secrets remain server-private.
