import { EventEmitter } from 'node:events';
import type { DB } from './db.js';
import { recordResult, sweepStaleDeals, type DealEvent, type DealRow } from './deals.js';
import { sampleDates, tripLengths, type RouteRow } from './routes.js';
import { rowToAlert } from './alerts.js';
import { AIRPORT_BY_CODE, type Region } from './airports.js';
import { ProviderError, type FareProvider, type FareQuery } from './providers/types.js';

export interface ScannerOptions {
  /** Requests per minute across all workers. Be polite. */
  rpm: number;
  concurrency: number;
  /** Re-check active deals this often so stale fares disappear quickly. */
  reverifyMs: number;
  /** Every Nth job goes to alerts with a specific date window (0 disables). */
  targetEvery: number;
}

export interface ScanEvent {
  routeId: number;
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  ok: boolean;
  price: number | null;
  typical: number | null;
  error?: string;
  durationMs: number;
  at: number;
  kind: JobKind;
}

type JobKind = 'sample' | 'verify' | 'probe' | 'targeted';
type Job = { route: RouteRow; query: FareQuery; kind: JobKind };

/** Deals cluster in date ranges: when we find one, check nearby departures too. */
export const PROBE_OFFSETS = [-3, 3, 7];
const MAX_PROBES = 60;

const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const DEFAULT_SCANNER_OPTIONS: ScannerOptions = { rpm: 24, concurrency: 2, reverifyMs: 6 * 3600_000, targetEvery: 3 };

export class Scanner extends EventEmitter<{ scan: [ScanEvent]; deal: [DealEvent] }> {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<number>();
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private lastTickAt = 0;
  private probes: Job[] = [];
  private jobCount = 0;
  running = false;
  readonly opts: ScannerOptions;

  constructor(
    private readonly db: DB,
    private readonly provider: FareProvider,
    opts: Partial<ScannerOptions> = {},
  ) {
    super();
    this.opts = { ...DEFAULT_SCANNER_OPTIONS, ...opts };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const interval = Math.max(250, Math.round(60_000 / this.opts.rpm));
    this.timer = setInterval(() => void this.tick(), interval);
    void this.tick();
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status() {
    return {
      running: this.running,
      inFlight: this.inFlight.size,
      pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : null,
      consecutiveFailures: this.consecutiveFailures,
      rpm: this.opts.rpm,
      concurrency: this.opts.concurrency,
      provider: this.provider.name,
      lastTickAt: this.lastTickAt,
    };
  }

  /** Average time for the scanner to visit every enabled route once. */
  cycleMs(): number {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM routes WHERE enabled = 1').get() as { n: number };
    return Math.max(15 * 60_000, (n / this.opts.rpm) * 60_000);
  }

  private async tick() {
    this.lastTickAt = Date.now();
    if (Date.now() < this.pausedUntil) return;
    if (this.inFlight.size >= this.opts.concurrency) return;
    const job = this.nextJob();
    if (!job) return;
    await this.run(job);
  }

  /** Verification of active deals first, then neighbour-date probes, then the most overdue route. */
  nextJob(now = Date.now()): Job | null {
    const busy = [...this.inFlight];
    const notBusy = busy.length ? `AND r.id NOT IN (${busy.join(',')})` : '';
    const stale = this.db
      .prepare(
        `SELECT d.* FROM deals d JOIN routes r ON r.id = d.route_id
         WHERE d.status = 'active' AND d.verified_at < ? ${notBusy}
         ORDER BY d.score DESC LIMIT 1`,
      )
      .get(now - this.opts.reverifyMs) as DealRow | undefined;
    if (stale) {
      const route = this.db.prepare('SELECT * FROM routes WHERE id = ?').get(stale.route_id) as unknown as RouteRow;
      return {
        route,
        kind: 'verify',
        query: {
          origin: stale.origin,
          destination: stale.destination,
          departDate: stale.depart_date,
          returnDate: stale.return_date ?? undefined,
        },
      };
    }
    const probeIdx = this.probes.findIndex((p) => !this.inFlight.has(p.route.id));
    if (probeIdx >= 0) return this.probes.splice(probeIdx, 1)[0];
    this.jobCount++;
    if (this.opts.targetEvery > 0 && this.jobCount % this.opts.targetEvery === 0) {
      const targeted = this.targetedJob(now);
      if (targeted) return targeted;
    }
    const route = this.db
      .prepare(`SELECT * FROM routes r WHERE enabled = 1 AND next_scan_at <= ? ${notBusy} ORDER BY next_scan_at LIMIT 1`)
      .get(now) as RouteRow | undefined;
    if (!route) return null;
    return { route, kind: 'sample', query: sampleDates(route, route.sample_cursor) };
  }

  async run(job: Job): Promise<ScanEvent> {
    const { route, query } = job;
    this.inFlight.add(route.id);
    // Claim the route immediately so parallel ticks don't pick it again.
    this.db.prepare('UPDATE routes SET next_scan_at = ? WHERE id = ?').run(Date.now() + 10 * 60_000, route.id);
    const started = Date.now();
    let ev: ScanEvent;
    try {
      const result = await this.provider.search(query);
      const dealEvent = recordResult(this.db, route, result);
      this.consecutiveFailures = 0;
      const hasDeal = !!this.db
        .prepare("SELECT 1 FROM deals WHERE route_id = ? AND status = 'active' LIMIT 1")
        .get(route.id);
      this.reschedule(route, job.kind, true, hasDeal);
      ev = {
        routeId: route.id,
        origin: query.origin,
        destination: query.destination,
        departDate: query.departDate,
        returnDate: query.returnDate,
        ok: true,
        price: result.cheapest?.price ?? null,
        typical: result.insight?.typical ?? null,
        durationMs: Date.now() - started,
        at: Date.now(),
        kind: job.kind,
      };
      if (dealEvent) this.emit('deal', dealEvent);
      if (dealEvent?.kind === 'new' && job.kind !== 'probe') this.enqueueProbes(route, query);
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.retryable : true;
      if (retryable) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 3) {
          const backoff = Math.min(30 * 60_000, 60_000 * 2 ** (this.consecutiveFailures - 3));
          this.pausedUntil = Date.now() + backoff;
        }
      }
      if (job.kind === 'verify') {
        // Couldn't re-verify: bump verified_at a little so we don't spin on it.
        this.db
          .prepare("UPDATE deals SET verified_at = verified_at + 1800000 WHERE route_id = ? AND status = 'active' AND depart_date = ?")
          .run(route.id, query.departDate);
      }
      this.reschedule(route, job.kind, false, false);
      ev = {
        routeId: route.id,
        origin: query.origin,
        destination: query.destination,
        departDate: query.departDate,
        returnDate: query.returnDate,
        ok: false,
        price: null,
        typical: null,
        error: (err as Error).message,
        durationMs: Date.now() - started,
        at: Date.now(),
        kind: job.kind,
      };
    } finally {
      this.inFlight.delete(route.id);
    }
    this.db
      .prepare(
        'INSERT INTO scans (route_id, depart_date, return_date, ok, price, error, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(route.id, query.departDate, query.returnDate ?? null, ev.ok ? 1 : 0, ev.price, ev.error ?? null, ev.durationMs, ev.at);
    this.emit('scan', ev);
    return ev;
  }

  private enqueueProbes(route: RouteRow, q: FareQuery) {
    const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    for (const off of PROBE_OFFSETS) {
      const departDate = shiftDate(q.departDate, off);
      if (departDate <= tomorrow || this.probes.length >= MAX_PROBES) continue;
      const exists = this.db.prepare('SELECT 1 FROM deals WHERE route_id = ? AND depart_date = ?').get(route.id, departDate);
      if (exists) continue;
      this.probes.push({
        route,
        kind: 'probe',
        query: { ...q, departDate, returnDate: q.returnDate ? shiftDate(q.returnDate, off) : undefined },
      });
    }
  }

  /**
   * The rotation only samples a few dates per route, so a narrow alert window
   * (e.g. Thanksgiving week) could go unchecked for days. Spend a slice of the
   * budget on random routes matching an alert, departing inside its window.
   */
  targetedJob(now = Date.now(), rand = Math.random): Job | null {
    const earliest = new Date(now + 2 * 86400_000).toISOString().slice(0, 10);
    const alerts = (this.db
      .prepare('SELECT * FROM alerts WHERE paused = 0 AND depart_from IS NOT NULL AND depart_to >= ?')
      .all(earliest) as any[]).map(rowToAlert);
    if (!alerts.length) return null;
    const alert = alerts[Math.floor(rand() * alerts.length)];
    const routes = (this.db.prepare('SELECT * FROM routes WHERE enabled = 1').all() as unknown as RouteRow[]).filter(
      (r) =>
        !this.inFlight.has(r.id) &&
        (!alert.origins.length || alert.origins.includes(r.origin)) &&
        (!(alert.destinations.length || alert.regions.length) ||
          alert.destinations.includes(r.destination) ||
          alert.regions.includes(AIRPORT_BY_CODE.get(r.destination)?.region as Region)),
    );
    if (!routes.length) return null;
    const route = routes[Math.floor(rand() * routes.length)];
    const from = alert.departFrom! < earliest ? earliest : alert.departFrom!;
    const span = Math.round((Date.parse(alert.departTo!) - Date.parse(from)) / 86400_000);
    const departDate = shiftDate(from, Math.floor(rand() * (span + 1)));
    const lengths = tripLengths(route.distance);
    const lo = alert.minNights ?? (alert.maxNights != null ? Math.min(lengths[0], alert.maxNights) : null);
    const hi = alert.maxNights ?? (alert.minNights != null ? Math.max(lengths[lengths.length - 1], alert.minNights) : null);
    const nights = lo != null && hi != null ? lo + Math.floor(rand() * (hi - lo + 1)) : lengths[Math.floor(rand() * lengths.length)];
    return {
      route,
      kind: 'targeted',
      query: { origin: route.origin, destination: route.destination, departDate, returnDate: shiftDate(departDate, nights) },
    };
  }

  pendingProbes() {
    return this.probes.length;
  }

  private reschedule(route: RouteRow, kind: Job['kind'], ok: boolean, hasDeal: boolean) {
    const now = Date.now();
    const jitter = 0.85 + Math.random() * 0.3;
    let next: number;
    if (!ok) {
      const fails = route.fail_count + 1;
      next = now + Math.min(12 * 3600_000, 5 * 60_000 * 2 ** Math.min(fails, 8));
    } else {
      // Routes with a live deal get watched twice as often.
      next = now + this.cycleMs() * (hasDeal ? 0.5 : 1) * jitter;
    }
    if (kind !== 'sample' && ok) {
      // Verifies and probes don't consume the route's sample slot; keep its schedule.
      this.db.prepare('UPDATE routes SET next_scan_at = MIN(next_scan_at, ?) WHERE id = ?').run(Math.max(route.next_scan_at, now), route.id);
      return;
    }
    this.db
      .prepare(
        `UPDATE routes SET next_scan_at = ?, last_scan_at = ?, scan_count = scan_count + ?,
           sample_cursor = sample_cursor + ?, fail_count = ? WHERE id = ?`,
      )
      .run(next, now, ok ? 1 : 0, ok && kind === 'sample' ? 1 : 0, ok ? 0 : route.fail_count + 1, route.id);
  }

  /** Housekeeping: expire stale deals, trim old logs. */
  maintain(now = Date.now()) {
    const expired = sweepStaleDeals(this.db, now);
    this.db.prepare('DELETE FROM scans WHERE created_at < ?').run(now - 7 * 86400_000);
    this.db.prepare('DELETE FROM observations WHERE observed_at < ?').run(now - 120 * 86400_000);
    return { expired };
  }
}
