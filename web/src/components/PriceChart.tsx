import { money } from '../format';

/**
 * 60-day price history for this exact search (from Google), with the typical
 * band shaded and today's fare marked.
 */
export function PriceChart({
  history,
  price,
  low,
  high,
}: {
  history: [number, number][];
  price: number;
  low: number | null;
  high: number | null;
}) {
  const pts = history.length ? history : [[Date.now(), price] as [number, number]];
  const W = 600;
  const H = 180;
  const P = { l: 44, r: 12, t: 12, b: 24 };
  const xs = pts.map((p) => p[0]);
  const ys = [...pts.map((p) => p[1]), price, ...(low ? [low] : []), ...(high ? [high] : [])];
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs, x0 + 1);
  const y0 = Math.min(...ys) * 0.9;
  const y1 = Math.max(...ys) * 1.05;
  const X = (t: number) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  // Step line: prices hold until they change.
  let d = `M${X(pts[0][0])},${Y(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` H${X(pts[i][0])} V${Y(pts[i][1])}`;
  const area = `${d} V${H - P.b} H${X(pts[0][0])} Z`;
  const ticks = [y0 + (y1 - y0) * 0.15, (y0 + y1) / 2, y1 - (y1 - y0) * 0.1];
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const last = pts[pts.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price history">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(139,169,255,.35)" />
          <stop offset="1" stopColor="rgba(139,169,255,0)" />
        </linearGradient>
      </defs>
      {low != null && high != null && (
        <rect className="typ-band" x={P.l} width={W - P.l - P.r} y={Y(high)} height={Math.max(1, Y(low) - Y(high))} />
      )}
      {ticks.map((v) => (
        <text key={v} className="axis" x={P.l - 8} y={Y(v) + 3} textAnchor="end">
          {money(v)}
        </text>
      ))}
      <path className="area" d={area} />
      <path className="ln" d={d} vectorEffect="non-scaling-stroke" />
      <circle className="now" cx={X(last[0])} cy={Y(price)} r={4.5} />
      <text className="axis" x={P.l} y={H - 6}>
        {fmt(x0)}
      </text>
      <text className="axis" x={W - P.r} y={H - 6} textAnchor="end">
        {fmt(x1)}
      </text>
    </svg>
  );
}
