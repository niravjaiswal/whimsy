import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { enqueueMatches } from './alerts.js';
import { createApi } from './api.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { syncCityImages } from './images.js';
import { flushNotifications } from './notify/notifier.js';
import { GoogleFlightsProvider } from './providers/google.js';
import { seedRoutes } from './routes.js';
import { Scanner } from './scanner.js';

const db = openDb();
const added = seedRoutes(db, config.origins);
console.log(`[whimsy] ${added} new routes seeded`);

const bus = new EventEmitter();
bus.setMaxListeners(0);

const scanner = new Scanner(db, new GoogleFlightsProvider(), {
  rpm: config.scanRpm,
  concurrency: config.scanConcurrency,
});

scanner.on('scan', (e) => {
  bus.emit('scan', e);
  const tag = e.ok ? `$${e.price ?? '—'}${e.typical ? ` (typ $${e.typical})` : ''}` : `✗ ${e.error}`;
  console.log(`[scan] ${e.kind !== 'sample' ? `${e.kind} ` : ''}${e.origin}→${e.destination} ${e.departDate}/${e.returnDate ?? ''} ${tag} ${e.durationMs}ms`);
});
scanner.on('deal', (e) => {
  bus.emit('deal', e);
  if (e.kind === 'new' || e.kind === 'dropped') {
    const queued = enqueueMatches(db, e.deal);
    console.log(`[deal] ${e.kind} ${e.deal.slug} $${e.deal.price} −${Math.round(e.deal.discount * 100)}% (${e.deal.tier}) → ${queued} alert(s)`);
  } else if (e.kind === 'expired') {
    console.log(`[deal] expired ${e.deal.slug}`);
  }
});

let flushing = false;
setInterval(async () => {
  if (flushing) return;
  flushing = true;
  try {
    const r = await flushNotifications(db);
    if (r.alerts) console.log(`[notify] ${r.deals} deal(s) → ${r.alerts} alert(s)`, r.results.filter((x) => !x.ok));
  } catch (err) {
    console.error('[notify]', err);
  } finally {
    flushing = false;
  }
}, config.notifyFlushMs).unref();

setInterval(() => {
  const { expired } = scanner.maintain();
  if (expired) console.log(`[maintain] expired ${expired} stale deal(s)`);
}, 10 * 60_000).unref();
scanner.maintain();

if (config.scannerEnabled) scanner.start();

// Resolve high-res destination photos in the background (cached ~30 days).
void syncCityImages(db).catch((err) => console.warn('[images] sync failed', err));
setInterval(() => void syncCityImages(db).catch(() => {}), 24 * 3600_000).unref();

const app = new Hono();
app.use('*', compress());
app.route('/api', createApi({ db, scanner, bus }));
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

const dist = path.resolve('dist');
const indexHtml = path.join(dist, 'index.html');
// In dev, Vite serves the UI; only serve the built SPA when one exists.
if (fs.existsSync(indexHtml)) {
  app.use('/assets/*', async (c, next) => {
    await next();
    c.header('cache-control', 'public, max-age=31536000, immutable');
  });
  app.use('*', serveStatic({ root: path.relative(process.cwd(), dist) }));
  const index = fs.readFileSync(indexHtml, 'utf8');
  app.get('*', (c) => c.html(index));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[whimsy] listening on http://localhost:${info.port} (scanner ${config.scannerEnabled ? `on @ ${config.scanRpm} rpm` : 'off'})`);
});

process.on('unhandledRejection', (err) => console.error('[whimsy] unhandled rejection', err));

const shutdown = () => {
  scanner.stop();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
