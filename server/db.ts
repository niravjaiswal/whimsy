import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per directed route we scan.
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  distance INTEGER NOT NULL,
  priority REAL NOT NULL DEFAULT 1,
  next_scan_at INTEGER NOT NULL DEFAULT 0,
  last_scan_at INTEGER,
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
  id INTEGER PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  price INTEGER NOT NULL,
  typical INTEGER,
  typical_low INTEGER,
  typical_high INTEGER,
  level INTEGER,
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS obs_route ON observations (route_id, observed_at);

-- Log of scanner requests, for the status page.
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  route_id INTEGER NOT NULL,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  ok INTEGER NOT NULL,
  price INTEGER,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_time ON scans (created_at);

CREATE TABLE IF NOT EXISTS places (
  code TEXT PRIMARY KEY,
  city TEXT,
  country TEXT,
  image TEXT,
  updated_at INTEGER NOT NULL
);

-- High-res destination photos (Wikipedia lead images). url NULL = no usable photo.
CREATE TABLE IF NOT EXISTS city_images (
  code TEXT PRIMARY KEY,
  url TEXT,
  file TEXT,
  title TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  depart_date TEXT NOT NULL,
  return_date TEXT,
  price INTEGER NOT NULL,
  first_price INTEGER NOT NULL,
  baseline INTEGER NOT NULL,
  typical_low INTEGER,
  typical_high INTEGER,
  discount REAL NOT NULL,
  tier TEXT NOT NULL,
  score REAL NOT NULL,
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
  found_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  expired_at INTEGER
);
CREATE INDEX IF NOT EXISTS deals_active ON deals (status, score DESC);
CREATE INDEX IF NOT EXISTS deals_route ON deals (route_id, depart_date, return_date);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
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
  created_at INTEGER NOT NULL,
  last_notified_at INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  subscription TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (alert_id, endpoint)
);

-- Deals matched to an alert; the notifier flushes unsent matches in batches.
CREATE TABLE IF NOT EXISTS alert_matches (
  id INTEGER PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS matches_pending ON alert_matches (sent_at, alert_id);
CREATE INDEX IF NOT EXISTS matches_alert_deal ON alert_matches (alert_id, deal_id);

-- One row per channel send attempt.
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  deal_count INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_alert ON deliveries (alert_id, created_at);

-- Emails we would have sent when SMTP isn't configured (dev visibility).
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDb(file = process.env.DATABASE_PATH ?? path.resolve('data/whimsy.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  return db;
}

export function kvGet(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
