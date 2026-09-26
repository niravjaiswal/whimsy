/**
 * Handy one-offs:
 *   npm run scan:once -- 20        scan the 20 most overdue routes and exit
 *   tsx server/cli.ts quote JFK LIS 2026-11-10 2026-11-17
 */
import { openDb } from './db.js';
import { GoogleFlightsProvider } from './providers/google.js';
import { seedRoutes } from './routes.js';
import { Scanner } from './scanner.js';
import { config } from './config.js';

const [cmd, ...args] = process.argv.slice(2);
const provider = new GoogleFlightsProvider();

if (cmd === 'quote') {
  const [origin, destination, departDate, returnDate] = args;
  const r = await provider.search({ origin, destination, departDate, returnDate });
  console.log(JSON.stringify({ cheapest: r.cheapest, insight: { ...r.insight, history: r.insight?.history.length }, url: r.bookingUrl }, null, 2));
} else if (cmd === 'scan') {
  const n = Number(args[0] ?? 10);
  const db = openDb();
  seedRoutes(db, config.origins);
  const scanner = new Scanner(db, provider);
  scanner.on('deal', (e) => console.log(`  ★ ${e.kind} deal ${e.deal.slug} $${e.deal.price} (−${Math.round(e.deal.discount * 100)}%)`));
  for (let i = 0; i < n; i++) {
    const job = scanner.nextJob();
    if (!job) break;
    const ev = await scanner.run(job);
    console.log(`${ev.origin}→${ev.destination} ${ev.departDate}/${ev.returnDate} ${ev.ok ? `$${ev.price} typ $${ev.typical}` : ev.error}`);
  }
  db.close();
} else {
  console.log('usage: cli.ts scan [n] | quote ORIG DEST YYYY-MM-DD [YYYY-MM-DD]');
}
