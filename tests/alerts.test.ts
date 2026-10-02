import { describe, expect, it } from 'vitest';
import { ValidationError, createAlert, enqueueMatches, matchesAlert, normalizeAlertInput, updateAlert } from '../server/alerts.js';
import { recordResult } from '../server/deals.js';
import { addRoute, fare, memDb } from './helpers.js';

const deal = { origin: 'DTW', destination: 'LIS', price: 400, tier: 'great' as const, depart_date: '2026-11-10' };

describe('normalizeAlertInput', () => {
  it('requires a channel', async () => {
    expect(() => normalizeAlertInput({})).toThrow(ValidationError);
  });
  it('rejects unknown airports and bad regions', async () => {
    expect(() => normalizeAlertInput({ origins: ['XXX'], channels: { push: true } })).toThrow(/Unknown airport/);
    expect(() => normalizeAlertInput({ regions: ['mars' as never], channels: { push: true } })).toThrow(/Unknown region/);
  });
  it('requires email for email channel and validates ntfy/webhook', async () => {
    expect(() => normalizeAlertInput({ channels: { email: true } })).toThrow(/email/);
    expect(() => normalizeAlertInput({ channels: { ntfy: 'a b' } })).toThrow(/ntfy/);
    expect(() => normalizeAlertInput({ channels: { webhook: 'http://x.com' } })).toThrow(/https/);
  });
  it('normalizes codes', async () => {
    const a = normalizeAlertInput({ origins: ['dtw', 'DTW', 'ord'], email: ' Me@X.com ', channels: { email: true } });
    expect(a.origins).toEqual(['DTW', 'ORD']);
    expect(a.email).toBe('me@x.com');
  });
});

describe('matchesAlert', () => {
  const base = normalizeAlertInput({ channels: { push: true } });
  const alert = { ...base, id: 1, token: 't', createdAt: 0, lastNotifiedAt: null };
  it('anywhere matches everything', async () => expect(matchesAlert(alert, deal)).toBe(true));
  it('filters by origin', async () => {
    expect(matchesAlert({ ...alert, origins: ['ORD'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, origins: ['DTW', 'ORD'] }, deal)).toBe(true);
  });
  it('filters by region OR destination', async () => {
    expect(matchesAlert({ ...alert, regions: ['asia'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, regions: ['europe'] }, deal)).toBe(true);
    expect(matchesAlert({ ...alert, regions: ['asia'], destinations: ['LIS'] }, deal)).toBe(true);
  });
  it('filters by departure window and trip length', async () => {
    const d = { ...deal, return_date: '2026-11-13' };
    const win = { ...alert, departFrom: '2026-11-08', departTo: '2026-11-12' };
    expect(matchesAlert(win, d)).toBe(true);
    expect(matchesAlert({ ...win, departTo: '2026-11-09' }, d)).toBe(false);
    expect(matchesAlert({ ...alert, minNights: 2, maxNights: 4 }, d)).toBe(true);
    expect(matchesAlert({ ...alert, minNights: 5 }, d)).toBe(false);
  });
  it('persists and validates when-filters', async () => {
    const db = await memDb();
    const a = await createAlert(db, { departFrom: '2027-03-06', departTo: '2027-03-14', minNights: 3, maxNights: 6, channels: { push: true } });
    expect(a).toMatchObject({ departFrom: '2027-03-06', departTo: '2027-03-14', minNights: 3, maxNights: 6 });
    expect(await updateAlert(db, a.token, { departFrom: null, departTo: null })).toMatchObject({ departFrom: null, departTo: null, minNights: 3 });
    await expect(createAlert(db, { departFrom: 'nope', channels: { push: true } })).rejects.toThrow(ValidationError);
  });
  it('filters by price, tier, month, paused', async () => {
    expect(matchesAlert({ ...alert, maxPrice: 399 }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, minTier: 'incredible' }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, months: ['2026-12'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, months: ['2026-11'] }, deal)).toBe(true);
    expect(matchesAlert({ ...alert, paused: true }, deal)).toBe(false);
  });
});

describe('enqueueMatches', () => {
  it('queues once and re-queues only after a further 10% drop', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    await createAlert(db, { origins: ['DTW'], channels: { push: true } });
    await createAlert(db, { origins: ['ORD'], channels: { push: true } });
    const d1 = (await recordResult(db, route, fare({ price: 450 })))!.deal;
    expect(await enqueueMatches(db, d1)).toBe(1);
    expect(await enqueueMatches(db, d1)).toBe(0);
    const d2 = (await recordResult(db, route, fare({ price: 420 })))!.deal;
    expect(await enqueueMatches(db, d2)).toBe(0);
    const d3 = (await recordResult(db, route, fare({ price: 390 })))!.deal;
    expect(await enqueueMatches(db, d3)).toBe(1);
  });
  it('does not re-notify a route within 24h unless 10%+ cheaper', async () => {
    const db = await memDb();
    const route = await addRoute(db);
    await createAlert(db, { channels: { push: true } });
    const now = Date.now();
    const first = (await recordResult(db, route, fare({ price: 450 })))!.deal;
    expect(await enqueueMatches(db, first, now)).toBe(1);
    const otherDate = (await recordResult(db, route, fare({ price: 430, departDate: '2026-11-20', returnDate: '2026-11-27' })))!.deal;
    expect(await enqueueMatches(db, otherDate, now + 60_000)).toBe(0); // same route, only 4% cheaper
    const muchCheaper = (await recordResult(db, route, fare({ price: 390, departDate: '2026-12-01', returnDate: '2026-12-08' })))!.deal;
    expect(await enqueueMatches(db, muchCheaper, now + 120_000)).toBe(1);
    const nextDay = (await recordResult(db, route, fare({ price: 440, departDate: '2026-12-05', returnDate: '2026-12-12' })))!.deal;
    expect(await enqueueMatches(db, nextDay, now + 25 * 3600_000)).toBe(1); // window passed
  });

  it('update keeps token and applies changes', async () => {
    const db = await memDb();
    const a = await createAlert(db, { channels: { push: true } });
    const b = await updateAlert(db, a.token, { maxPrice: 500, paused: true })!;
    expect(b.token).toBe(a.token);
    expect(b.maxPrice).toBe(500);
    expect(b.paused).toBe(true);
  });
});
