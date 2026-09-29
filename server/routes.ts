import { AIRPORTS, distanceMiles, sameMetro, type Airport } from './airports.js';
import type { DB } from './db.js';
import type { FareQuery } from './providers/types.js';

export interface RouteRow {
  id: number;
  origin: string;
  destination: string;
  distance: number;
  priority: number;
  next_scan_at: number;
  last_scan_at: number | null;
  scan_count: number;
  sample_cursor: number;
  fail_count: number;
  last_price: number | null;
  last_typical: number | null;
  enabled: number;
}

/** Minimum distance worth scanning — below this people drive. */
export const MIN_ROUTE_MILES = 350;

/** Build the origin × destination matrix from the airport list. */
export function buildRouteMatrix(airports: Airport[] = AIRPORTS, originCodes?: string[]) {
  const origins = originCodes
    ? airports.filter((a) => originCodes.includes(a.code))
    : airports.filter((a) => a.hub);
  const routes: { origin: string; destination: string; distance: number }[] = [];
  for (const o of origins) {
    for (const d of airports) {
      if (o.code === d.code || sameMetro(o.code, d.code)) continue;
      const distance = Math.round(distanceMiles(o, d));
      if (distance < MIN_ROUTE_MILES) continue;
      routes.push({ origin: o.code, destination: d.code, distance });
    }
  }
  return routes;
}

/**
 * Insert any missing routes. Existing rows keep their scan state. New routes are
 * spread across the next few minutes so a fresh install fans out immediately.
 */
export async function seedRoutes(db: DB, originCodes?: string[]): Promise<number> {
  const matrix = buildRouteMatrix(AIRPORTS, originCodes);
  const now = Date.now();
  // Shuffle so the first sweep samples the whole map, not one origin at a time.
  const shuffled = [...matrix];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // One round trip per batch: matters when the database is across the network.
  let added = 0;
  for (let i = 0; i < shuffled.length; i += 1000) {
    const batch = shuffled.slice(i, i + 1000);
    const res = await db.run(
      `INSERT INTO routes (origin, destination, distance, next_scan_at)
       SELECT * FROM unnest(?::text[], ?::text[], ?::int[], ?::bigint[])
       ON CONFLICT (origin, destination) DO NOTHING`,
      batch.map((r) => r.origin),
      batch.map((r) => r.destination),
      batch.map((r) => r.distance),
      batch.map((_, k) => now + i + k),
    );
    added += res.changes;
  }
  // Stagger where each unscanned route starts in its date rotation so the first
  // sweep probes the whole 3-week → 7-month window, not just the nearest slot.
  const slots = LEAD_WEEKS.length * 3;
  await db.run(`UPDATE routes SET sample_cursor = floor(random() * ${slots})::int WHERE scan_count = 0 AND sample_cursor = 0`);
  if (originCodes) {
    // Disable routes whose origin was removed from the configured list.
    await db.run('UPDATE routes SET enabled = CASE WHEN origin = ANY(?::text[]) THEN 1 ELSE 0 END', originCodes);
  }
  return added;
}

/** Trip lengths (nights) by distance — weekenders for short hops, a week+ for long haul. */
export function tripLengths(distance: number): number[] {
  if (distance < 1200) return [2, 3, 4];
  if (distance < 3000) return [4, 5, 7];
  if (distance < 6000) return [6, 7, 9];
  return [9, 11, 14];
}

/** Weeks ahead we sample departures. Covers the classic 3 weeks – 7 months deal window. */
export const LEAD_WEEKS = [3, 5, 7, 9, 12, 15, 18, 22, 26, 30];

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Deterministic date sample for a route given its rotation cursor. Successive
 * cursors walk through lead times, trip lengths and weekdays so repeated scans
 * cover the calendar instead of hammering one date pair.
 */
export function sampleDates(route: Pick<RouteRow, 'origin' | 'destination' | 'distance'>, cursor: number, today = new Date()): FareQuery {
  const lengths = tripLengths(route.distance);
  const lead = LEAD_WEEKS[cursor % LEAD_WEEKS.length];
  const nights = lengths[Math.floor(cursor / LEAD_WEEKS.length) % lengths.length];
  // Vary the weekday using a per-route hash so different routes probe different days.
  const hash = [...(route.origin + route.destination)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const dayShift = (hash + cursor * 3) % 7;
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const depart = addDays(base, lead * 7 + dayShift);
  const ret = addDays(depart, nights);
  return { origin: route.origin, destination: route.destination, departDate: isoDate(depart), returnDate: isoDate(ret) };
}
