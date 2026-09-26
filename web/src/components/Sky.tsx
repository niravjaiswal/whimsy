import { memo, useMemo } from 'react';

/** Deterministic PRNG so stars don't jump between renders. */
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function Clouds() {
  const r = rng(42);
  // Puffs along the horizon: [cx, cy, rx, ry]
  const back = Array.from({ length: 16 }, (_, i) => [i * 110 + r() * 60, 330 + r() * 70, 150 + r() * 120, 70 + r() * 50]);
  const front = Array.from({ length: 14 }, (_, i) => [i * 125 + r() * 80, 450 + r() * 70, 170 + r() * 140, 90 + r() * 60]);
  const wisps = Array.from({ length: 6 }, (_, i) => [120 + i * 280 + r() * 90, 170 + r() * 90, 110 + r() * 80, 18 + r() * 14]);
  return (
    <svg viewBox="0 0 1800 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <filter id="cloud-f" x="-20%" y="-40%" width="140%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="4" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="110" />
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="cloud-soft" x="-20%" y="-60%" width="140%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="60" />
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <linearGradient id="cloud-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6ee" />
          <stop offset="0.6" stopColor="#f4d3c0" />
          <stop offset="1" stopColor="#e6b39c" />
        </linearGradient>
      </defs>
      <g className="cloud-drift-b" filter="url(#cloud-soft)" opacity="0.35">
        {wisps.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#fde7d6" />
        ))}
      </g>
      <g className="cloud-drift-a" filter="url(#cloud-f)" opacity="0.62">
        {back.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#cloud-shade)" />
        ))}
      </g>
      <g className="cloud-drift-b" filter="url(#cloud-f)" opacity="0.92">
        {front.map(([cx, cy, rx, ry], i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#cloud-shade)" />
        ))}
        <rect x="0" y="520" width="1800" height="120" fill="#f7dcc8" />
      </g>
    </svg>
  );
}

export const Sky = memo(function Sky({ dim = false }: { dim?: boolean }) {
  const stars = useMemo(() => {
    const r = rng(1337);
    return Array.from({ length: 70 }, () => ({
      left: `${r() * 100}%`,
      top: `${r() * 100}%`,
      size: r() < 0.15 ? 2.4 : r() < 0.5 ? 1.6 : 1.1,
      delay: `${r() * 4}s`,
      dur: `${3 + r() * 4}s`,
    }));
  }, []);
  return (
    <div className="sky" data-dim={dim} aria-hidden="true">
      <div className="sky-stars">
        {stars.map((s, i) => (
          <i
            key={i}
            style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay, animationDuration: s.dur }}
          />
        ))}
      </div>
      <div className="sky-sun" />
      <div className="sky-clouds">
        <Clouds />
      </div>
      <div className="sky-grain" />
      <div className="sky-dim" />
    </div>
  );
});
