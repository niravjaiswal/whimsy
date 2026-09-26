import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Deal } from '../api';
import { TIER_LABEL, ago, dateRange, duration, money, pct, stopsLabel } from '../format';

export function CityImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function PriceRange({ price, low, high, baseline }: { price: number; low: number | null; high: number | null; baseline: number }) {
  const lo = Math.min(price, low ?? baseline * 0.8) * 0.85;
  const hi = Math.max(high ?? baseline * 1.2, baseline) * 1.08;
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="range" title={`Typical ${money(low ?? baseline)}–${money(high ?? baseline)}`}>
      {low != null && high != null && (
        <div className="typ" style={{ left: x(low), width: `calc(${x(high)} - ${x(low)})` }} />
      )}
      <div className="mark" style={{ left: x(price) }} />
    </div>
  );
}

export function TierBadge({ deal }: { deal: Pick<Deal, 'tier' | 'discount'> }) {
  return (
    <span className={`badge ${deal.tier}`}>
      {deal.tier === 'incredible' ? '✦ ' : ''}
      {TIER_LABEL[deal.tier]} · −{pct(deal.discount)}
    </span>
  );
}

export function DealCard({ deal, fresh }: { deal: Deal; fresh?: boolean }) {
  return (
    <Link to={`/deal/${deal.slug}`} className={`deal-card ${fresh ? 'fresh' : ''}`} aria-label={`${deal.destination.city} for ${money(deal.price)}`}>
      <div className="dc-media">
        <CityImage src={deal.destination.image} alt="" />
        <div className="dc-badges">
          <TierBadge deal={deal} />
          <span className="badge" style={{ color: 'var(--text-2)' }}>
            {ago(deal.foundAt)}
          </span>
        </div>
        <div className="dc-city">
          <h3>{deal.destination.city}</h3>
          {deal.destination.vibe && <div className="vibe">{deal.destination.vibe}</div>}
        </div>
      </div>
      <div className="dc-body">
        <div className="dc-row">
          <div>
            <div className="dc-from">
              from <b>{deal.origin.city}</b> · {deal.origin.code}→{deal.destination.code}
            </div>
            <div className="dc-dates">
              {dateRange(deal.departDate, deal.returnDate)}
              {deal.nights ? <span className="muted"> · {deal.nights} nights</span> : null}
            </div>
          </div>
          <div className="dc-price">
            <div className="price">{money(deal.price)}</div>
            <div className="was">
              usually <s>{money(deal.baseline)}</s>
            </div>
          </div>
        </div>
        <PriceRange price={deal.price} low={deal.typicalLow} high={deal.typicalHigh} baseline={deal.baseline} />
        <div className="dc-meta">
          <span>{deal.airline ?? 'Multiple airlines'}</span>
          <span className={deal.stops === 0 ? 'nonstop' : ''}>{stopsLabel(deal.stops)}</span>
          {deal.durationMinutes ? <span>{duration(deal.durationMinutes)}</span> : null}
          <span style={{ marginLeft: 'auto' }}>Round-trip · Economy</span>
        </div>
      </div>
    </Link>
  );
}

export function MiniDeal({ deal }: { deal: Deal }) {
  return (
    <Link to={`/deal/${deal.slug}`} className="mini-deal">
      {deal.destination.image ? <CityImage src={deal.destination.image} alt="" /> : <div className="ph" />}
      <div style={{ minWidth: 0 }}>
        <div>
          {deal.origin.city} → {deal.destination.city}
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {dateRange(deal.departDate, deal.returnDate)} · {stopsLabel(deal.stops)}
        </div>
      </div>
      <div className="p">
        {money(deal.price)}
        <span className="good">−{pct(deal.discount)}</span>
      </div>
    </Link>
  );
}
