import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { feature } from 'topojson-client';
import land110 from 'world-atlas/land-110m.json';
import type { Deal, Tier } from '../api';
import { dateRange, money, pct } from '../format';

const W = 960;
const H = 500;
const TIER_COLOR: Record<Tier, string> = { good: '#6fdca0', great: '#8ba9ff', incredible: '#ffd27f' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const land = feature(land110 as any, (land110 as any).objects.land);
const projection = geoNaturalEarth1().fitExtent(
  [
    [8, 8],
    [W - 8, H - 8],
  ],
  { type: 'Sphere' },
);
const path = geoPath(projection);
const landPath = path(land as never) ?? '';
const gratPath = path(geoGraticule10()) ?? '';

/** Quadratic arc bowing away from the equator so routes read as flight paths. */
function arc(a: [number, number], b: [number, number]) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const lift = Math.min(120, dist * 0.28);
  return `M${x1},${y1} Q${mx},${my - lift} ${x2},${y2}`;
}

export function WorldMap({ deals }: { deals: Deal[] }) {
  const nav = useNavigate();
  const [hover, setHover] = useState<Deal | null>(null);
  const items = useMemo(
    () =>
      deals
        .filter((d) => d.origin.lat != null && d.destination.lat != null)
        .map((d) => {
          const o = projection([d.origin.lon!, d.origin.lat!])!;
          const t = projection([d.destination.lon!, d.destination.lat!])!;
          // Long east-west hops across the antimeridian look silly; skip their arcs.
          const wrap = Math.abs(o[0] - t[0]) > W * 0.55;
          return { d, o, t, wrap };
        })
        .sort((a, b) => a.d.score - b.d.score),
    [deals],
  );
  const origins = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const i of items) m.set(i.d.origin.code, i.o);
    return [...m.entries()];
  }, [items]);
  const hp = hover ? items.find((i) => i.d.id === hover.id) : null;

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of ${deals.length} flight deals`}>
        <path d={gratPath} className="map-grat" />
        <path d={landPath} className="map-land" />
        {items.map(({ d, o, t, wrap }) =>
          wrap ? null : (
            <path
              key={`a${d.id}`}
              d={arc(o, t)}
              className={`map-arc ${hover ? (hover.id === d.id ? 'hl' : 'dim') : ''}`}
              stroke={TIER_COLOR[d.tier]}
            />
          ),
        )}
        {origins.map(([code, [x, y]]) => (
          <circle key={code} cx={x} cy={y} r={2.2} className="map-origin" />
        ))}
        {items.map(({ d, t }) => (
          <g key={`d${d.id}`}>
            <circle cx={t[0]} cy={t[1]} r={hover?.id === d.id ? 10 : 7} fill={TIER_COLOR[d.tier]} opacity={0.18} />
            <circle
              className="map-dot"
              cx={t[0]}
              cy={t[1]}
              r={hover?.id === d.id ? 5.5 : 3.6}
              fill={TIER_COLOR[d.tier]}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onClick={() => nav(`/deal/${d.slug}`)}
            >
              <title>{`${d.origin.city} → ${d.destination.city} ${money(d.price)}`}</title>
            </circle>
          </g>
        ))}
      </svg>
      {hover && hp && (
        <div className="map-tip" style={{ left: `${(hp.t[0] / W) * 100}%`, top: `${(hp.t[1] / H) * 100}%` }}>
          <div className="text-2" style={{ fontSize: 12 }}>
            {hover.origin.city} → {hover.destination.city}
          </div>
          <b>{money(hover.price)}</b> <span className="good">−{pct(hover.discount)}</span>
          <div className="muted" style={{ fontSize: 12 }}>
            {dateRange(hover.departDate, hover.returnDate)}
          </div>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i style={{ background: TIER_COLOR.good }} />
          Good
        </span>
        <span>
          <i style={{ background: TIER_COLOR.great }} />
          Great
        </span>
        <span>
          <i style={{ background: TIER_COLOR.incredible }} />
          Incredible
        </span>
      </div>
    </div>
  );
}
