import { useEffect, useState } from 'react';
import { useLive } from '../App';
import type { ScanEvent } from '../api';
import { ago, dateRange, money, num, pct } from '../format';

type Row = {
  key: string;
  origin: string;
  destination: string;
  depart: string;
  ret: string | null;
  ok: boolean;
  price: number | null;
  typical: number | null;
  ms: number;
  at: number;
  verify?: boolean;
};

export function Scanner() {
  const { stats, scans, connected } = useLive();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const live: Row[] = scans.map((s: ScanEvent) => ({
    key: `l${s.at}${s.origin}${s.destination}`,
    origin: s.origin,
    destination: s.destination,
    depart: s.departDate,
    ret: s.returnDate ?? null,
    ok: s.ok,
    price: s.price,
    typical: s.typical,
    ms: s.durationMs,
    at: s.at,
    verify: s.kind !== 'sample',
  }));
  const seen = new Set(live.map((r) => r.at));
  const hist: Row[] = (stats?.recent ?? [])
    .filter((r) => !seen.has(r.created_at))
    .map((r) => ({
      key: `h${r.created_at}${r.origin}${r.destination}`,
      origin: r.origin,
      destination: r.destination,
      depart: r.depart_date,
      ret: r.return_date,
      ok: !!r.ok,
      price: r.price,
      typical: r.last_typical,
      ms: r.duration_ms,
      at: r.created_at,
    }));
  const rows = [...live, ...hist].sort((a, b) => b.at - a.at).slice(0, 30);
  const paused = stats?.scanner.pausedUntil;
  const coverage = stats && stats.routes ? stats.covered24h / stats.routes : 0;

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <section className="hero" style={{ padding: '40px 0 30px' }}>
        <div className="eyebrow">
          <span className="pill">
            <span className={`live-dot ${connected && stats?.scanner.running && !paused ? '' : 'off'}`} />
            {!stats
              ? 'Connecting…'
              : paused
                ? `Cooling down until ${new Date(paused).toLocaleTimeString()}`
                : stats.scanner.running
                  ? `Scanning live · ${stats.scanner.rpm} fares/min`
                  : 'Scanner offline'}
          </span>
        </div>
        <h1 style={{ fontSize: 'clamp(32px,4.6vw,52px)' }}>The scanner never sleeps.</h1>
        <p className="lede">
          A polite, relentless robot checking fares across {stats ? num(stats.routes) : 'thousands of'} routes and comparing each
          one to what that trip normally costs.
        </p>
      </section>

      <div className="stat-grid">
        <div className="stat">
          <div className="v">{stats ? num(stats.routes) : '—'}</div>
          <div className="l">routes watched</div>
        </div>
        <div className="stat">
          <div className="v">{stats ? num(stats.totalScans) : '—'}</div>
          <div className="l">fares checked all-time</div>
        </div>
        <div className="stat">
          <div className="v">{stats ? num(stats.scansLastHour) : '—'}</div>
          <div className="l">checks in the last hour</div>
        </div>
        <div className="stat">
          <div className="v">{stats ? pct(coverage) : '—'}</div>
          <div className="l">of routes checked in 24h</div>
        </div>
        <div className="stat">
          <div className="v">{stats ? num(stats.activeDeals) : '—'}</div>
          <div className="l">live deals</div>
        </div>
        <div className="stat">
          <div className="v">{stats?.bestDiscount ? `−${pct(stats.bestDiscount)}` : '—'}</div>
          <div className="l">best live discount</div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Live feed</h2>
          <span className="sub">
            {stats?.successRateLastHour != null ? `${pct(stats.successRateLastHour)} success in the last hour` : ''}
          </span>
        </div>
        <div className="panel log">
          <div className="log-row head">
            <span>Route</span>
            <span>Dates</span>
            <span>Fare</span>
            <span>Typical</span>
            <span>When</span>
          </div>
          {rows.map((r) => {
            const under = r.ok && r.price && r.typical && r.price < r.typical;
            return (
              <div key={r.key} className="log-row">
                <span>
                  {r.origin} → {r.destination}
                  {r.verify ? <span className="muted"> ✓</span> : null}
                </span>
                <span className="muted">{dateRange(r.depart, r.ret)}</span>
                <span className={r.ok ? (under ? 'under' : 'over') : 'fail'}>{r.ok ? (r.price ? money(r.price) : 'no fares') : 'retry'}</span>
                <span className="muted">{r.typical ? money(r.typical) : '—'}</span>
                <span className="muted">{ago(r.at)}</span>
              </div>
            );
          })}
          {!rows.length && <div className="muted" style={{ padding: 14 }}>Waiting for the first scan…</div>}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>What counts as a deal</h2>
        </div>
        <div className="steps">
          <div className="step">
            <div className="n">%</div>
            <h3>Discount vs. normal</h3>
            <p>
              We blend Google’s typical price for those exact dates, the 60-day price history, and our own observations of the route
              into a baseline.
            </p>
          </div>
          <div className="step">
            <div className="n">↓</div>
            <h3>Below the typical range</h3>
            <p>A fare must be 40%+ under baseline, at least 15% under the bottom of Google’s typical range, and save $60+. Routes that are always cheap don’t count.</p>
          </div>
          <div className="step">
            <div className="n">✦</div>
            <h3>Good, great, incredible</h3>
            <p>40%+ off is good, 50%+ great, 60%+ incredible. Deals are re-verified every few hours and vanish when the price recovers.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
