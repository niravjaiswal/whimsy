import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlert, enqueueMatches } from '../server/alerts.js';
import { config } from '../server/config.js';
import { recordResult } from '../server/deals.js';
import { agentMailIdempotencyKey, assertPublicUrl, buildMessage, renderEmail, webhookBody } from '../server/notify/channels.js';
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
  it('formats Discord and Slack webhooks natively', async () => {
    const db = await memDb();
    const deal = (await recordResult(db, await addRoute(db), fare({ price: 400 })))!.deal;
    const msg = buildMessage([deal], 'https://x/alerts/t');
    expect((webhookBody('https://discord.com/api/webhooks/1/abc', msg) as any).embeds[0].title).toContain('Detroit → Lisbon');
    expect((webhookBody('https://hooks.slack.com/services/x', msg) as any).blocks.length).toBe(2);
    expect((webhookBody('https://example.com/hook', msg) as any).deals[0]).toMatchObject({ route: 'DTW-LIS', price: 400 });
  });
  it('collapses several dates on one route into a single line', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    const a = (await recordResult(db, route, fare({ price: 400 })))!.deal;
    const b = (await recordResult(db, route, fare({ price: 350, departDate: '2026-11-13', returnDate: '2026-11-20' })))!.deal;
    const msg = buildMessage([a, b], 'https://x/alerts/t');
    expect(msg.deals.map((d) => d.price)).toEqual([350]);
    expect(msg.body).toContain('+1 more date from $400');
    expect((webhookBody('https://example.com/hook', msg) as any).deals[0].otherDates[0].price).toBe(400);
  });

  it('renders email with deal and manage link, escaping HTML', async () => {
    const db = await memDb();
    const deal = (await recordResult(db, await addRoute(db), fare({ price: 400 })))!.deal;
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
  it('keeps AgentMail idempotency keys within its allowed charset', () => {
    const valid = /^[A-Za-z0-9._~-]{1,256}$/;
    expect(agentMailIdempotencyKey('signin-abc_DEF.1~')).toBe('signin-abc_DEF.1~');
    const deals = agentMailIdempotencyKey('deals-7-12:149.5,13:220');
    expect(deals).toMatch(valid);
    expect(agentMailIdempotencyKey('deals-7-12:149.5,13:220')).toBe(deals);
    expect(agentMailIdempotencyKey('x'.repeat(300))).toMatch(valid);
  });
});

describe('flushNotifications', () => {
  it('batches pending deals into one message per alert and logs deliveries', async () => {
    config.allowPrivateWebhooks = true;
    const db = await memDb();
    const route = await addRoute(db);
    const route2 = await addRoute(db, 'DTW', 'CDG');
    // Local http test server: validation requires https, so write the URL directly.
    const a = await createAlert(db, { email: 'me@example.com', channels: { email: true, webhook: 'https://example.com/hook' } });
    await db.run('UPDATE alerts SET email_verified_at = 1 WHERE id = ?', a.id);
    (await db.run('UPDATE alerts SET channels = ? WHERE id = ?', JSON.stringify({ email: true, webhook: `http://127.0.0.1:${port}/ok` }),
      a.id,));
    const d1 = (await recordResult(db, route, fare({ price: 400 })))!.deal;
    const d2 = (await recordResult(db, route2, fare({ destination: 'CDG', price: 350 })))!.deal;
    await enqueueMatches(db, d1);
    await enqueueMatches(db, d2);

    const r = await flushNotifications(db);
    expect(r).toMatchObject({ alerts: 1, deals: 2 });
    expect(r.results.every((x) => x.ok)).toBe(true);
    expect(received.at(-1).body.deals).toHaveLength(2);
    const mail = (await db.get('SELECT * FROM outbox')) as any;
    expect(mail.recipient).toBe('me@example.com');
    expect(mail.subject).toMatch(/2 new flight deals/);

    // Nothing left to send.
    expect((await flushNotifications(db)).alerts).toBe(0);
    config.allowPrivateWebhooks = false;
  });

  it('skips deals that expired while queued and records failures', async () => {
    config.allowPrivateWebhooks = true;
    const db = await memDb();
    const route = await addRoute(db);
    const a = await createAlert(db, { channels: { webhook: 'https://example.com/hook' } });
    (await db.run('UPDATE alerts SET channels = ? WHERE id = ?', JSON.stringify({ webhook: `http://127.0.0.1:${port}/fail` }), a.id));
    const d = (await recordResult(db, route, fare({ price: 400 })))!.deal;
    await enqueueMatches(db, d);
    const r = await flushNotifications(db);
    expect(r.results[0]).toMatchObject({ channel: 'webhook', ok: false });
    expect(((await db.get('SELECT ok FROM deliveries')) as any).ok).toBe(0);

    const d2 = (await recordResult(db, route, fare({ price: 300, departDate: '2026-12-01', returnDate: '2026-12-08' })))!.deal;
    await enqueueMatches(db, d2);
    (await db.run("UPDATE deals SET status = 'expired' WHERE id = ?", d2.id));
    expect((await flushNotifications(db)).alerts).toBe(0);
    config.allowPrivateWebhooks = false;
  });

  it('never emails deals to an unconfirmed address, but other channels still go out', async () => {
    config.allowPrivateWebhooks = true;
    const db = await memDb();
    const route = await addRoute(db);
    const a = await createAlert(db, { email: 'stranger@example.com', channels: { email: true, webhook: 'https://example.com/hook' } });
    await db.run('UPDATE alerts SET channels = ? WHERE id = ?', JSON.stringify({ email: true, webhook: `http://127.0.0.1:${port}/ok` }), a.id);
    await enqueueMatches(db, (await recordResult(db, route, fare({ price: 400 })))!.deal);
    const r = await flushNotifications(db);
    expect(r.results.map((x) => x.channel)).toEqual(['webhook']);
    expect(((await db.get('SELECT COUNT(*) n FROM outbox')) as any).n).toBe(0);
    config.allowPrivateWebhooks = false;
  });

  it('holds daily digests until 24h after the last send', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    const a = await createAlert(db, { email: 'd@example.com', frequency: 'daily', channels: { email: true } });
    await db.run('UPDATE alerts SET email_verified_at = 1 WHERE id = ?', a.id);
    (await db.run('UPDATE alerts SET last_notified_at = ? WHERE id = ?', Date.now() - 3600_000, a.id));
    await enqueueMatches(db, (await recordResult(db, route, fare({ price: 400 })))!.deal);
    expect((await flushNotifications(db)).alerts).toBe(0);
    expect((await flushNotifications(db, Date.now() + 24 * 3600_000)).alerts).toBe(1);
  });
});
