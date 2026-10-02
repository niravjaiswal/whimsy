import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from '../account';
import { api, rememberedAlerts, useMeta, type Alert } from '../api';
import { REGION_EMOJI, money } from '../format';
import { isAnyWhen, whenSummary } from '../components/WhenPicker';

function describe(a: Alert) {
  const from = a.origins.length ? a.origins.join(', ') : 'any airport';
  const to = a.destinations.length || a.regions.length ? [...a.regions.map((r) => REGION_EMOJI[r]), ...a.destinations].join(' ') : 'anywhere 🌍';
  const when = isAnyWhen(a) ? '' : ` · ${whenSummary(a)}`;
  return `From ${from} → ${to}${when}${a.maxPrice ? ` · under ${money(a.maxPrice)}` : ''}`;
}

export function MyAlerts() {
  const meta = useMeta();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  const account = useAccount();
  useEffect(() => {
    if (!account.ready) return;
    // Signed in: the account is the source of truth (plus anything this browser
    // still holds that belongs to someone else's link).
    const owned = account.me?.alerts ?? [];
    const tokens = rememberedAlerts().filter((t) => !owned.some((a) => a.token === t.token));
    Promise.all(
      tokens.map((t) =>
        api<{ alert: Alert }>(`/alerts/${t.token}`)
          .then((r) => r.alert)
          .catch(() => null),
      ),
    ).then((xs) => setAlerts([...owned, ...xs.filter((x): x is Alert => !!x)]));
  }, [account.ready, account.me]);

  return (
    <div className="container" style={{ maxWidth: 760, paddingBottom: 60 }}>
      <section style={{ padding: '36px 0 20px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ fontWeight: 400, letterSpacing: '-0.03em', fontSize: 38, margin: 0 }}>My alerts</h1>
          <Link to="/alerts/new" className="btn btn-primary btn-sm">
            + New alert
          </Link>
        </div>
      </section>

      <div className="panel" style={{ padding: 10 }}>
        {alerts === null ? (
          <div className="center" style={{ padding: 30 }}>
            <span className="spinner" />
          </div>
        ) : alerts.length ? (
          alerts.map((a) => (
            <Link key={a.token} to={`/alerts/${a.token}`} className="mini-deal" style={{ padding: 14 }}>
              <span className={`live-dot ${a.paused ? 'off' : ''}`} />
              <div style={{ minWidth: 0 }}>
                <div>{a.name ?? 'Deal alert'}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {describe(a)}
                </div>
              </div>
              <span className="p muted" style={{ fontSize: 13 }}>
                {a.paused ? 'Paused' : 'Watching'} ›
              </span>
            </Link>
          ))
        ) : (
          <div className="empty" style={{ padding: 30 }}>
            <p>No alerts saved in this browser yet.</p>
          </div>
        )}
      </div>

      {account.enabled && !account.session && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 15 }}>Keep your alerts on every device</div>
          <p className="muted" style={{ fontSize: 14, margin: '4px 0 12px', lineHeight: 1.5 }}>
            Sign in with your email and the alerts above move into your account — no more hunting for manage links.
          </p>
          <Link to="/signin?next=/alerts" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
        </div>
      )}

      {meta?.emailEnabled && !account.session && (
      <div className="panel" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 15 }}>Lost a manage link?</div>
        <p className="muted" style={{ fontSize: 14, margin: '4px 0 12px' }}>
          Enter the email you used and we’ll send links to every alert tied to it.
        </p>
        {sent ? (
          <p className="ok-msg">If that email has alerts, links are on their way.</p>
        ) : (
          <form
            className="row"
            style={{ flexWrap: 'nowrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              api('/alerts/recover', { method: 'POST', json: { email } })
                .then(() => setSent(true))
                .catch((x) => setErr(x.message));
            }}
          >
            <input className="input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-ghost btn-sm" style={{ height: 46 }}>
              Send links
            </button>
          </form>
        )}
        {err && <p className="error-msg">{err}</p>}
      </div>
      )}
    </div>
  );
}
