/**
 * Handy one-offs:
 *   npm run scan:once -- 20                         scan the 20 most overdue routes and exit
 *   tsx server/cli.ts quote JFK LIS 2026-11-10 2026-11-17
 *   tsx server/cli.ts import-sqlite data/whimsy.db  copy a v1 SQLite database into DATABASE_URL
 */
import { config } from './config.js';
import { openDb, type DB } from './db.js';
import { GoogleFlightsProvider } from './providers/google.js';
import { seedRoutes } from './routes.js';
import { Scanner } from './scanner.js';

const [cmd, ...args] = process.argv.slice(2);
const provider = new GoogleFlightsProvider();

/** Tables worth carrying over (catalog + price history). Alerts/outbox are test data. */
const IMPORT_TABLES = ['routes', 'places', 'city_images', 'observations', 'deals'] as const;

async function importSqlite(file: string, target: DB) {
  const { DatabaseSync } = await import('node:sqlite');
  const src = new DatabaseSync(file, { readOnly: true });
  const existing = (await target.get<{ n: number }>('SELECT COUNT(*) AS n FROM routes'))!.n;
  if (existing > 0) throw new Error(`target already has ${existing} routes — import only into an empty database`);
  // One transaction: a failed import leaves nothing half-copied.
  await target.tx(async (db) => {
    for (const table of IMPORT_TABLES) {
      const colTypes = new Map(
        (await db.all<{ column_name: string; data_type: string }>(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
          table,
        )).map((c) => [c.column_name, c.data_type]),
      );
      const rows = src.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      const keep = Object.keys(rows[0] ?? {}).filter((c) => colTypes.has(c));
      const isInt = (c: string) => ['integer', 'bigint', 'smallint'].includes(colTypes.get(c)!);
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500).map((r) =>
          // v1 SQLite accepted floats in integer columns (jittered timestamps); Postgres won't.
          Object.fromEntries(keep.map((k) => [k, typeof r[k] === 'number' && isInt(k) ? Math.round(r[k] as number) : r[k]])),
        );
        await db.run(
          `INSERT INTO ${table} (${keep.join(', ')}) SELECT ${keep.join(', ')} FROM json_populate_recordset(NULL::${table}, (?::text)::json)`,
          JSON.stringify(batch),
        );
      }
      if (colTypes.has('id')) {
        await db.run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`);
      }
      console.log(`  ${table}: ${rows.length} rows`);
    }
  });
  src.close();
}

if (cmd === 'quote') {
  const [origin, destination, departDate, returnDate] = args;
  const r = await provider.search({ origin, destination, departDate, returnDate });
  console.log(JSON.stringify({ cheapest: r.cheapest, insight: { ...r.insight, history: r.insight?.history.length }, url: r.bookingUrl }, null, 2));
} else if (cmd === 'scan') {
  const n = Number(args[0] ?? 10);
  const db = await openDb();
  await seedRoutes(db, config.origins);
  const scanner = new Scanner(db, provider);
  scanner.on('deal', (e) => console.log(`  ★ ${e.kind} deal ${e.deal.slug} $${e.deal.price} (−${Math.round(e.deal.discount * 100)}%)`));
  for (let i = 0; i < n; i++) {
    const job = await scanner.nextJob();
    if (!job) break;
    const ev = await scanner.run(job);
    console.log(`${ev.origin}→${ev.destination} ${ev.departDate}/${ev.returnDate} ${ev.ok ? `$${ev.price} typ $${ev.typical}` : ev.error}`);
  }
  await db.close();
} else if (cmd === 'import-sqlite') {
  const db = await openDb();
  console.log(`importing ${args[0] ?? 'data/whimsy.db'} → ${db.kind}`);
  await importSqlite(args[0] ?? 'data/whimsy.db', db);
  await db.close();
} else {
  console.log('usage: cli.ts scan [n] | quote ORIG DEST YYYY-MM-DD [YYYY-MM-DD] | import-sqlite FILE');
}
