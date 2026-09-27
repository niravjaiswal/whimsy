import { describe, expect, it } from 'vitest';
import { ValidationError, createAlert, enqueueMatches, matchesAlert, normalizeAlertInput, updateAlert } from '../server/alerts.js';
import { recordResult } from '../server/deals.js';
import { addRoute, fare, memDb } from './helpers.js';

const deal = { origin: 'DTW', destination: 'LIS', price: 400, tier: 'great' as const, depart_date: '2026-11-10' };

describe('normalizeAlertInput', () => {
  it('requires a channel', () => {
    expect(() => normalizeAlertInput({})).toThrow(ValidationError);
  });
  it('rejects unknown airports and bad regions', () => {
    expect(() => normalizeAlertInput({ origins: ['XXX'], channels: { push: true } })).toThrow(/Unknown airport/);
    expect(() => normalizeAlertInput({ regions: ['mars' as never], channels: { push: true } })).toThrow(/Unknown region/);
  });
  it('requires email for email channel and validates ntfy/webhook', () => {
    expect(() => normalizeAlertInput({ channels: { email: true } })).toThrow(/email/);
    expect(() => normalizeAlertInput({ channels: { ntfy: 'a b' } })).toThrow(/ntfy/);
    expect(() => normalizeAlertInput({ channels: { webhook: 'http://x.com' } })).toThrow(/https/);
  });
  it('normalizes codes', () => {
    const a = normalizeAlertInput({ origins: ['dtw', 'DTW', 'ord'], email: ' Me@X.com ', channels: { email: true } });
    expect(a.origins).toEqual(['DTW', 'ORD']);
    expect(a.email).toBe('me@x.com');
  });
});

describe('matchesAlert', () => {
  const base = normalizeAlertInput({ channels: { push: true } });
  const alert = { ...base, id: 1, token: 't', createdAt: 0, lastNotifiedAt: null };
  it('anywhere matches everything', () => expect(matchesAlert(alert, deal)).toBe(true));
  it('filters by origin', () => {
    expect(matchesAlert({ ...alert, origins: ['ORD'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, origins: ['DTW', 'ORD'] }, deal)).toBe(true);
  });
  it('filters by region OR destination', () => {
    expect(matchesAlert({ ...alert, regions: ['asia'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, regions: ['europe'] }, deal)).toBe(true);
    expect(matchesAlert({ ...alert, regions: ['asia'], destinations: ['LIS'] }, deal)).toBe(true);
  });
  it('filters by departure window and trip length', () => {
    const d = { ...deal, return_date: '2026-11-13' };
    const win = { ...alert, departFrom: '2026-11-08', departTo: '2026-11-12' };
    expect(matchesAlert(win, d)).toBe(true);
    expect(matchesAlert({ ...win, departTo: '2026-11-09' }, d)).toBe(false);
    expect(matchesAlert({ ...alert, minNights: 2, maxNights: 4 }, d)).toBe(true);
    expect(matchesAlert({ ...alert, minNights: 5 }, d)).toBe(false);
  });
  it('persists and validates when-filters', () => {
    const db = memDb();
    const a = createAlert(db, { departFrom: '2027-03-06', departTo: '2027-03-14', minNights: 3, maxNights: 6, channels: { push: true } });
    expect(a).toMatchObject({ departFrom: '2027-03-06', departTo: '2027-03-14', minNights: 3, maxNights: 6 });
    expect(updateAlert(db, a.token, { departFrom: null, departTo: null })).toMatchObject({ departFrom: null, departTo: null, minNights: 3 });
    expect(() => createAlert(db, { departFrom: 'nope', channels: { push: true } })).toThrow(ValidationError);
  });
  it('filters by price, tier, month, paused', () => {
    expect(matchesAlert({ ...alert, maxPrice: 399 }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, minTier: 'incredible' }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, months: ['2026-12'] }, deal)).toBe(false);
    expect(matchesAlert({ ...alert, months: ['2026-11'] }, deal)).toBe(true);
    expect(matchesAlert({ ...alert, paused: true }, deal)).toBe(false);
  });
});

describe('enqueueMatches', () => {
  it('queues once and re-queues only after a further 10% drop', () => {
    const db = memDb();
    const route = addRoute(db);
    createAlert(db, { origins: ['DTW'], channels: { push: true } });
    createAlert(db, { origins: ['ORD'], channels: { push: true } });
    const d1 = recordResult(db, route, fare({ price: 450 }))!.deal;
    expect(enqueueMatches(db, d1)).toBe(1);
    expect(enqueueMatches(db, d1)).toBe(0);
    const d2 = recordResult(db, route, fare({ price: 420 }))!.deal;
    expect(enqueueMatches(db, d2)).toBe(0);
    const d3 = recordResult(db, route, fare({ price: 390 }))!.deal;
    expect(enqueueMatches(db, d3)).toBe(1);
  });
  it('update keeps token and applies changes', () => {
    const db = memDb();
    const a = createAlert(db, { channels: { push: true } });
    const b = updateAlert(db, a.token, { maxPrice: 500, paused: true })!;
    expect(b.token).toBe(a.token);
    expect(b.maxPrice).toBe(500);
    expect(b.paused).toBe(true);
  });
});
