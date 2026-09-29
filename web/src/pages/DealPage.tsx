import { Link, useParams } from 'react-router-dom';
import { useApi, type Deal } from '../api';
import { CityImage, MiniDeal, PriceRange, TierBadge } from '../components/DealCard';
import { PriceChart } from '../components/PriceChart';
import { ago, dateRange, duration, money, num, pct, shortDate, stopsLabel, time12 } from '../format';
import { BellIcon } from './Home';

export function DealPage() {
  const { slug } = useParams();
  const { data, error, loading } = useApi<{ deal: Deal; related: Deal[] }>(`/deals/${slug}`);

  if (loading && !data)
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 340, marginTop: 16, borderRadius: 30 }} />
      </div>
    );
  if (error || !data)
    return (
      <div className="container">
        <div className="panel-glass empty" style={{ marginTop: 40 }}>
          <h3>That deal has flown the coop</h3>
          <p>Fares move fast. Here’s what’s live right now.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link to="/" className="btn btn-primary btn-sm">
              See live deals
            </Link>
          </div>
        </div>
      </div>
    );

  const { deal: d, related } = data;
  const expired = d.status !== 'active';
  const saved = d.baseline - d.price;
  const alertHref = `/alerts/new?from=${d.origin.code}&dest=${d.destination.code}`;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="row" style={{ marginTop: 8 }}>
        <Link to="/" className="pill pill-sm">
          ← All deals
        </Link>
      </div>

      <section className={`deal-hero ${d.destination.imageHd ? 'hd' : ''}`}>
        <CityImage src={d.destination.image} alt="" sizes="(max-width: 1180px) 100vw, 1180px" eager />
        {d.destination.imageCredit && (
          <a
            className="photo-credit"
            href={`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(d.destination.imageCredit)}`}
            target="_blank"
            rel="noreferrer"
          >
            Photo: Wikimedia Commons
          </a>
        )}
        <div className="deal-hero-inner">
          <div>
            {d.destination.image && (
              <div className="postcard">
                <CityImage src={d.destination.thumb ?? d.destination.image} alt={d.destination.city} sizes="150px" />
                <span>{d.destination.code}</span>
              </div>
            )}
            <div className="row">
              <TierBadge deal={d} />
              {expired ? (
                <span className="badge" style={{ color: 'var(--danger)' }}>
                  Expired {d.status === 'expired' ? '· price went back up' : ''}
                </span>
              ) : (
                <span className="badge" style={{ color: 'var(--text-2)' }}>
                  <span className="live-dot" style={{ width: 6, height: 6 }} /> Verified {ago(d.verifiedAt)}
                </span>
              )}
            </div>
            <h1>{d.destination.city}</h1>
            <div className="route">
              {d.origin.city} ({d.origin.code}) → {d.destination.city} ({d.destination.code})
              {d.destination.vibe ? ` · ${d.destination.vibe}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="big-price">{money(d.price)}</div>
            <div className="text-2" style={{ marginTop: 6 }}>
              round-trip · usually <s className="muted">{money(d.baseline)}</s>
            </div>
          </div>
        </div>
      </section>

      <div className="deal-layout">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Cheapest itinerary · {d.airline ?? 'Multiple airlines'}
                </div>
                <div style={{ fontSize: 18, marginTop: 2 }}>
                  {shortDate(d.departDate)} {d.returnDate ? `→ ${shortDate(d.returnDate)}` : ''}
                  {d.nights ? <span className="muted"> · {d.nights} nights</span> : null}
                </div>
              </div>
              <a className="btn btn-primary" href={d.bookingUrl} target="_blank" rel="noreferrer">
                Book on Google Flights ↗
              </a>
            </div>
            <div className="itin" style={{ marginTop: 8 }}>
              <div>
                <div className="time">{time12(d.departTime)}</div>
                <div className="code">{d.origin.code}</div>
              </div>
              <div className="line">
                {duration(d.durationMinutes)}
                <div className={d.stops === 0 ? 'nonstop' : ''}>
                  {stopsLabel(d.stops)}
                  {d.via.length ? ` via ${d.via.join(', ')}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="time">{time12(d.arriveTime)}</div>
                <div className="code">{d.destination.code}</div>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              Outbound shown. Google Flights will show matching return options and every bookable fare for these dates.
            </p>
          </div>

          <div className="panel">
            <div className="section-head" style={{ marginBottom: 6 }}>
              <h2 style={{ fontSize: 19 }}>Price history for these dates</h2>
              <span className="sub">Shaded band = typical range</span>
            </div>
            <PriceChart history={d.history} price={d.price} low={d.typicalLow} high={d.typicalHigh} />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="panel">
            <div style={{ fontSize: 15, marginBottom: 10 }}>Why it’s a deal</div>
            <PriceRange price={d.price} low={d.typicalLow} high={d.typicalHigh} baseline={d.baseline} />
            <div className="row muted" style={{ justifyContent: 'space-between', fontSize: 12, margin: '6px 0 16px' }}>
              <span>This fare {money(d.price)}</span>
              {d.typicalLow != null && d.typicalHigh != null && (
                <span>
                  Typical {money(d.typicalLow)}–{money(d.typicalHigh)}
                </span>
              )}
            </div>
            <dl className="kv">
              <dt>You save vs. normal</dt>
              <dd className="good">
                {money(saved)} (−{pct(d.discount)})
              </dd>
              {d.firstPrice !== d.price && (
                <>
                  <dt>First spotted at</dt>
                  <dd>{money(d.firstPrice)}</dd>
                </>
              )}
              <dt>Spotted</dt>
              <dd>{ago(d.foundAt)}</dd>
              {d.distance && (
                <>
                  <dt>Distance</dt>
                  <dd>
                    {num(d.distance)} mi · {((d.price / (d.distance * 2)) * 100).toFixed(1)}¢/mile
                  </dd>
                </>
              )}
              <dt>Dates</dt>
              <dd>{dateRange(d.departDate, d.returnDate)}</dd>
            </dl>
          </div>
          <div className="panel">
            <div style={{ fontSize: 15 }}>Want more like this?</div>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: '6px 0 14px' }}>
              Get pinged whenever {d.origin.city} → {d.destination.city} (or anywhere you like) drops this low.
            </p>
            <Link to={alertHref} className="btn btn-ghost btn-sm" style={{ width: '100%' }}>
              <BellIcon /> Create an alert
            </Link>
          </div>
          {related.length > 0 && (
            <div className="panel" style={{ padding: 12 }}>
              <div style={{ fontSize: 15, padding: '6px 10px 8px' }}>More deals nearby</div>
              {related.map((r) => (
                <MiniDeal key={r.id} deal={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
