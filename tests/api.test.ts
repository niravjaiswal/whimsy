import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createApi } from '../server/api.js';
import { recordResult } from '../server/deals.js';
import { addRoute, fare, memDb } from './helpers.js';

async function setup() {
  const db = await memDb();
  const api = createApi({ db, bus: new EventEmitter() });
  const json = (path: string, init?: RequestInit) =>
    api.request(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  return { db, api, json };
}

describe('api', () => {
  it('serves meta with airports, regions and a VAPID key', async () => {
    const { json } = await setup();
    const m = await (await json('/meta')).json();
    expect(m.airports.length).toBeGreaterThan(100);
    expect(m.regions.find((r: any) => r.id === 'europe')).toBeTruthy();
    expect(m.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });

  it('serves the feed from a snapshot that deal events invalidate, without chart history', async () => {
    const db = await memDb();
    const bus = new EventEmitter();
    const api = createApi({ db, bus, feedCacheMs: 60_000 });
    const total = async () => (await (await api.request('/deals')).json()).total;
    const first = await recordResult(db, await addRoute(db), fare({ price: 400 }));
    const feed = await (await api.request('/deals')).json();
    expect(feed.total).toBe(1);
    expect(feed.deals[0].history).toEqual([]); // the deal page has it; cards don't need it
    await recordResult(db, await addRoute(db, 'ORD', 'NRT', 6300), fare({ origin: 'ORD', destination: 'NRT', price: 460, typical: 800 }));
    expect(await total()).toBe(1); // still the snapshot
    bus.emit('deal', { kind: 'new', deal: first!.deal });
    expect(await total()).toBe(2);
  });

  it('lists and filters deals', async () => {
    const { db, json } = await setup();
    await recordResult(db, await addRoute(db), fare({ price: 400 }));
    await recordResult(db, await addRoute(db, 'ORD', 'NRT', 6300), fare({ origin: 'ORD', destination: 'NRT', price: 460, typical: 800 }));
    const all = await (await json('/deals')).json();
    expect(all.total).toBe(2);
    expect(all.deals[0].destination).toMatchObject({ code: expect.any(String), city: expect.any(String) });
    expect((await (await json('/deals?region=asia')).json()).total).toBe(1);
    expect((await (await json('/deals?origin=DTW')).json()).deals[0].destination.city).toBe('Lisbon');
    expect((await (await json('/deals?maxPrice=450')).json()).total).toBe(1);
    expect((await (await json('/deals?tier=great')).json()).total).toBe(1);
    expect((await (await json('/deals?departFrom=2026-11-10&departTo=2026-11-10')).json()).total).toBe(2);
    expect((await (await json('/deals?departFrom=2026-11-11&departTo=2026-11-20')).json()).total).toBe(0);
    expect((await (await json('/deals?minNights=2&maxNights=4')).json()).total).toBe(0);
    expect((await (await json('/deals?minNights=5&maxNights=9')).json()).total).toBe(2);
    expect((await json('/deals?departFrom=bogus')).status).toBe(400);
    const cheapFirst = await (await json('/deals?sort=price')).json();
    expect(cheapFirst.deals[0].price).toBe(400);
  });

  it('groups a route\'s dates into one card and lists them on the deal page', async () => {
    const { db, json } = await setup();
    const route = await addRoute(db);
    await recordResult(db, route, fare({ price: 400 }));
    await recordResult(db, route, fare({ price: 380, departDate: '2026-11-13', returnDate: '2026-11-20' }));
    await recordResult(db, route, fare({ price: 420, departDate: '2026-11-17', returnDate: '2026-11-24' }));
    const feed = await (await json('/deals?sort=price')).json();
    expect(feed).toMatchObject({ total: 1, dealCount: 3 });
    expect(feed.deals[0]).toMatchObject({ price: 380, otherCount: 2 });
    expect(feed.deals[0].otherDates.map((o: any) => o.price)).toEqual([400, 420]);
    const detail = await (await json('/deals/dtw-lis-2026-11-13-2026-11-20')).json();
    expect(detail.sameRoute.map((o: any) => o.price)).toEqual([400, 420]);
    expect(detail.related).toHaveLength(0);
  });

  it('returns deal detail with related deals', async () => {
    const { db, json } = await setup();
    await recordResult(db, await addRoute(db), fare({ price: 400 }));
    await recordResult(db, await addRoute(db, 'ORD', 'LIS'), fare({ origin: 'ORD', price: 420 }));
    const r = await (await json('/deals/dtw-lis-2026-11-10-2026-11-17')).json();
    expect(r.deal).toMatchObject({ price: 400, nights: 7, tier: 'great', via: ['EWR'] });
    expect(r.deal.history.length).toBe(30);
    expect(r.related[0].origin.code).toBe('ORD');
    expect((await json('/deals/nope')).status).toBe(404);
  });

  it('creates, reads, updates, previews and deletes an alert', async () => {
    const { db, json } = await setup();
    await recordResult(db, await addRoute(db), fare({ price: 400 }));
    const bad = await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: {} }) });
    expect(bad.status).toBe(400);
    const res = await json('/alerts', {
      method: 'POST',
      body: JSON.stringify({ email: 'me@example.com', origins: ['DTW'], regions: ['europe'], channels: { email: true } }),
    });
    expect(res.status).toBe(201);
    const { alert } = await res.json();
    expect(alert.token).toBeTruthy();
    expect(alert.id).toBeUndefined();
    expect(alert.manageUrl).toContain(`/alerts/${alert.token}`);
    // A confirmation email (not deals) lands in the dev outbox.
    const mail = (await db.get('SELECT subject, text FROM outbox')) as any;
    expect(mail.subject).toMatch(/Confirm your email/);
    const confirmToken = mail.text.match(/\/confirm\/([A-Za-z0-9_-]+)/)[1];
    expect(alert.emailVerified).toBe(false);

    const got = await (await json(`/alerts/${alert.token}`)).json();
    expect(got.matches).toHaveLength(1);
    const upd = await (await json(`/alerts/${alert.token}`, { method: 'PATCH', body: JSON.stringify({ regions: ['asia'] }) })).json();
    expect(upd.alert.regions).toEqual(['asia']);
    expect((await (await json(`/alerts/${alert.token}`)).json()).matches).toHaveLength(0);

    const prev = await (await json('/alerts/preview', { method: 'POST', body: JSON.stringify({ regions: ['europe'] }) })).json();
    expect(prev.count).toBe(1);

    // Unconfirmed: no deal emails, not even tests.
    const before = await (await json(`/alerts/${alert.token}/test`, { method: 'POST' })).json();
    expect(before.results.email).toMatch(/not confirmed/);
    expect((await json('/alerts/confirm', { method: 'POST', body: JSON.stringify({ token: 'nope-nope-nope-nope-nope' }) })).status).toBe(404);
    const confirmed = await (await json('/alerts/confirm', { method: 'POST', body: JSON.stringify({ token: confirmToken }) })).json();
    expect(confirmed.alert.emailVerified).toBe(true);
    const test = await (await json(`/alerts/${alert.token}/test`, { method: 'POST' })).json();
    expect(test.results.email).toBe('ok');

    expect((await json(`/alerts/${alert.token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json(`/alerts/${alert.token}`)).status).toBe(404);
  });

  it('re-confirms a changed email and only recovers links for confirmed addresses', async () => {
    const { db, json } = await setup();
    const { alert } = await (await json('/alerts', { method: 'POST', body: JSON.stringify({ email: 'a@example.com', channels: { email: true } }) })).json();
    // Unconfirmed address: recovery stays silent.
    await json('/alerts/recover', { method: 'POST', body: JSON.stringify({ email: 'a@example.com' }) });
    expect(((await db.get('SELECT COUNT(*) n FROM outbox')) as any).n).toBe(1);
    const token1 = ((await db.get('SELECT email_token FROM alerts')) as any).email_token;
    await json('/alerts/confirm', { method: 'POST', body: JSON.stringify({ token: token1 }) });
    await json('/alerts/recover', { method: 'POST', body: JSON.stringify({ email: 'a@example.com' }) });
    const recovery = (await db.get("SELECT text FROM outbox WHERE subject = 'Your Whimsy alert links'")) as any;
    expect(recovery.text).toContain(`/alerts/${alert.token}`);
    // Changing the address resets confirmation and sends a fresh link.
    const upd = await (await json(`/alerts/${alert.token}`, { method: 'PATCH', body: JSON.stringify({ email: 'b@example.com' }) })).json();
    expect(upd.alert.emailVerified).toBe(false);
    const token2 = ((await db.get('SELECT email_token FROM alerts')) as any).email_token;
    expect(token2).not.toBe(token1);
    expect((await json('/alerts/confirm', { method: 'POST', body: JSON.stringify({ token: token1 }) })).status).toBe(404);
    expect(((await db.get("SELECT COUNT(*) n FROM outbox WHERE recipient = 'b@example.com'")) as any).n).toBe(1);
  });

  it('validates push subscriptions', async () => {
    const { json } = await setup();
    const { alert } = await (await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { ntfy: 'whimsy-test-123' } }) })).json();
    const bad = await json(`/alerts/${alert.token}/push`, { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'x' } }) });
    expect(bad.status).toBe(400);
    const ok = await json(`/alerts/${alert.token}/push`, {
      method: 'POST',
      body: JSON.stringify({ subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } } }),
    });
    expect(ok.status).toBe(200);
    const got = await (await json(`/alerts/${alert.token}`)).json();
    expect(got.pushDevices).toBe(1);
    expect(got.alert.channels.push).toBe(true);
  });

  it('does not create an alert when its push subscription is invalid', async () => {
    const { db, json } = await setup();
    const res = await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true }, pushSubscription: { endpoint: 'nope' } }) });
    expect(res.status).toBe(400);
    expect(((await db.get('SELECT COUNT(*) n FROM alerts')) as any).n).toBe(0);
  });

  it('reports stats', async () => {
    const { db, json } = await setup();
    await addRoute(db);
    const s = await (await json('/stats')).json();
    expect(s).toMatchObject({ routes: 1, activeDeals: 0, alerts: 0 });
  });
});
