import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAccount } from '../account';
import type { Deal } from '../api';
import { TIER_LABEL, ago, dateRange, duration, money, pct, stopsLabel } from '../format';

// Wikimedia serves only standard thumbnail widths; offer the browser a few.
const WIKI_WIDTHS = [500, 960, 1280];
const isWikimedia = (src: string) => /wikimedia\.org\/.+\/\d+px-/.test(src);
const wikiSize = (src: string, w: number) => src.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);

export function CityImage({ src, alt, sizes, eager }: { src: string | null; alt: string; sizes?: string; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  const srcSet = isWikimedia(src) ? WIKI_WIDTHS.map((w) => `${wikiSize(src, w)} ${w}w`).join(', ') : undefined;
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? '(max-width: 640px) 100vw, 420px') : undefined}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
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
        <CityImage src={deal.destination.thumb ?? deal.destination.image} alt="" />
        <div className="dc-badges">
          <TierBadge deal={deal} />
          <span className="row" style={{ gap: 6 }}>
            <span className="badge" style={{ color: 'var(--text-2)' }}>
              {ago(deal.foundAt)}
            </span>
            <SaveButton slug={deal.slug} compact />
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
            {deal.otherCount ? (
              <div className="dc-more">
                +{deal.otherCount} more date{deal.otherCount > 1 ? 's' : ''} from {money(Math.min(...(deal.otherDates ?? []).map((o) => o.price)))}
              </div>
            ) : null}
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
      {deal.destination.thumb ? <CityImage src={deal.destination.thumb} alt="" sizes="48px" /> : <div className="ph" />}
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

/** Heart toggle. Signed out: sends you to sign in, then back here. Hidden when accounts are off. */
export function SaveButton({ slug, compact }: { slug: string; compact?: boolean }) {
  const account = useAccount();
  const nav = useNavigate();
  const loc = useLocation();
  if (!account.enabled) return null;
  const saved = account.isSaved(slug);
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault(); // cards are links
    e.stopPropagation();
    if (!account.session) return nav(`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    void account.toggleSaved(slug);
  };
  return (
    <button
      type="button"
      className={`save-btn ${compact ? 'compact' : ''} ${saved ? 'on' : ''}`}
      onClick={onClick}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved deals' : 'Save deal'}
      title={saved ? 'Saved' : 'Save deal'}
    >
      {saved ? '♥' : '♡'}
      {!compact && <span>{saved ? 'Saved' : 'Save'}</span>}
    </button>
  );
}
