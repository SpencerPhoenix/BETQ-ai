-- OFFLINE OPERATOR MIGRATION ONLY. Never execute at application startup.
-- No automatic seed, extension, policy replacement or quota-baseline change.
-- This ledger is ADDITIONAL to provider-budget.sql, never a substitute.
BEGIN;
CREATE TABLE owner_refresh_trial_policies (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
  trial_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  lifetime_credit_limit integer NOT NULL CHECK (lifetime_credit_limit BETWEEN 1 AND 36),
  daily_credit_limit integer NOT NULL CHECK (daily_credit_limit BETWEEN 1 AND 12),
  CHECK (daily_credit_limit <= lifetime_credit_limit),
  CHECK (isfinite(starts_at) AND isfinite(expires_at) AND expires_at > starts_at
    AND expires_at <= starts_at + interval '168 hours'),
  UNIQUE (account_id, trial_id)
);
CREATE TABLE owner_refresh_trial_operations (
  account_id text NOT NULL,
  trial_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  market text NOT NULL CHECK (market IN ('h2h','spreads','totals')),
  utc_day date NOT NULL,
  charged_credits bigint NOT NULL DEFAULT 1 CHECK (charged_credits BETWEEN 1 AND 9007199254740991),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','completed','unknown')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (account_id,operation_id),
  FOREIGN KEY (account_id,trial_id) REFERENCES owner_refresh_trial_policies(account_id,trial_id),
  CHECK ((state='pending' AND completed_at IS NULL) OR (state IN ('completed','unknown') AND completed_at IS NOT NULL))
);
CREATE INDEX owner_refresh_trial_account_day ON owner_refresh_trial_operations(account_id,utc_day);
COMMIT;
-- Manual policy values are an explicit separate approval, not defaults to enable.
-- Runtime: CONNECT database, USAGE schema, SELECT policies, SELECT+INSERT operations,
-- UPDATE ONLY (charged_credits,state,completed_at) operations. SELECT FOR UPDATE on
-- policy rows needs UPDATE privilege on at least one policy column. This module instead uses
-- transaction-level advisory locks; runtime receives NO policy UPDATE permission.
-- No DELETE/TRUNCATE/DDL/ownership/admin memberships, no policy INSERT/UPDATE.
-- No blanket default privileges. Migration owner differs from runtime role.
-- Application enforces monotonic charges/state. Grants alone do not prevent arbitrary
-- SQL by a compromised runtime from rewriting allowed operation columns.
-- Preserve all policy/operation rows. No UPSERT/reset/new-account workaround may
-- renew an exhausted trial. Any later trial needs separate reviewed admin migration.
