import { openDb, type DB } from '../server/db.js';
import type { FareQuery, FareResult, PriceInsight } from '../server/providers/types.js';
import type { RouteRow } from '../server/routes.js';

// PGlite boots in ~1s; share one per test worker and wipe it between tests.
let shared: Promise<DB> | null = null;
export async function memDb(): Promise<DB> {
  shared ??= openDb(':memory:');
  const db = await shared;
  const tables = (await db.all<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations'")).map((t) => t.tablename);
  await db.exec(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  return db;
}

export async function addRoute(db: DB, origin = 'DTW', destination = 'LIS', distance = 3800): Promise<RouteRow> {
  (await db.run('INSERT INTO routes (origin, destination, distance, next_scan_at) VALUES (?, ?, ?, 0)', origin, destination, distance));
  return (await db.get('SELECT * FROM routes WHERE origin = ? AND destination = ?', origin, destination)) as unknown as RouteRow;
}

export function insight(typical: number, low = Math.round(typical * 0.8), high = Math.round(typical * 1.2)): PriceInsight {
  return {
    level: 3,
    current: typical,
    typical,
    typicalLow: low,
    typicalHigh: high,
    history: Array.from({ length: 30 }, (_, i) => [Date.UTC(2026, 7, i + 1), typical] as [number, number]),
  };
}

export function fare(q: Partial<FareQuery> & { price: number | null; typical?: number }): FareResult {
  const query: FareQuery = {
    origin: q.origin ?? 'DTW',
    destination: q.destination ?? 'LIS',
    departDate: q.departDate ?? '2026-11-10',
    returnDate: q.returnDate ?? '2026-11-17',
  };
  const typical = q.typical ?? 800;
  return {
    query,
    currency: 'USD',
    cheapest:
      q.price == null
        ? null
        : {
            price: q.price,
            airlines: ['TAP Air Portugal'],
            airlineCode: 'TP',
            stops: 1,
            durationMinutes: 600,
            departTime: '18:30',
            arriveTime: '09:10',
            arriveDate: '2026-11-11',
            via: ['EWR'],
          },
    itineraries: [],
    insight: insight(typical),
    origin: { code: query.origin, city: 'Detroit', country: 'United States', image: null },
    destination: { code: query.destination, city: 'Lisbon', country: 'Portugal', image: 'https://img/lis' },
    bookingUrl: 'https://www.google.com/travel/flights/search?tfs=x',
    fetchedAt: Date.now(),
  };
}
