import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAccount } from '../account';
import { useMeta } from '../api';
import { DealCard } from '../components/DealCard';
import { AirportList, useClickOutside } from '../components/Pickers';
import { isAnyWhen, whenSummary } from '../components/WhenPicker';
import { REGION_EMOJI, money } from '../format';

export function Account() {
  const account = useAccount();
  const meta = useMeta();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const pickRef = useClickOutside(picking, () => setPicking(false));
  const [err, setErr] = useState('');

  if (account.ready && !account.session) return <Navigate to="/signin?next=/account" replace />;
  const me = account.me;
  if (!me || !meta)
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 420, marginTop: 30 }} />
      </div>
    );

  const city = (code: string) => meta.airports.find((a) => a.code === code)?.city ?? code;
  const homes = me.profile.homeAirports;
  const setHomes = (codes: string[]) => account.setHomeAirports(codes).catch((e) => setErr(e.message));
  const live = me.saved.filter((d) => d.status === 'active');
  const gone = me.saved.filter((d) => d.status !== 'active');

  return (
    <div className="container" style={{ paddingBottom: 60 }}>
      <section style={{ padding: '32px 0 20px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              Member since {new Date(me.profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </div>
            <h1 style={{ fontWeight: 400, letterSpacing: '-0.03em', fontSize: 'clamp(24px, 6vw, 36px)', margin: '4px 0 0', overflowWrap: 'anywhere' }}>{me.user.email}</h1>
          </div>
          <button
            className="pill"
            onClick={() => {
              // Leave first, so this page's "must be signed in" redirect doesn't win the race.
              navigate('/', { replace: true });
              void account.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </section>

      <div className="account-grid">
        <div className="panel">
          <div style={{ fontSize: 17 }}>Home airports</div>
          <p className="muted" style={{ fontSize: 14, margin: '4px 0 14px', lineHeight: 1.5 }}>
            Where you usually fly from. The deals feed starts filtered to these.
          </p>
          <div className="chips">
            {homes.map((c) => (
              <button key={c} className="chip on" onClick={() => setHomes(homes.filter((x) => x !== c))}>
                {city(c)} <span className="x">×</span>
              </button>
            ))}
            <div ref={pickRef} style={{ position: 'relative', display: 'inline-block' }}>
              <button className={`chip ${homes.length ? '' : 'on'}`} onClick={() => setPicking((p) => !p)}>
                {homes.length ? '+ Add airport' : '✈ Pick your airports'}
              </button>
              {picking && (
                <div className="popover">
                  <AirportList airports={meta.airports.filter((a) => a.hub)} selected={homes} onChange={setHomes} />
                </div>
              )}
            </div>
          </div>
          {err && <p className="error-msg">{err}</p>}
        </div>

        <div className="panel" style={{ padding: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '8px 10px 6px' }}>
            <span style={{ fontSize: 17 }}>Your alerts</span>
            <Link to="/alerts/new" className="btn btn-primary btn-sm">
              + New alert
            </Link>
          </div>
          {me.alerts.length ? (
            me.alerts.map((a) => (
              <Link key={a.token} to={`/alerts/${a.token}`} className="mini-deal" style={{ padding: 12 }}>
                <span className={`live-dot ${a.paused ? 'off' : ''}`} />
                <div style={{ minWidth: 0 }}>
                  <div>{a.name ?? 'Deal alert'}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    From {a.origins.length ? a.origins.join(', ') : 'any airport'} →{' '}
                    {a.destinations.length || a.regions.length ? [...a.regions.map((r) => REGION_EMOJI[r]), ...a.destinations].join(' ') : 'anywhere 🌍'}
                    {isAnyWhen(a) ? '' : ` · ${whenSummary(a)}`}
                    {a.maxPrice ? ` · under ${money(a.maxPrice)}` : ''}
                  </div>
                </div>
                <span className="p muted" style={{ fontSize: 13 }}>
                  {a.paused ? 'Paused' : 'Watching'} ›
                </span>
              </Link>
            ))
          ) : (
            <p className="muted" style={{ fontSize: 14, padding: '6px 10px 10px' }}>
              No alerts yet. Alerts you make while signed in — or made earlier with {me.user.email} — show up here.
            </p>
          )}
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>Saved deals</h2>
          <span className="sub">{me.saved.length ? 'Tap the heart on any deal to add or remove it.' : ''}</span>
        </div>
        {live.length ? (
          <div className="deal-grid">
            {live.map((d) => (
              <DealCard key={d.id} deal={d} />
            ))}
          </div>
        ) : (
          <div className="panel-glass empty" style={{ padding: 30 }}>
            <p>Nothing saved yet. Hit ♡ on a deal you like and it’ll wait for you here.</p>
          </div>
        )}
        {gone.length > 0 && (
          <div className="panel" style={{ padding: 10, marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 13, padding: '6px 10px' }}>
              No longer available — these fares went back up
            </div>
            {gone.map((d) => (
              <Link key={d.id} to={`/deal/${d.slug}`} className="mini-deal" style={{ opacity: 0.6 }}>
                <div className="ph" />
                <div>
                  {d.origin.city} → {d.destination.city}
                  <div className="muted" style={{ fontSize: 13 }}>
                    was {money(d.price)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="panel">
          <div style={{ fontSize: 17 }}>Delete account</div>
          <p className="muted" style={{ fontSize: 14, margin: '4px 0 14px', lineHeight: 1.5 }}>
            Removes your account, all {me.alerts.length} of your alerts and your saved deals. This can’t be undone.
          </p>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              if (!confirm(`Delete ${me.user.email} and all ${me.alerts.length} alert(s)? This cannot be undone.`)) return;
              try {
                await account.deleteAccount();
                navigate('/', { replace: true });
                void account.signOut();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            Delete my account
          </button>
        </div>
      </section>
    </div>
  );
}
