import crypto from 'node:crypto';
import { AIRPORT_BY_CODE, REGION_LABELS, type Region } from './airports.js';
import { config } from './config.js';
import type { DB } from './db.js';
import { TIER_RANK, TIERS, type DealRow, type Tier } from './deals.js';
import { matchesWhen, normalizeWhen, type WhenFilter } from './when.js';

export interface AlertChannels {
  email?: boolean;
  push?: boolean;
  ntfy?: string;
  webhook?: string;
}

export interface Alert {
  id: number;
  token: string;
  name: string | null;
  email: string | null;
  origins: string[];
  regions: Region[];
  destinations: string[];
  maxPrice: number | null;
  minTier: Tier;
  months: string[];
  departFrom: string | null;
  departTo: string | null;
  minNights: number | null;
  maxNights: number | null;
  channels: AlertChannels;
  frequency: 'instant' | 'daily';
  paused: boolean;
  createdAt: number;
  lastNotifiedAt: number | null;
}

interface AlertRowDb {
  id: number;
  token: string;
  name: string | null;
  email: string | null;
  origins: string;
  regions: string;
  destinations: string;
  max_price: number | null;
  min_tier: Tier;
  months: string;
  depart_from: string | null;
  depart_to: string | null;
  min_nights: number | null;
  max_nights: number | null;
  channels: string;
  frequency: 'instant' | 'daily';
  paused: number;
  created_at: number;
  last_notified_at: number | null;
}

export function rowToAlert(r: AlertRowDb): Alert {
  return {
    id: r.id,
    token: r.token,
    name: r.name,
    email: r.email,
    origins: JSON.parse(r.origins),
    regions: JSON.parse(r.regions),
    destinations: JSON.parse(r.destinations),
    maxPrice: r.max_price,
    minTier: r.min_tier,
    months: JSON.parse(r.months),
    departFrom: r.depart_from ?? null,
    departTo: r.depart_to ?? null,
    minNights: r.min_nights ?? null,
    maxNights: r.max_nights ?? null,
    channels: JSON.parse(r.channels),
    frequency: r.frequency,
    paused: !!r.paused,
    createdAt: r.created_at,
    lastNotifiedAt: r.last_notified_at,
  };
}

export class ValidationError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NTFY_RE = /^[A-Za-z0-9_-]{6,64}$/;

export type AlertInput = Partial<Omit<Alert, 'id' | 'token' | 'createdAt' | 'lastNotifiedAt'>>;

/** Validate and normalize user input. Throws ValidationError. */
export function normalizeAlertInput(input: AlertInput): Omit<Alert, 'id' | 'token' | 'createdAt' | 'lastNotifiedAt'> {
  const codes = (xs: unknown, field: string) => {
    if (xs == null) return [];
    if (!Array.isArray(xs)) throw new ValidationError(`${field} must be a list`);
    const out = [...new Set(xs.map((x) => String(x).toUpperCase().trim()))];
    for (const c of out) if (!AIRPORT_BY_CODE.has(c)) throw new ValidationError(`Unknown airport ${c}`);
    return out;
  };
  const origins = codes(input.origins, 'origins');
  const destinations = codes(input.destinations, 'destinations');
  const regions = [...new Set((input.regions ?? []).map(String))] as Region[];
  for (const r of regions) if (!(r in REGION_LABELS)) throw new ValidationError(`Unknown region ${r}`);
  let when: WhenFilter;
  try {
    when = normalizeWhen(input);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const minTier = (input.minTier ?? 'good') as Tier;
  if (!TIERS.includes(minTier)) throw new ValidationError('Bad tier');
  const maxPrice = input.maxPrice == null || (input.maxPrice as unknown) === '' ? null : Math.round(Number(input.maxPrice));
  if (maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 20 || maxPrice > 20000))
    throw new ValidationError('Max price must be between $20 and $20,000');
  const email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) throw new ValidationError('That email looks off');

  const ch = input.channels ?? {};
  const channels: AlertChannels = {};
  if (ch.email) {
    if (!config.emailEnabled) throw new ValidationError('Email alerts aren’t available yet — use push, ntfy or a webhook');
    if (!email) throw new ValidationError('Add an email to get email alerts');
    channels.email = true;
  }
  if (ch.push) channels.push = true;
  if (ch.ntfy) {
    const topic = String(ch.ntfy).trim();
    if (!NTFY_RE.test(topic)) throw new ValidationError('ntfy topic: 6–64 letters, numbers, - or _');
    channels.ntfy = topic;
  }
  if (ch.webhook) {
    const url = String(ch.webhook).trim();
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ValidationError('Webhook must be a valid URL');
    }
    if (u.protocol !== 'https:') throw new ValidationError('Webhook must use https');
    channels.webhook = u.toString();
  }
  if (!channels.email && !channels.push && !channels.ntfy && !channels.webhook)
    throw new ValidationError('Pick at least one way to be notified');

  const frequency = input.frequency === 'daily' ? 'daily' : 'instant';
  const name = input.name ? String(input.name).slice(0, 80) : null;
  return { name, email, origins, regions, destinations, maxPrice, minTier, ...when, channels, frequency, paused: !!input.paused };
}

export async function createAlert(db: DB, input: AlertInput, now = Date.now()): Promise<Alert> {
  const a = normalizeAlertInput(input);
  const token = crypto.randomBytes(18).toString('base64url');
  const res = (await db.run(`INSERT INTO alerts (token, name, email, origins, regions, destinations, max_price, min_tier, months, depart_from, depart_to,
         min_nights, max_nights, channels, frequency, paused, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`, token, a.name, a.email, JSON.stringify(a.origins), JSON.stringify(a.regions), JSON.stringify(a.destinations), a.maxPrice, a.minTier,
      JSON.stringify(a.months), a.departFrom, a.departTo, a.minNights, a.maxNights, JSON.stringify(a.channels), a.frequency, a.paused ? 1 : 0, now));
  return rowToAlert(res.rows[0] as AlertRowDb);
}

export async function updateAlert(db: DB, token: string, input: AlertInput): Promise<Alert | null> {
  const current = await getAlertByToken(db, token);
  if (!current) return null;
  const a = normalizeAlertInput({ ...current, ...input });
  (await db.run(`UPDATE alerts SET name=?, email=?, origins=?, regions=?, destinations=?, max_price=?, min_tier=?, months=?, depart_from=?, depart_to=?,
       min_nights=?, max_nights=?, channels=?, frequency=?, paused=?
     WHERE token = ?`, a.name, a.email, JSON.stringify(a.origins), JSON.stringify(a.regions), JSON.stringify(a.destinations), a.maxPrice, a.minTier,
    JSON.stringify(a.months), a.departFrom, a.departTo, a.minNights, a.maxNights, JSON.stringify(a.channels), a.frequency, a.paused ? 1 : 0, token));
  return await getAlertByToken(db, token);
}

export async function getAlertByToken(db: DB, token: string): Promise<Alert | null> {
  const r = (await db.get('SELECT * FROM alerts WHERE token = ?', token)) as AlertRowDb | undefined;
  return r ? rowToAlert(r) : null;
}

export async function getAlertById(db: DB, id: number): Promise<Alert | null> {
  const r = (await db.get('SELECT * FROM alerts WHERE id = ?', id)) as AlertRowDb | undefined;
  return r ? rowToAlert(r) : null;
}

export async function deleteAlert(db: DB, token: string): Promise<boolean> {
  return (await db.run('DELETE FROM alerts WHERE token = ?', token)).changes > 0;
}

/** Does this deal satisfy the alert's filters? */
export function matchesAlert(
  alert: Alert,
  deal: Pick<DealRow, 'origin' | 'destination' | 'price' | 'tier' | 'depart_date'> & Partial<Pick<DealRow, 'return_date'>>,
): boolean {
  if (alert.paused) return false;
  if (alert.origins.length && !alert.origins.includes(deal.origin)) return false;
  if (alert.destinations.length || alert.regions.length) {
    const region = AIRPORT_BY_CODE.get(deal.destination)?.region;
    const destOk = alert.destinations.includes(deal.destination) || (!!region && alert.regions.includes(region));
    if (!destOk) return false;
  }
  if (alert.maxPrice != null && deal.price > alert.maxPrice) return false;
  if (TIER_RANK[deal.tier] < TIER_RANK[alert.minTier]) return false;
  if (!matchesWhen(alert, { depart_date: deal.depart_date, return_date: deal.return_date ?? null })) return false;
  return true;
}

/**
 * Queue this deal for every alert it matches. We only re-queue a deal an alert
 * already heard about if the price fell another 10%+.
 */
export async function enqueueMatches(db: DB, deal: DealRow, now = Date.now()): Promise<number> {
  const rows = (await db.all('SELECT * FROM alerts WHERE paused = 0')) as unknown as AlertRowDb[];
  let queued = 0;
  for (const r of rows) {
    const alert = rowToAlert(r);
    if (!matchesAlert(alert, deal)) continue;
    const prev = (await db.get('SELECT MIN(price) AS p FROM alert_matches WHERE alert_id = ? AND deal_id = ?', alert.id, deal.id)) as { p: number | null };
    if (prev.p != null && deal.price > prev.p * 0.9) continue;
    (await db.run('INSERT INTO alert_matches (alert_id, deal_id, price, created_at) VALUES (?, ?, ?, ?)', alert.id, deal.id, deal.price, now));
    queued++;
  }
  return queued;
}

/** Deals currently live that an alert would match — powers the "preview" in the builder. */
export async function previewMatches(db: DB, alert: Alert, limit = 12): Promise<DealRow[]> {
  const deals = (await db.all("SELECT * FROM deals WHERE status = 'active' ORDER BY score DESC")) as unknown as DealRow[];
  return deals.filter((d) => matchesAlert({ ...alert, paused: false }, d)).slice(0, limit);
}
