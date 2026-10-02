import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLive } from '../App';
import { useAccount } from '../account';
import { useApi, useMeta, type Deal, type Dip, type Region, type ScanEvent, type Tier } from '../api';
import { CityImage, DealCard } from '../components/DealCard';
import { AirportList, Field, RegionList, summarize } from '../components/Pickers';
import { WhenPicker, isAnyWhen, whenFromParams, whenQuery, whenSummary, whenToParams, type When } from '../components/WhenPicker';
import { REGION_EMOJI, dateRange, money, num, pct } from '../format';

// The map (and its geo library) only loads when someone opens the Atlas view.
const WorldMap = lazy(() => import('../components/WorldMap').then((m) => ({ default: m.WorldMap })));

const SORTS = [
  { id: 'score', label: 'Best' },
  { id: 'price', label: 'Cheapest' },
  { id: 'discount', label: 'Biggest drop' },
  { id: 'new', label: 'Newest' },
] as const;

const TIER_FILTERS: { id: Tier; label: string }[] = [
  { id: 'good', label: 'All deals' },
  { id: 'great', label: 'Great+' },
  { id: 'incredible', label: 'Incredible' },
];

const PRICE_PRESETS = [150, 250, 400, 600, 900];

function Ticker({ scans }: { scans: ScanEvent[] }) {
  const s = scans.find((x) => x.ok && x.price);
  const { stats, connected } = useLive();
  if (!s)
    return (
      <span className="pill ticker">
        <span className={`live-dot ${connected ? '' : 'off'}`} />
        <span className="tk-text">
          {stats ? `Watching ${num(stats.routes)} routes around the clock` : 'Connecting to the scanner…'}
        </span>
      </span>
    );
  const under = s.typical && s.price! < s.typical;
  return (
    <Link to="/scanner" className="pill ticker" title="Live scanner feed">
      <span className="live-dot" />
      <span key={`${s.at}`} className="tk-text tk-anim">
        Just checked {s.origin} → {s.destination} · <b style={{ fontWeight: 500 }}>{money(s.price!)}</b>
        {s.typical ? <span className={under ? 'good' : 'muted'}> (typically {money(s.typical)})</span> : null}
      </span>
    </Link>
  );
}

export const DIPS_PATH = '/dips?limit=8';

/** The feed request for the home page's URL filters (also used to prefetch it at boot). */
export function feedPath(params: URLSearchParams) {
  const q = new URLSearchParams();
  const origins = params.get('from')?.split(',').filter(Boolean) ?? [];
  const regions = params.get('to')?.split(',').filter(Boolean) ?? [];
  if (origins.length) q.set('origin', origins.join(','));
  if (regions.length) q.set('region', regions.join(','));
  const wq = whenQuery(whenFromParams(params));
  if (wq.months.length) q.set('month', wq.months.join(','));
  if (wq.departFrom && wq.departTo) (q.set('departFrom', wq.departFrom), q.set('departTo', wq.departTo));
  if (wq.minNights != null) q.set('minNights', String(wq.minNights));
  if (wq.maxNights != null) q.set('maxNights', String(wq.maxNights));
  const max = Number(params.get('max'));
  if (max) q.set('maxPrice', String(max));
  q.set('tier', params.get('tier') ?? 'good');
  q.set('sort', params.get('sort') ?? 'score');
  q.set('limit', '120');
  return `/deals?${q}`;
}

export function Home() {
  const meta = useMeta();
  const nav = useNavigate();
  const { scans, lastDealEvent, stats } = useLive();
  const [params, setParams] = useSearchParams();
  const account = useAccount();
  // Signed-in travellers start filtered to their home airports — once per session,
  // and never over an explicit filter in the URL.
  useEffect(() => {
    const homes = account.me?.profile.homeAirports ?? [];
    if (!homes.length || params.has('from')) return;
    try {
      if (sessionStorage.getItem('whimsy:homeDefaultApplied')) return;
      sessionStorage.setItem('whimsy:homeDefaultApplied', '1');
    } catch {
      return;
    }
    const next = new URLSearchParams(params);
    next.set('from', homes.join(','));
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.me]);
  const origins = params.get('from')?.split(',').filter(Boolean) ?? [];
  const regions = (params.get('to')?.split(',').filter(Boolean) ?? []) as Region[];
  const when = whenFromParams(params);
  const setWhen = (w: When) => setParams(whenToParams(w, new URLSearchParams(params)), { replace: true });
  const maxPrice = Number(params.get('max')) || null;
  const sort = params.get('sort') ?? 'score';
  const tier = (params.get('tier') ?? 'good') as Tier;
  const [atlas, setAtlas] = useState(params.get('view') === 'map');

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const { data, loading, refetch } = useApi<{ total: number; deals: Deal[] }>(feedPath(params), { keepPrevious: true });
  const dips = useApi<{ dips: Dip[] }>(DIPS_PATH);

  // New deal streamed in → refresh the grid (the server applies the filters).
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!lastDealEvent) return;
    if (lastDealEvent.kind === 'new' || lastDealEvent.kind === 'dropped') {
      setFreshIds((s) => new Set(s).add(lastDealEvent.deal.id));
    }
    const t = setTimeout(() => {
      refetch();
      dips.refetch();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDealEvent]);

  const deals = data?.deals ?? [];
  const alertHref = useMemo(() => {
    const a = new URLSearchParams();
    if (origins.length) a.set('from', origins.join(','));
    if (regions.length) a.set('to', regions.join(','));
    whenToParams(when, a);
    if (maxPrice) a.set('max', String(maxPrice));
    return `/alerts/new${a.size ? `?${a}` : ''}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origins, regions, params.get('when'), params.get('dep'), params.get('nights'), maxPrice]);

  const regionLabel = regions.length
    ? regions.length === 1
      ? `${REGION_EMOJI[regions[0]]} ${meta?.regions.find((r) => r.id === regions[0])?.label ?? regions[0]}`
      : `${regions.length} regions`
    : 'Anywhere';

  return (
    <div className="container">
      <section className="hero">
        <div className="eyebrow">
          <Ticker scans={scans} />
        </div>
        <h1>Cheap flights to wherever.</h1>
        <p className="lede">
          Whimsy scans {stats ? num(stats.routes) : 'thousands of'} routes around the clock and flags the moment a fare
          drops far below normal. Pick the vibe, not the route.
        </p>

        <div className="searchbar" role="search">
          <Field label="From" value={summarize(origins, meta?.airports, 'Any airport')} placeholder={!origins.length}>
            {() =>
              meta && (
                <>
                  <AirportList airports={meta.airports} hubsOnly selected={origins} onChange={(c) => set('from', c.join(',') || null)} />
                  <div className="pop-foot">
                    <button className="linkish" onClick={() => set('from', null)}>
                      Any airport
                    </button>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {origins.length ? `${origins.length} selected` : 'Scanning all hubs'}
                    </span>
                  </div>
                </>
              )
            }
          </Field>
          <Field label="To" value={regionLabel} placeholder={!regions.length}>
            {() => meta && <RegionList regions={meta.regions} selected={regions} onChange={(r) => set('to', r.join(',') || null)} />}
          </Field>
          <Field label="When" value={whenSummary(when)} placeholder={isAnyWhen(when)} align="right" wide>
            {() => <WhenPicker value={when} onChange={setWhen} />}
          </Field>
          <Field label="Max price" value={maxPrice ? `Under ${money(maxPrice)}` : 'Any price'} placeholder={!maxPrice} align="right">
            {(close) => (
              <div style={{ padding: 6, width: 300 }}>
                <div className="chips">
                  <button className={`chip ${!maxPrice ? 'on' : ''}`} onClick={() => (set('max', null), close())}>
                    Any
                  </button>
                  {PRICE_PRESETS.map((p) => (
                    <button key={p} className={`chip ${maxPrice === p ? 'on' : ''}`} onClick={() => (set('max', String(p)), close())}>
                      Under {money(p)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>
          <button className="btn btn-primary" onClick={() => nav(alertHref)}>
            <BellIcon /> Alert me
          </button>
        </div>
      </section>

      <div className="toolbar">
        <span className="count">
          {loading && !data ? (
            'Loading deals…'
          ) : (
            <>
              <b style={{ fontWeight: 500, color: 'var(--text)' }}>{data?.total ?? 0}</b> live deal{data?.total === 1 ? '' : 's'}
              {stats?.dealsToday ? <span className="muted"> · {stats.dealsToday} found today</span> : null}
            </>
          )}
        </span>
        <button className={`pill pill-sm`} onClick={() => (setAtlas((a) => !a), set('view', atlas ? null : 'map'))} aria-pressed={atlas}>
          Atlas <span className={`toggle ${atlas ? 'on' : ''}`} style={{ transform: 'scale(.85)' }} />
        </button>
        <div className="seg" role="group" aria-label="Deal quality">
          {TIER_FILTERS.map((t) => (
            <button key={t.id} className={tier === t.id ? 'on' : ''} onClick={() => set('tier', t.id === 'good' ? null : t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button key={s.id} className={sort === s.id ? 'on' : ''} onClick={() => set('sort', s.id === 'score' ? null : s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {atlas && deals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Suspense fallback={<div className="skeleton" style={{ height: 360 }} />}>
            <WorldMap deals={deals} />
          </Suspense>
        </div>
      )}

      {loading && !data ? (
        <div className="deal-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : deals.length ? (
        <div className="deal-grid">
          {deals.map((d, i) => (
            // The first rows are above the fold: fetch their photos right away.
            <DealCard key={d.id} deal={d} fresh={freshIds.has(d.id)} eager={i < 6} />
          ))}
        </div>
      ) : (
        <EmptyDeals filtered={!!(origins.length || regions.length || !isAnyWhen(when) || maxPrice || tier !== 'good')} alertHref={alertHref} />
      )}

      {!!dips.data?.dips.length && (
        <section className="section">
          <div className="section-head">
            <h2>Dipping below normal</h2>
            <span className="sub">Fares under typical that haven’t hit deal territory — yet.</span>
          </div>
          <div className="dips">
            {dips.data.dips.map((d) => (
              <a key={`${d.origin.code}${d.destination.code}`} className="dip" href={d.bookingUrl} target="_blank" rel="noreferrer">
                {d.destination.image ? <CityImage src={d.destination.image} alt="" sizes="44px" max={44} /> : <div className="ph" />}
                <div style={{ minWidth: 0 }}>
                  <div className="t">
                    {d.origin.city} → {d.destination.city}
                  </div>
                  <div className="s">{dateRange(d.departDate, d.returnDate)}</div>
                </div>
                <div className="p">
                  <b>{money(d.price)}</b>
                  <span>−{pct(d.discount)}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>How Whimsy works</h2>
        </div>
        <div className="steps">
          <div className="step">
            <div className="n">1</div>
            <h3>We scan everything</h3>
            <p>
              {stats ? num(stats.routes) : 'Thousands of'} routes from {stats ? 'every major' : 'major'} US & Canadian hub, rotating
              through dates 3 weeks to 7 months out — all day, every day.
            </p>
          </div>
          <div className="step">
            <div className="n">2</div>
            <h3>We know normal</h3>
            <p>Each fare is compared to what that trip typically costs, using 60 days of price history plus our own observations.</p>
          </div>
          <div className="step">
            <div className="n">3</div>
            <h3>You get pinged</h3>
            <p>When a fare drops 40%+ below normal and matches your vibe, we notify you by push, email, ntfy or Discord/Slack.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyDeals({ filtered, alertHref }: { filtered: boolean; alertHref: string }) {
  const { scans, stats } = useLive();
  return (
    <div className="panel-glass empty">
      <div className="spinner" />
      <h3>{filtered ? 'Nothing matches right now' : 'The scanner is warming up'}</h3>
      <p>
        {filtered
          ? 'Deals come and go by the hour. Set an alert with these filters and we’ll ping you the moment one lands.'
          : `We’ve checked ${num(stats?.totalScans ?? 0)} fares so far. Real deals are rare by design — only fares 40%+ below normal make the cut.`}
      </p>
      <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
        <Link to={alertHref} className="btn btn-primary btn-sm">
          Alert me when one lands
        </Link>
        <Link to="/scanner" className="btn btn-ghost btn-sm">
          Watch the scanner
        </Link>
      </div>
      {scans.length > 0 && (
        <div className="log" style={{ maxWidth: 520, margin: '24px auto 0', textAlign: 'left' }}>
          {scans.slice(0, 5).map((s) => (
            <div key={s.at + s.origin + s.destination} className="log-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
              <span>
                {s.origin} → {s.destination}
              </span>
              <span className="muted">{dateRange(s.departDate, s.returnDate ?? null)}</span>
              <span className={s.ok ? (s.typical && s.price! < s.typical ? 'under' : 'over') : 'fail'}>
                {s.ok ? (s.price ? money(s.price) : '—') : 'retry'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
