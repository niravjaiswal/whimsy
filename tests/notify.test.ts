import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlert, enqueueMatches } from '../server/alerts.js';
import { config } from '../server/config.js';
import { recordResult } from '../server/deals.js';
import { assertPublicUrl, buildMessage, renderEmail, webhookBody } from '../server/notify/channels.js';
import { flushNotifications } from '../server/notify/notifier.js';
import { addRoute, fare, memDb } from './helpers.js';

let server: http.Server;
let port = 0;
const received: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(req.url === '/fail' ? 500 : 204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as any).port;
});
afterAll(() => server.close());

describe('channels', () => {
  it('formats Discord and Slack webhooks natively', () => {
    const db = memDb();
    const deal = recordResult(db, addRoute(db), fare({ price: 400 }))!.deal;
    const msg = buildMessage([deal], 'https://x/alerts/t');
    expect((webhookBody('https://discord.com/api/webhooks/1/abc', msg) as any).embeds[0].title).toContain('Detroit → Lisbon');
    expect((webhookBody('https://hooks.slack.com/services/x', msg) as any).blocks.length).toBe(2);
    expect((webhookBody('https://example.com/hook', msg) as any).deals[0]).toMatchObject({ route: 'DTW-LIS', price: 400 });
  });
  it('renders email with deal and manage link, escaping HTML', () => {
    const db = memDb();
    const deal = recordResult(db, addRoute(db), fare({ price: 400 }))!.deal;
    const { html, text } = renderEmail(buildMessage([{ ...deal, airline: '<b>x</b>' }], 'https://x/alerts/t'));
    expect(html).toContain('Detroit → Lisbon');
    expect(html).toContain('&lt;b&gt;');
    expect(text).toContain('https://x/alerts/t');
  });
  it('blocks private webhook targets', async () => {
    await expect(assertPublicUrl('https://127.0.0.1/x')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://[::1]/x')).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://10.1.2.3/x')).rejects.toThrow(/private/);
  });
});

describe('flushNotifications', () => {
  it('batches pending deals into one message per alert and logs deliveries', async () => {
    config.allowPrivateWebhooks = true;
    const db = memDb();
    const route = addRoute(db);
    const route2 = addRoute(db, 'DTW', 'CDG');
    // Local http test server: validation requires https, so write the URL directly.
    const a = createAlert(db, { email: 'me@example.com', channels: { email: true, webhook: 'https://example.com/hook' } });
    db.prepare('UPDATE alerts SET channels = ? WHERE id = ?').run(
      JSON.stringify({ email: true, webhook: `http://127.0.0.1:${port}/ok` }),
      a.id,
    );
    const d1 = recordResult(db, route, fare({ price: 400 }))!.deal;
    const d2 = recordResult(db, route2, fare({ destination: 'CDG', price: 350 }))!.deal;
    enqueueMatches(db, d1);
    enqueueMatches(db, d2);

    const r = await flushNotifications(db);
    expect(r).toMatchObject({ alerts: 1, deals: 2 });
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(received.at(-1).body.deals).toHaveLength(2);
    const mail = db.prepare('SELECT * FROM outbox').get() as any;
    expect(mail.recipient).toBe('me@example.com');
    expect(mail.subject).toMatch(/2 new flight deals/);

    // Nothing left to send.
    expect((await flushNotifications(db)).alerts).toBe(0);
    config.allowPrivateWebhooks = false;
  });

  it('skips deals that expired while queued and records failures', async () => {
    config.allowPrivateWebhooks = true;
    const db = memDb();
    const route = addRoute(db);
    const a = createAlert(db, { channels: { webhook: 'https://example.com/hook' } });
    db.prepare('UPDATE alerts SET channels = ? WHERE id = ?').run(JSON.stringify({ webhook: `http://127.0.0.1:${port}/fail` }), a.id);
    const d = recordResult(db, route, fare({ price: 400 }))!.deal;
    enqueueMatches(db, d);
    const r = await flushNotifications(db);
    expect(r.results[0]).toMatchObject({ channel: 'webhook', ok: false });
    expect((db.prepare('SELECT ok FROM deliveries').get() as any).ok).toBe(0);

    const d2 = recordResult(db, route, fare({ price: 300, departDate: '2026-12-01', returnDate: '2026-12-08' }))!.deal;
    enqueueMatches(db, d2);
    db.prepare("UPDATE deals SET status = 'expired' WHERE id = ?").run(d2.id);
    expect((await flushNotifications(db)).alerts).toBe(0);
    config.allowPrivateWebhooks = false;
  });

  it('holds daily digests until 24h after the last send', async () => {
    const db = memDb();
    const route = addRoute(db);
    const a = createAlert(db, { email: 'd@example.com', frequency: 'daily', channels: { email: true } });
    db.prepare('UPDATE alerts SET last_notified_at = ? WHERE id = ?').run(Date.now() - 3600_000, a.id);
    enqueueMatches(db, recordResult(db, route, fare({ price: 400 }))!.deal);
    expect((await flushNotifications(db)).alerts).toBe(0);
    expect((await flushNotifications(db, Date.now() + 24 * 3600_000)).alerts).toBe(1);
  });
});
