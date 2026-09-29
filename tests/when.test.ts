import { describe, expect, it } from 'vitest';
import { WhenError, matchesWhen, normalizeWhen } from '../server/when.js';

const today = new Date('2026-09-26T12:00:00Z');
const deal = (d: string, r: string | null) => ({ depart_date: d, return_date: r });

describe('normalizeWhen', () => {
  it('defaults to anything', async () => {
    expect(normalizeWhen({}, today)).toEqual({ months: [], departFrom: null, departTo: null, minNights: null, maxNights: null });
  });
  it('validates and orders dates', async () => {
    expect(normalizeWhen({ departFrom: '2026-11-30', departTo: '2026-11-20' }, today)).toMatchObject({ departFrom: '2026-11-20', departTo: '2026-11-30' });
    expect(normalizeWhen({ departFrom: '2026-11-20' }, today)).toMatchObject({ departFrom: '2026-11-20', departTo: '2026-11-20' });
    expect(() => normalizeWhen({ departFrom: '2026-02-30' }, today)).toThrow(WhenError);
    expect(() => normalizeWhen({ departFrom: 'soon' }, today)).toThrow(WhenError);
    expect(() => normalizeWhen({ departFrom: '2026-01-01', departTo: '2026-01-05' }, today)).toThrow(/past/);
    expect(() => normalizeWhen({ departFrom: '2026-10-01', departTo: '2027-06-01' }, today)).toThrow(/120 days/);
  });
  it('validates and orders nights', async () => {
    expect(normalizeWhen({ minNights: 9, maxNights: '5' }, today)).toMatchObject({ minNights: 5, maxNights: 9 });
    expect(() => normalizeWhen({ minNights: 0 }, today)).toThrow(WhenError);
    expect(() => normalizeWhen({ maxNights: 45 }, today)).toThrow(WhenError);
  });
});

describe('matchesWhen', () => {
  const w = (x: object) => normalizeWhen(x, today);
  it('filters by departure window (inclusive)', async () => {
    const f = w({ departFrom: '2026-11-24', departTo: '2026-11-28' });
    expect(matchesWhen(f, deal('2026-11-24', '2026-11-30'))).toBe(true);
    expect(matchesWhen(f, deal('2026-11-28', '2026-12-01'))).toBe(true);
    expect(matchesWhen(f, deal('2026-11-29', '2026-12-02'))).toBe(false);
    expect(matchesWhen(f, deal('2026-11-23', '2026-11-26'))).toBe(false);
  });
  it('filters by trip length', async () => {
    const weekend = w({ minNights: 2, maxNights: 4 });
    expect(matchesWhen(weekend, deal('2026-11-06', '2026-11-09'))).toBe(true);
    expect(matchesWhen(weekend, deal('2026-11-06', '2026-11-13'))).toBe(false);
    expect(matchesWhen(weekend, deal('2026-11-06', null))).toBe(false);
    expect(matchesWhen(w({ minNights: 10 }), deal('2026-11-01', '2026-11-15'))).toBe(true);
  });
  it('combines months, window and nights', async () => {
    const f = w({ months: ['2026-12'], minNights: 5 });
    expect(matchesWhen(f, deal('2026-12-20', '2026-12-28'))).toBe(true);
    expect(matchesWhen(f, deal('2026-11-20', '2026-11-28'))).toBe(false);
    expect(matchesWhen(f, deal('2026-12-20', '2026-12-22'))).toBe(false);
  });
});
