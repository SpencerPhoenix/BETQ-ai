-- BETQ.ai private shadow research archive. Run ONLY on a dedicated, private
-- durable Postgres database, never in the publicly visible GitHub repo or in
-- the existing unrelated Trading Agent Postgres database.
-- Initializer must run through an authorized private CLI, never web traffic.
-- Raw bookmaker prices and publisher URLs stay in this private database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS betq_shadow;

CREATE TABLE IF NOT EXISTS betq_shadow.quote_observations (
  record_id char(64) PRIMARY KEY CHECK (record_id ~ '^[a-f0-9]{64}$'),
  sport varchar(36) NOT NULL CHECK (sport='americanfootball_nfl'),
  event_id varchar(160) NOT NULL,
  home_team varchar(120) NOT NULL,
  away_team varchar(120) NOT NULL,
  kickoff_at timestamptz NOT NULL,
  market varchar(20) NOT NULL CHECK (market='h2h'),
  period varchar(30) NOT NULL CHECK (period='FULL_GAME'),
  bookmaker_key varchar(80) NOT NULL,
  home_american integer NOT NULL,
  away_american integer NOT NULL,
  source_market_updated_at timestamptz NOT NULL,
  first_observed_at timestamptz NOT NULL,
  fair_home_probability double precision NOT NULL
    CHECK (fair_home_probability>0 AND fair_home_probability<1),
  payload_digest char(64) NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  inserted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (home_american<=-100 OR home_american>=100),
  CHECK (away_american<=-100 OR away_american>=100),
  CHECK (source_market_updated_at<=first_observed_at+interval '60 seconds'),
  CHECK (first_observed_at<kickoff_at)
);
CREATE INDEX IF NOT EXISTS idx_betq_shadow_quote_event_time
  ON betq_shadow.quote_observations(event_id,bookmaker_key,first_observed_at);
CREATE INDEX IF NOT EXISTS idx_betq_shadow_quote_seen
  ON betq_shadow.quote_observations(first_observed_at);

CREATE TABLE IF NOT EXISTS betq_shadow.qb_news_candidates (
  record_id char(64) PRIMARY KEY CHECK(record_id ~ '^[a-f0-9]{64}$'),
  event_id varchar(160) NOT NULL,
  team varchar(100) NOT NULL,
  qb_name varchar(120) NOT NULL,
  report_status varchar(30) NOT NULL CHECK (report_status IN
    ('OUT','INACTIVE','STARTER_CHANGE','STARTER_CONFIRMED','QUESTIONABLE')),
  source_url text NOT NULL,
  source_kind varchar(32) NOT NULL CHECK(source_kind IN
    ('NFL_OFFICIAL','TEAM_OFFICIAL')),
  kickoff_at timestamptz NOT NULL,
  first_observed_at timestamptz NOT NULL,
  publisher_claimed_at timestamptz,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  CHECK(first_observed_at<kickoff_at)
);
CREATE INDEX IF NOT EXISTS idx_betq_shadow_news_event
  ON betq_shadow.qb_news_candidates(event_id,first_observed_at);

CREATE TABLE IF NOT EXISTS betq_shadow.qb_source_reviews (
  candidate_record_id char(64) PRIMARY KEY
    REFERENCES betq_shadow.qb_news_candidates(record_id),
  reviewer_id varchar(100) NOT NULL,
  reviewed_at timestamptz NOT NULL,
  source_evidence_digest char(64) NOT NULL
    CHECK (source_evidence_digest ~ '^[a-f0-9]{64}$'),
  inserted_at timestamptz NOT NULL DEFAULT now()
);
-- No app methods modify or delete observations or reviews. A higher-privilege
-- database owner should separately enforce retention and backups.
COMMIT;
