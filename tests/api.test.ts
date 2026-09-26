import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createApi } from '../server/api.js';
import { recordResult } from '../server/deals.js';
import { addRoute, fare, memDb } from './helpers.js';

function setup() {
  const db = memDb();
  const api = createApi({ db, bus: new EventEmitter() });
  const json = (path: string, init?: RequestInit) =>
    api.request(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  return { db, api, json };
}

describe('api', () => {
  it('serves meta with airports, regions and a VAPID key', async () => {
    const { json } = setup();
    const m = await (await json('/meta')).json();
    expect(m.airports.length).toBeGreaterThan(100);
    expect(m.regions.find((r: any) => r.id === 'europe')).toBeTruthy();
    expect(m.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });

  it('lists and filters deals', async () => {
    const { db, json } = setup();
    recordResult(db, addRoute(db), fare({ price: 400 }));
    recordResult(db, addRoute(db, 'ORD', 'NRT', 6300), fare({ origin: 'ORD', destination: 'NRT', price: 560, typical: 800 }));
    const all = await (await json('/deals')).json();
    expect(all.total).toBe(2);
    expect(all.deals[0].destination).toMatchObject({ code: expect.any(String), city: expect.any(String) });
    expect((await (await json('/deals?region=asia')).json()).total).toBe(1);
    expect((await (await json('/deals?origin=DTW')).json()).deals[0].destination.city).toBe('Lisbon');
    expect((await (await json('/deals?maxPrice=450')).json()).total).toBe(1);
    expect((await (await json('/deals?tier=incredible')).json()).total).toBe(1);
    const cheapFirst = await (await json('/deals?sort=price')).json();
    expect(cheapFirst.deals[0].price).toBe(400);
  });

  it('returns deal detail with related deals', async () => {
    const { db, json } = setup();
    recordResult(db, addRoute(db), fare({ price: 400 }));
    recordResult(db, addRoute(db, 'ORD', 'LIS'), fare({ origin: 'ORD', price: 420 }));
    const r = await (await json('/deals/dtw-lis-2026-11-10-2026-11-17')).json();
    expect(r.deal).toMatchObject({ price: 400, nights: 7, tier: 'incredible', via: ['EWR'] });
    expect(r.deal.history.length).toBe(30);
    expect(r.related[0].origin.code).toBe('ORD');
    expect((await json('/deals/nope')).status).toBe(404);
  });

  it('creates, reads, updates, previews and deletes an alert', async () => {
    const { db, json } = setup();
    recordResult(db, addRoute(db), fare({ price: 400 }));
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
    // Welcome email lands in the dev outbox.
    expect((db.prepare('SELECT COUNT(*) n FROM outbox').get() as any).n).toBe(1);

    const got = await (await json(`/alerts/${alert.token}`)).json();
    expect(got.matches).toHaveLength(1);
    const upd = await (await json(`/alerts/${alert.token}`, { method: 'PATCH', body: JSON.stringify({ regions: ['asia'] }) })).json();
    expect(upd.alert.regions).toEqual(['asia']);
    expect((await (await json(`/alerts/${alert.token}`)).json()).matches).toHaveLength(0);

    const prev = await (await json('/alerts/preview', { method: 'POST', body: JSON.stringify({ regions: ['europe'] }) })).json();
    expect(prev.count).toBe(1);

    const test = await (await json(`/alerts/${alert.token}/test`, { method: 'POST' })).json();
    expect(test.results.email).toBe('ok');

    expect((await json(`/alerts/${alert.token}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json(`/alerts/${alert.token}`)).status).toBe(404);
  });

  it('validates push subscriptions', async () => {
    const { json } = setup();
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
    const { db, json } = setup();
    const res = await json('/alerts', { method: 'POST', body: JSON.stringify({ channels: { push: true }, pushSubscription: { endpoint: 'nope' } }) });
    expect(res.status).toBe(400);
    expect((db.prepare('SELECT COUNT(*) n FROM alerts').get() as any).n).toBe(0);
  });

  it('reports stats', async () => {
    const { db, json } = setup();
    addRoute(db);
    const s = await (await json('/stats')).json();
    expect(s).toMatchObject({ routes: 1, activeDeals: 0, alerts: 0 });
  });
});
