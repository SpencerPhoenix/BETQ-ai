-- Apply explicitly through offline operator tooling, never on an HTTP request.
BEGIN;
CREATE TABLE provider_budget_accounts (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$'),
  -- NULL is unseeded and cannot authorize a request. Responses never raise this value.
  remaining_credits bigint CHECK (remaining_credits BETWEEN 0 AND 9007199254740991),
  daily_credit_limit bigint NOT NULL CHECK (daily_credit_limit BETWEEN 0 AND 9007199254740991),
  minimum_reserve bigint NOT NULL CHECK (minimum_reserve BETWEEN 0 AND 9007199254740991),
  baseline_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE provider_budget_reservations (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES provider_budget_accounts(account_id),
  utc_day date NOT NULL,
  estimated_credits bigint NOT NULL CHECK (estimated_credits BETWEEN 1 AND 9007199254740991),
  charged_credits bigint NOT NULL CHECK (charged_credits BETWEEN estimated_credits AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reconciled_at timestamptz
);
CREATE INDEX provider_budget_reservations_account_day ON provider_budget_reservations(account_id, utc_day);
COMMIT;
