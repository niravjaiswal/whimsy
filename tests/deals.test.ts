import { describe, expect, it } from 'vitest';
import { recordResult, scoreFare, sweepStaleDeals, tierFor } from '../server/deals.js';
import { addRoute, fare, insight, memDb } from './helpers.js';

describe('scoreFare', () => {
  const noOwn = { median: null, count: 0 };
  it('returns null without any baseline', async () => {
    expect(scoreFare(300, null, noOwn, 1000)).toBeNull();
  });
  it('tiers by discount vs typical', async () => {
    expect(tierFor(0.1)).toBeNull();
    expect(tierFor(0.2)).toBe('good');
    expect(tierFor(0.4)).toBe('great');
    expect(tierFor(0.55)).toBe('incredible');
    expect(scoreFare(400, insight(800), noOwn, 3800)?.tier).toBe('incredible');
    expect(scoreFare(560, insight(800), noOwn, 3800)?.tier).toBe('good');
    expect(scoreFare(700, insight(800), noOwn, 3800)?.tier).toBeNull();
  });
  it('requires the fare to be at or under Google typical-low', async () => {
    // 25% below typical, but Google says typical range starts even lower.
    const s = scoreFare(600, insight(800, 550, 900), noOwn, 3800);
    expect(s?.discount).toBeCloseTo(0.25);
    expect(s?.tier).toBeNull();
  });
  it('blends our own observations once there are enough', async () => {
    const withOwn = scoreFare(500, insight(800), { median: 1000, count: 10 }, 3800)!;
    const without = scoreFare(500, insight(800), noOwn, 3800)!;
    expect(withOwn.baseline).toBeGreaterThan(without.baseline);
    const tooFew = scoreFare(500, insight(800), { median: 1000, count: 2 }, 3800)!;
    expect(tooFew.baseline).toBe(without.baseline);
  });
  it('scores long-haul higher for the same discount', async () => {
    const near = scoreFare(400, insight(800), noOwn, 500)!;
    const far = scoreFare(400, insight(800), noOwn, 7000)!;
    expect(far.score).toBeGreaterThan(near.score);
  });
});

describe('recordResult lifecycle', () => {
  it('creates, drops, refreshes and expires a deal', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    expect(await recordResult(db, route, fare({ price: 780 }))).toBeNull();

    const created = await recordResult(db, route, fare({ price: 450 }))!;
    expect(created.kind).toBe('new');
    expect(created.deal).toMatchObject({ slug: 'dtw-lis-2026-11-10-2026-11-17', price: 450, tier: 'great', status: 'active', airline: 'TAP Air Portugal', via: 'EWR' });

    expect((await recordResult(db, route, fare({ price: 440 })))!.kind).toBe('refreshed');
    const dropped = await recordResult(db, route, fare({ price: 380 }))!;
    expect(dropped.kind).toBe('dropped');
    expect(dropped.deal.first_price).toBe(450);
    expect(dropped.deal.tier).toBe('incredible');

    const expired = await recordResult(db, route, fare({ price: 790 }))!;
    expect(expired.kind).toBe('expired');
    expect(((await db.get('SELECT status FROM deals')) as { status: string }).status).toBe('expired');

    // Comes back → treated as new again.
    expect((await recordResult(db, route, fare({ price: 420 })))!.kind).toBe('new');
  });

  it('stores observations and place images', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    await recordResult(db, route, fare({ price: 780 }));
    expect(((await db.get('SELECT COUNT(*) n FROM observations')) as { n: number }).n).toBe(1);
    expect(((await db.get("SELECT image FROM places WHERE code='LIS'")) as { image: string }).image).toBe('https://img/lis');
  });

  it('expires when no flights come back', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    await recordResult(db, route, fare({ price: 400 }));
    expect((await recordResult(db, route, fare({ price: null })))!.kind).toBe('expired');
  });

  it('sweeps unverified and departed deals', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    const now = Date.parse('2026-10-01T00:00:00Z');
    await recordResult(db, route, fare({ price: 400 }), now);
    await recordResult(db, route, fare({ price: 400, departDate: '2026-10-01', returnDate: '2026-10-05' }), now);
    expect(await sweepStaleDeals(db, now + 1000)).toBe(1); // departing today
    expect(await sweepStaleDeals(db, now + 40 * 3600_000)).toBe(1); // not re-verified in 36h
  });
});
