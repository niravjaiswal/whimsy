import { describe, expect, it } from 'vitest';
import { recordResult } from '../server/deals.js';
import { ProviderError, type FareProvider, type FareQuery } from '../server/providers/types.js';
import { buildRouteMatrix, sampleDates, tripLengths } from '../server/routes.js';
import { Scanner } from '../server/scanner.js';
import { addRoute, fare, memDb } from './helpers.js';

class FakeProvider implements FareProvider {
  name = 'fake';
  calls: FareQuery[] = [];
  constructor(private readonly fn: (q: FareQuery) => number | Error) {}
  async search(q: FareQuery) {
    this.calls.push(q);
    const r = this.fn(q);
    if (r instanceof Error) throw r;
    return fare({ ...q, price: r });
  }
}

describe('route matrix', () => {
  it('skips tiny hops and same-metro pairs', () => {
    const m = buildRouteMatrix();
    expect(m.find((r) => r.origin === 'JFK' && r.destination === 'EWR')).toBeUndefined();
    expect(m.find((r) => r.origin === 'JFK' && r.destination === 'BOS')).toBeUndefined(); // ~190mi
    expect(m.find((r) => r.origin === 'JFK' && r.destination === 'LIS')).toBeDefined();
    expect(m.length).toBeGreaterThan(3000);
  });
  it('restricts to configured origins', () => {
    const m = buildRouteMatrix(undefined, ['DTW']);
    expect(new Set(m.map((r) => r.origin))).toEqual(new Set(['DTW']));
  });
  it('sampleDates walks the calendar deterministically', () => {
    const today = new Date('2026-09-26T12:00:00Z');
    const route = { origin: 'DTW', destination: 'LIS', distance: 3800 };
    const a = sampleDates(route, 0, today);
    const b = sampleDates(route, 1, today);
    expect(a).toEqual(sampleDates(route, 0, today));
    expect(a.departDate).not.toEqual(b.departDate);
    const nights = (Date.parse(a.returnDate!) - Date.parse(a.departDate)) / 86400_000;
    expect(tripLengths(3800)).toContain(nights);
    expect(Date.parse(a.departDate)).toBeGreaterThan(today.getTime() + 20 * 86400_000);
  });
});

describe('Scanner', () => {
  it('scans the most overdue route and reschedules it', async () => {
    const db = memDb();
    addRoute(db, 'DTW', 'LIS');
    addRoute(db, 'ORD', 'CUN', 1400);
    db.prepare("UPDATE routes SET next_scan_at = 5 WHERE origin = 'ORD'").run();
    const p = new FakeProvider(() => 780);
    const s = new Scanner(db, p, { rpm: 60 });
    const job = s.nextJob()!;
    expect(job.route.origin).toBe('DTW');
    const ev = await s.run(job);
    expect(ev.ok).toBe(true);
    const r = db.prepare("SELECT * FROM routes WHERE origin='DTW'").get() as any;
    expect(r.scan_count).toBe(1);
    expect(r.sample_cursor).toBe(1);
    expect(r.next_scan_at).toBeGreaterThan(Date.now());
    expect(s.nextJob()!.route.origin).toBe('ORD');
  });

  it('emits deal events and prioritises re-verifying stale deals', async () => {
    const db = memDb();
    const route = addRoute(db);
    const p = new FakeProvider(() => 400);
    const s = new Scanner(db, p, { reverifyMs: 1000 });
    const deals: string[] = [];
    s.on('deal', (e) => deals.push(e.kind));
    await s.run(s.nextJob()!);
    expect(deals).toEqual(['new']);
    db.prepare('UPDATE deals SET verified_at = 0').run();
    db.prepare('UPDATE routes SET next_scan_at = 0').run();
    const job = s.nextJob()!;
    expect(job.kind).toBe('verify');
    const deal = db.prepare('SELECT * FROM deals').get() as any;
    expect(job.query.departDate).toBe(deal.depart_date);
    expect(route.id).toBe(deal.route_id);
  });

  it('backs off the route and pauses globally after repeated retryable failures', async () => {
    const db = memDb();
    for (const d of ['LIS', 'CDG', 'FCO']) addRoute(db, 'DTW', d);
    const s = new Scanner(db, new FakeProvider(() => new ProviderError('HTTP 429', true, 429)));
    for (let i = 0; i < 3; i++) {
      const ev = await s.run(s.nextJob()!);
      expect(ev.ok).toBe(false);
    }
    expect(s.status().pausedUntil).toBeGreaterThan(Date.now());
    const failed = db.prepare('SELECT fail_count, next_scan_at FROM routes').all() as any[];
    for (const r of failed) {
      expect(r.fail_count).toBe(1);
      expect(r.next_scan_at).toBeGreaterThan(Date.now() + 5 * 60_000);
    }
    expect((db.prepare('SELECT COUNT(*) n FROM scans WHERE ok = 0').get() as any).n).toBe(3);
  });

  it('expires a deal when verification shows the price recovered', async () => {
    const db = memDb();
    const route = addRoute(db);
    recordResult(db, route, fare({ price: 400 }));
    db.prepare('UPDATE deals SET verified_at = 0').run();
    const s = new Scanner(db, new FakeProvider(() => 820), { reverifyMs: 1000 });
    const kinds: string[] = [];
    s.on('deal', (e) => kinds.push(e.kind));
    await s.run(s.nextJob()!);
    expect(kinds).toEqual(['expired']);
  });
});

describe('Scanner probes', () => {
  it('probes neighbouring dates after finding a new deal, without consuming the sample slot', async () => {
    const db = memDb();
    addRoute(db);
    const p = new FakeProvider(() => 400);
    const s = new Scanner(db, p);
    const first = s.nextJob()!;
    await s.run(first);
    expect(s.pendingProbes()).toBe(3);
    db.prepare('UPDATE routes SET next_scan_at = 0').run();
    const probe = s.nextJob()!;
    expect(probe.kind).toBe('probe');
    const shift = (Date.parse(probe.query.departDate) - Date.parse(first.query.departDate)) / 86400_000;
    expect(shift).toBe(-3);
    const nights = (q: typeof probe.query) => (Date.parse(q.returnDate!) - Date.parse(q.departDate)) / 86400_000;
    expect(nights(probe.query)).toBe(nights(first.query));
    const cursorBefore = (db.prepare('SELECT sample_cursor c FROM routes').get() as any).c;
    await s.run(probe);
    expect((db.prepare('SELECT sample_cursor c FROM routes').get() as any).c).toBe(cursorBefore);
    // Probe deals don't spawn more probes.
    expect(s.pendingProbes()).toBe(2);
    expect((db.prepare('SELECT COUNT(*) n FROM deals').get() as any).n).toBe(2);
  });
});

describe('Scanner targeted jobs', () => {
  it('checks routes matching an alert inside its date window and trip length', async () => {
    const { createAlert } = await import('../server/alerts.js');
    const db = memDb();
    addRoute(db, 'DTW', 'LIS');
    addRoute(db, 'DTW', 'NRT', 6400);
    addRoute(db, 'ORD', 'CDG', 4150);
    createAlert(db, { origins: ['DTW'], regions: ['europe'], departFrom: '2026-11-24', departTo: '2026-11-28', minNights: 3, maxNights: 5, channels: { push: true } });
    const s = new Scanner(db, new FakeProvider(() => 800), { targetEvery: 1 });
    const now = Date.parse('2026-09-26T12:00:00Z');
    for (let i = 0; i < 20; i++) {
      const job = s.targetedJob(now)!;
      expect(job.kind).toBe('targeted');
      expect(job.route.origin + job.route.destination).toBe('DTWLIS');
      expect(job.query.departDate >= '2026-11-24' && job.query.departDate <= '2026-11-28').toBe(true);
      const n = (Date.parse(job.query.returnDate!) - Date.parse(job.query.departDate)) / 86400_000;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('does nothing without windowed alerts and never consumes the sample slot', async () => {
    const { createAlert } = await import('../server/alerts.js');
    const db = memDb();
    addRoute(db);
    const s = new Scanner(db, new FakeProvider(() => 800), { targetEvery: 1 });
    expect(s.targetedJob()).toBeNull();
    const far = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
    createAlert(db, { departFrom: far, departTo: far, channels: { push: true } });
    const job = s.nextJob()!;
    expect(job.kind).toBe('targeted');
    await s.run(job);
    expect((db.prepare('SELECT sample_cursor c, scan_count n FROM routes').get() as any)).toMatchObject({ n: 0 });
  });
});
