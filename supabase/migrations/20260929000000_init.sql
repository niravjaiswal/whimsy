-- Whimsy schema (Postgres / Supabase).
-- The backend connects as the database owner, so it bypasses RLS. RLS is enabled on
-- every table with NO policies so Supabase's auto-generated Data API (anon /
-- authenticated keys) can read or write nothing: alert emails, manage tokens and
-- push endpoints stay private.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per directed route we scan.
CREATE TABLE IF NOT EXISTS routes (
  id BIGSERIAL PRIMARY KEY,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance INTEGER NOT NULL,
  priority DOUBLE PRECISION NOT NULL DEFAULT 1,
  next_scan_at BIGINT NOT NULL DEFAULT 0,
  last_scan_at BIGINT,
  scan_count INTEGER NOT NULL DEFAULT 0,
  sample_cursor INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_price INTEGER,
  last_typical INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (origin, destination)
);
CREATE INDEX IF NOT EXISTS routes_due ON routes (enabled, next_scan_at);

-- Every price we observe (one per scan).
CREATE TABLE IF NOT EXISTS observations (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  price INTEGER NOT NULL,
  typical INTEGER,
  typical_low INTEGER,
  typical_high INTEGER,
  level INTEGER,
  observed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS obs_route ON observations (route_id, observed_at);

-- Log of scanner requests, for the status page.
CREATE TABLE IF NOT EXISTS scans (
  id BIGSERIAL PRIMARY KEY,
  route_id BIGINT NOT NULL,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  ok INTEGER NOT NULL,
  price INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_time ON scans (created_at);

CREATE TABLE IF NOT EXISTS places (
  code TEXT PRIMARY KEY,
  city TEXT,
  country TEXT,
  image TEXT,
  updated_at BIGINT NOT NULL
);

-- High-res destination photos (Wikipedia lead images). url NULL = no usable photo.
CREATE TABLE IF NOT EXISTS city_images (
  code TEXT PRIMARY KEY,
  url TEXT,
  file TEXT,
  title TEXT,
  fetched_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  price INTEGER NOT NULL,
  first_price INTEGER NOT NULL,
  baseline INTEGER NOT NULL,
  typical_low INTEGER,
  typical_high INTEGER,
  discount DOUBLE PRECISION NOT NULL,
  tier TEXT NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  airline TEXT,
  airline_code TEXT,
  stops INTEGER,
  duration_minutes INTEGER,
  depart_time TEXT,
  arrive_time TEXT,
  via TEXT,
  history TEXT,
  booking_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  found_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  verified_at BIGINT NOT NULL,
  expired_at BIGINT
);
CREATE INDEX IF NOT EXISTS deals_active ON deals (status, score DESC);
CREATE INDEX IF NOT EXISTS deals_route ON deals (route_id, depart_date, return_date);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  origins TEXT NOT NULL,        -- JSON string[]; empty = anywhere
  regions TEXT NOT NULL,        -- JSON string[]; empty = anywhere
  destinations TEXT NOT NULL,   -- JSON string[]; empty = anywhere
  max_price INTEGER,
  min_tier TEXT NOT NULL DEFAULT 'good',
  months TEXT NOT NULL,         -- JSON "YYYY-MM"[]; empty = any
  channels TEXT NOT NULL,       -- JSON {email?:bool, push?:bool, ntfy?:string, webhook?:string}
  frequency TEXT NOT NULL DEFAULT 'instant', -- 'instant' | 'daily'
  paused INTEGER NOT NULL DEFAULT 0,
  depart_from TEXT,
  depart_to TEXT,
  min_nights INTEGER,
  max_nights INTEGER,
  email_verified_at BIGINT,
  email_token TEXT,
  created_at BIGINT NOT NULL,
  last_notified_at BIGINT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  subscription TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE (alert_id, endpoint)
);

-- Deals matched to an alert; the notifier flushes unsent matches in batches.
CREATE TABLE IF NOT EXISTS alert_matches (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  sent_at BIGINT
);
CREATE INDEX IF NOT EXISTS matches_pending ON alert_matches (sent_at, alert_id);
CREATE INDEX IF NOT EXISTS matches_alert_deal ON alert_matches (alert_id, deal_id);

-- One row per channel send attempt.
CREATE TABLE IF NOT EXISTS deliveries (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  deal_count INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_alert ON deliveries (alert_id, created_at);

-- Emails we would have sent when SMTP isn't configured (dev visibility).
CREATE TABLE IF NOT EXISTS outbox (
  id BIGSERIAL PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

-- Lock the Data API out entirely.
ALTER TABLE kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE city_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
