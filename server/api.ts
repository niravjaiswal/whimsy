import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AIRPORTS, AIRPORT_BY_CODE, REGION_LABELS, distanceMiles, type Region } from './airports.js';
import {
  ValidationError,
  createAlert,
  deleteAlert,
  getAlertByToken,
  normalizeAlertInput,
  previewMatches,
  updateAlert,
  type Alert,
} from './alerts.js';
import { config } from './config.js';
import { resizeWikimedia } from './images.js';
import { matchesWhen, normalizeWhen, type WhenFilter } from './when.js';
import { tx, type DB } from './db.js';
import { TIER_RANK, type DealRow, type Tier } from './deals.js';
import { buildMessage, sendEmail, sendNtfy, sendPush, sendWebhook, vapidKeys } from './notify/channels.js';
import { manageUrl } from './notify/notifier.js';
import { googleFlightsUrl } from './providers/google.js';
import type { Scanner, ScanEvent } from './scanner.js';
import type { DealEvent } from './deals.js';
import { EventEmitter } from 'node:events';

export interface AppDeps {
  db: DB;
  scanner?: Scanner;
  bus: EventEmitter;
}

interface PlaceMeta {
  city: string | null;
  /** Best available photo (1280px Wikimedia, else Google's 225px thumbnail). */
  image: string | null;
  /** Card-sized photo (960px Wikimedia — a standard thumbnail width — else the Google thumbnail). */
  thumb: string | null;
  hd: boolean;
  /** Commons file name for photo attribution. */
  credit: string | null;
}
type Places = Map<string, PlaceMeta>;

function placeMap(db: DB): Places {
  const rows = db
    .prepare(
      `SELECT a.code, p.city, p.image AS g, c.url AS w, c.file
       FROM (SELECT code FROM places UNION SELECT code FROM city_images) a
       LEFT JOIN places p ON p.code = a.code LEFT JOIN city_images c ON c.code = a.code`,
    )
    .all() as { code: string; city: string | null; g: string | null; w: string | null; file: string | null }[];
  return new Map(
    rows.map((r) => [
      r.code,
      {
        city: r.city,
        image: r.w ?? r.g,
        thumb: r.w ? resizeWikimedia(r.w, 960) : r.g,
        hd: !!r.w,
        credit: r.w ? r.file : null,
      },
    ]),
  );
}

export function serializeDeal(d: DealRow, places?: Places) {
  const o = AIRPORT_BY_CODE.get(d.origin);
  const t = AIRPORT_BY_CODE.get(d.destination);
  const place = (code: string, a = AIRPORT_BY_CODE.get(code)) => ({
    code,
    city: a?.city ?? places?.get(code)?.city ?? code,
    country: a?.country ?? '',
    region: a?.region ?? null,
    lat: a?.lat ?? null,
    lon: a?.lon ?? null,
    vibe: a?.vibe ?? null,
    image: places?.get(code)?.image ?? null,
    thumb: places?.get(code)?.thumb ?? null,
    imageHd: places?.get(code)?.hd ?? false,
    imageCredit: places?.get(code)?.credit ?? null,
  });
  const nights = d.return_date
    ? Math.round((Date.parse(d.return_date) - Date.parse(d.depart_date)) / 86400_000)
    : null;
  return {
    id: d.id,
    slug: d.slug,
    origin: place(d.origin, o),
    destination: place(d.destination, t),
    distance: o && t ? Math.round(distanceMiles(o, t)) : null,
    departDate: d.depart_date,
    returnDate: d.return_date,
    nights,
    price: d.price,
    firstPrice: d.first_price,
    baseline: d.baseline,
    typicalLow: d.typical_low,
    typicalHigh: d.typical_high,
    discount: d.discount,
    tier: d.tier,
    score: d.score,
    airline: d.airline,
    airlineCode: d.airline_code,
    stops: d.stops,
    durationMinutes: d.duration_minutes,
    departTime: d.depart_time,
    arriveTime: d.arrive_time,
    via: d.via ? d.via.split(',') : [],
    history: d.history ? (JSON.parse(d.history) as [number, number][]) : [],
    bookingUrl: d.booking_url,
    status: d.status,
    foundAt: d.found_at,
    updatedAt: d.updated_at,
    verifiedAt: d.verified_at,
  };
}
export type ApiDeal = ReturnType<typeof serializeDeal>;

const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

/** Tiny fixed-window limiter for write endpoints. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    h.n++;
    return h.n <= max;
  };
}

const clientIp = (c: Context) =>
  c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local';

export function publicAlert(a: Alert) {
  const { id: _id, ...rest } = a;
  return { ...rest, manageUrl: manageUrl(a) };
}

export function createApi({ db, scanner, bus }: AppDeps) {
  const api = new Hono();
  const writeLimit = limiter(30, 3600_000);
  const testLimit = limiter(10, 3600_000);

  api.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON' }, 400);
    console.error('[api]', err);
    return c.json({ error: 'Something went wrong' }, 500);
  });

  api.get('/meta', (c) => {
    const places = placeMap(db);
    return c.json({
      airports: AIRPORTS.map((a) => ({ ...a, image: places.get(a.code)?.thumb ?? null })),
      regions: Object.entries(REGION_LABELS).map(([id, label]) => ({ id, label })),
      vapidPublicKey: vapidKeys(db).publicKey,
      tiers: ['good', 'great', 'incredible'],
    });
  });

  api.get('/deals', (c) => {
    const origins = list(c.req.query('origin')).map((s) => s.toUpperCase());
    const regions = list(c.req.query('region')) as Region[];
    const dests = list(c.req.query('destination')).map((s) => s.toUpperCase());
    let when: WhenFilter;
    try {
      when = normalizeWhen({
        months: list(c.req.query('month')),
        departFrom: c.req.query('departFrom'),
        departTo: c.req.query('departTo'),
        minNights: c.req.query('minNights'),
        maxNights: c.req.query('maxNights'),
      });
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
    const maxPrice = Number(c.req.query('maxPrice')) || null;
    const tier = (c.req.query('tier') ?? 'good') as Tier;
    const sort = c.req.query('sort') ?? 'score';
    const limit = Math.min(200, Number(c.req.query('limit')) || 60);
    const all = db.prepare("SELECT * FROM deals WHERE status = 'active'").all() as unknown as DealRow[];
    const filtered = all.filter((d) => {
      if (origins.length && !origins.includes(d.origin)) return false;
      if (dests.length && !dests.includes(d.destination)) return false;
      if (regions.length && !regions.includes(AIRPORT_BY_CODE.get(d.destination)?.region as Region)) return false;
      if (!matchesWhen(when, d)) return false;
      if (maxPrice && d.price > maxPrice) return false;
      if (TIER_RANK[d.tier] < (TIER_RANK[tier] ?? 1)) return false;
      return true;
    });
    const sorters: Record<string, (a: DealRow, b: DealRow) => number> = {
      score: (a, b) => b.score - a.score,
      price: (a, b) => a.price - b.price,
      discount: (a, b) => b.discount - a.discount,
      new: (a, b) => b.found_at - a.found_at,
      soon: (a, b) => a.depart_date.localeCompare(b.depart_date),
    };
    filtered.sort(sorters[sort] ?? sorters.score);
    const places = placeMap(db);
    return c.json({ total: filtered.length, deals: filtered.slice(0, limit).map((d) => serializeDeal(d, places)) });
  });

  api.get('/deals/:slug', (c) => {
    const d = db.prepare('SELECT * FROM deals WHERE slug = ?').get(c.req.param('slug').toLowerCase()) as DealRow | undefined;
    if (!d) return c.json({ error: 'Deal not found' }, 404);
    const places = placeMap(db);
    const related = db
      .prepare(
        `SELECT * FROM deals WHERE status = 'active' AND id != ? AND (destination = ? OR origin = ?)
         ORDER BY (destination = ?) DESC, score DESC LIMIT 8`,
      )
      .all(d.id, d.destination, d.origin, d.destination) as unknown as DealRow[];
    const observations = db
      .prepare('SELECT price, typical, depart_date, return_date, observed_at FROM observations WHERE route_id = ? ORDER BY observed_at DESC LIMIT 60')
      .all(d.route_id);
    return c.json({ deal: serializeDeal(d, places), related: related.map((r) => serializeDeal(r, places)), observations });
  });

  api.get('/stats', (c) => c.json(stats(db, scanner)));

  // Fares currently under their typical price that aren't (yet) deals — "dipping".
  api.get('/dips', (c) => {
    const rows = db
      .prepare(
        `SELECT r.origin, r.destination, o.depart_date, o.return_date, o.price, o.typical, o.observed_at
         FROM observations o JOIN routes r ON r.id = o.route_id
         WHERE o.observed_at > ? AND o.typical IS NOT NULL AND o.price < o.typical
           AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.route_id = r.id AND d.status = 'active')
         ORDER BY CAST(o.price AS REAL) / o.typical ASC LIMIT 60`,
      )
      .all(Date.now() - 48 * 3600_000) as {
      origin: string;
      destination: string;
      depart_date: string;
      return_date: string | null;
      price: number;
      typical: number;
      observed_at: number;
    }[];
    const seen = new Set<string>();
    const places = placeMap(db);
    const dips = rows
      .filter((r) => (seen.has(r.origin + r.destination) ? false : (seen.add(r.origin + r.destination), true)))
      .slice(0, Number(c.req.query('limit')) || 12)
      .map((r) => ({
        origin: { code: r.origin, city: AIRPORT_BY_CODE.get(r.origin)?.city ?? r.origin },
        destination: {
          code: r.destination,
          city: AIRPORT_BY_CODE.get(r.destination)?.city ?? r.destination,
          image: places.get(r.destination)?.thumb ?? null,
        },
        departDate: r.depart_date,
        returnDate: r.return_date,
        price: r.price,
        typical: r.typical,
        discount: 1 - r.price / r.typical,
        observedAt: r.observed_at,
        bookingUrl: googleFlightsUrl({
          origin: r.origin,
          destination: r.destination,
          departDate: r.depart_date,
          returnDate: r.return_date ?? undefined,
        }),
      }));
    return c.json({ dips });
  });

  api.get('/stream', (c) =>
    streamSSE(c, async (stream) => {
      const onScan = (e: ScanEvent) => void stream.writeSSE({ event: 'scan', data: JSON.stringify(e) });
      const onDeal = (e: DealEvent) =>
        void stream.writeSSE({ event: 'deal', data: JSON.stringify({ kind: e.kind, deal: serializeDeal(e.deal, placeMap(db)) }) });
      bus.on('scan', onScan);
      bus.on('deal', onDeal);
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify(stats(db, scanner)) });
      while (open) {
        await stream.sleep(20_000);
        if (open) await stream.writeSSE({ event: 'stats', data: JSON.stringify(stats(db, scanner)) });
      }
      bus.off('scan', onScan);
      bus.off('deal', onDeal);
    }),
  );

  // ── alerts ──────────────────────────────────────────────────────────────
  api.post('/alerts/preview', async (c) => {
    const body = await c.req.json();
    const base = { channels: { push: true }, ...body };
    const a = normalizeAlertInput(base);
    const deals = previewMatches(db, { ...a, id: 0, token: '', createdAt: 0, lastNotifiedAt: null }, 6);
    const count = previewMatches(db, { ...a, id: 0, token: '', createdAt: 0, lastNotifiedAt: null }, 10_000).length;
    const places = placeMap(db);
    return c.json({ count, deals: deals.map((d) => serializeDeal(d, places)) });
  });

  api.post('/alerts', async (c) => {
    if (!writeLimit(clientIp(c))) return c.json({ error: 'Too many requests — try again later' }, 429);
    const body = await c.req.json();
    // Alert + push subscription succeed or fail together.
    const alert = tx(db, () => {
      const a = createAlert(db, body);
      if (body.pushSubscription) savePushSubscription(db, a.id, body.pushSubscription);
      return a;
    });
    if (alert.email) {
      const welcome = { ...buildMessage(previewMatches(db, alert, 6), manageUrl(alert)), title: 'Your Whimsy alert is live' };
      await sendEmail(db, alert.email, welcome).catch((e) =>
        console.warn('[alerts] welcome email failed', e.message),
      );
    }
    return c.json({ alert: publicAlert(alert) }, 201);
  });

  api.get('/alerts/:token', (c) => {
    const alert = getAlertByToken(db, c.req.param('token'));
    if (!alert) return c.json({ error: 'Alert not found' }, 404);
    const places = placeMap(db);
    const deliveries = db
      .prepare('SELECT channel, deal_count, ok, error, created_at FROM deliveries WHERE alert_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(alert.id);
    const pushCount = (db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE alert_id = ?').get(alert.id) as { n: number }).n;
    return c.json({
      alert: publicAlert(alert),
      matches: previewMatches(db, alert, 12).map((d) => serializeDeal(d, places)),
      deliveries,
      pushDevices: pushCount,
    });
  });

  api.patch('/alerts/:token', async (c) => {
    const alert = updateAlert(db, c.req.param('token'), await c.req.json());
    if (!alert) return c.json({ error: 'Alert not found' }, 404);
    return c.json({ alert: publicAlert(alert) });
  });

  api.delete('/alerts/:token', (c) => {
    if (!deleteAlert(db, c.req.param('token'))) return c.json({ error: 'Alert not found' }, 404);
    return c.json({ ok: true });
  });

  api.post('/alerts/:token/push', async (c) => {
    const alert = getAlertByToken(db, c.req.param('token'));
    if (!alert) return c.json({ error: 'Alert not found' }, 404);
    const { subscription } = await c.req.json();
    savePushSubscription(db, alert.id, subscription);
    if (!alert.channels.push) updateAlert(db, alert.token, { channels: { ...alert.channels, push: true } });
    return c.json({ ok: true });
  });

  api.post('/alerts/:token/test', async (c) => {
    const alert = getAlertByToken(db, c.req.param('token'));
    if (!alert) return c.json({ error: 'Alert not found' }, 404);
    if (!testLimit(alert.token)) return c.json({ error: 'Slow down — too many test sends' }, 429);
    const sample =
      previewMatches(db, alert, 1)[0] ??
      (db.prepare("SELECT * FROM deals WHERE status = 'active' ORDER BY score DESC LIMIT 1").get() as DealRow | undefined);
    if (!sample) return c.json({ error: 'No live deals yet to send as a sample — give the scanner a few minutes' }, 409);
    const msg = buildMessage([sample], manageUrl(alert));
    msg.title = `[Test] ${msg.title}`;
    const results: Record<string, string> = {};
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        results[name] = 'ok';
      } catch (e) {
        results[name] = (e as Error).message;
      }
    };
    if (alert.channels.email && alert.email) await run('email', () => sendEmail(db, alert.email!, msg));
    if (alert.channels.push) await run('push', () => sendPush(db, alert.id, msg));
    if (alert.channels.ntfy) await run('ntfy', () => sendNtfy(alert.channels.ntfy!, msg));
    if (alert.channels.webhook) await run('webhook', () => sendWebhook(alert.channels.webhook!, msg));
    return c.json({ results });
  });

  api.post('/alerts/recover', async (c) => {
    if (!writeLimit(clientIp(c))) return c.json({ error: 'Too many requests — try again later' }, 429);
    const { email } = await c.req.json();
    const e = String(email ?? '').trim().toLowerCase();
    const rows = db.prepare('SELECT token, name FROM alerts WHERE email = ?').all(e) as { token: string; name: string | null }[];
    if (rows.length) {
      const links = rows.map((r) => `${r.name ?? 'Alert'}: ${manageUrl(r)}`).join('\n');
      await sendEmail(db, e, {
        title: 'Your Whimsy alerts',
        body: links,
        url: config.publicUrl,
        deals: [],
        manageUrl: manageUrl(rows[0]),
      }).catch(() => {});
    }
    // Same response either way so this can't be used to probe for emails.
    return c.json({ ok: true });
  });

  // Dev-only: view emails that would have been sent (no SMTP configured).
  if (!config.smtpUrl && process.env.NODE_ENV !== 'production') {
    api.get('/dev/outbox', (c) =>
      c.json(db.prepare('SELECT id, recipient, subject, text, created_at FROM outbox ORDER BY id DESC LIMIT 50').all()),
    );
    api.get('/dev/outbox/:id', (c) => {
      const row = db.prepare('SELECT html FROM outbox WHERE id = ?').get(Number(c.req.param('id'))) as { html: string } | undefined;
      return row ? c.html(row.html) : c.notFound();
    });
  }

  return api;
}

function savePushSubscription(db: DB, alertId: number, sub: unknown) {
  const s = sub as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth)
    throw new ValidationError('Invalid push subscription');
  db.prepare(
    `INSERT INTO push_subscriptions (alert_id, endpoint, subscription, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(alert_id, endpoint) DO UPDATE SET subscription = excluded.subscription`,
  ).run(alertId, s.endpoint, JSON.stringify({ endpoint: s.endpoint, keys: s.keys }), Date.now());
}

export function stats(db: DB, scanner?: Scanner) {
  const now = Date.now();
  const one = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) as T;
  const routes = one<{ n: number }>('SELECT COUNT(*) AS n FROM routes WHERE enabled = 1').n;
  const covered = one<{ n: number }>('SELECT COUNT(*) AS n FROM routes WHERE enabled = 1 AND last_scan_at > ?', now - 86400_000).n;
  const hour = one<{ n: number; ok: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(ok), 0) AS ok FROM scans WHERE created_at > ?',
    now - 3600_000,
  );
  const day = one<{ n: number }>('SELECT COUNT(*) AS n FROM scans WHERE created_at > ?', now - 86400_000).n;
  const totalScans = one<{ n: number }>('SELECT COALESCE(SUM(scan_count), 0) AS n FROM routes').n;
  const activeDeals = one<{ n: number }>("SELECT COUNT(*) AS n FROM deals WHERE status = 'active'").n;
  const dealsToday = one<{ n: number }>('SELECT COUNT(*) AS n FROM deals WHERE found_at > ?', now - 86400_000).n;
  const alerts = one<{ n: number }>('SELECT COUNT(*) AS n FROM alerts').n;
  const best = one<{ d: number | null }>("SELECT MAX(discount) AS d FROM deals WHERE status = 'active'").d;
  const recent = db
    .prepare(
      `SELECT s.depart_date, s.return_date, s.ok, s.price, s.error, s.duration_ms, s.created_at, r.origin, r.destination, r.last_typical
       FROM scans s JOIN routes r ON r.id = s.route_id ORDER BY s.id DESC LIMIT 25`,
    )
    .all();
  return {
    now,
    scanner: scanner?.status() ?? { running: false },
    routes,
    covered24h: covered,
    scansLastHour: hour.n,
    successRateLastHour: hour.n ? hour.ok / hour.n : null,
    scans24h: day,
    totalScans,
    activeDeals,
    dealsToday,
    alerts,
    bestDiscount: best,
    recent,
  };
}
