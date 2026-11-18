-- Preparation only. Run solely against a dedicated approved private BETQ database.
-- No credentials, provisioning, automatic migration, or provider credit baseline.
CREATE TABLE betq_odds_snapshots (
  account_id text NOT NULL,
  cache_id text NOT NULL,
  received_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY(account_id,cache_id),
  CHECK (octet_length(snapshot::text) <= 5000000),
  CHECK (snapshot->>'accountId' = account_id),
  CHECK (snapshot->>'cacheId' = cache_id)
);
