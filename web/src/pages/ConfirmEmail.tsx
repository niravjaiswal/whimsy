import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, rememberAlert, type Alert } from '../api';

/** Landing page for the link in the "confirm your email" message. */
export function ConfirmEmail() {
  const { token } = useParams();
  const [state, setState] = useState<{ alert?: Alert; error?: string } | null>(null);

  useEffect(() => {
    api<{ alert: Alert }>('/alerts/confirm', { method: 'POST', json: { token } })
      .then(({ alert }) => {
        rememberAlert({ token: alert.token, name: alert.name ?? 'My alert' });
        setState({ alert });
      })
      .catch((e) => setState({ error: e.message }));
  }, [token]);

  return (
    <div className="container" style={{ maxWidth: 560, paddingBottom: 60 }}>
      <div className="panel" style={{ marginTop: 48, textAlign: 'center', padding: 36 }}>
        {!state ? (
          <span className="spinner" />
        ) : state.alert ? (
          <>
            <div style={{ fontSize: 44 }}>📬</div>
            <h2 style={{ fontWeight: 400, fontSize: 28, letterSpacing: '-0.02em', margin: '8px 0' }}>Email confirmed</h2>
            <p className="text-2" style={{ lineHeight: 1.5, margin: '0 auto 22px', maxWidth: 400 }}>
              Deals for {state.alert.email} will start arriving as soon as something cheap shows up.
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link to={`/alerts/${state.alert.token}`} className="btn btn-primary btn-sm">
                Manage this alert
              </Link>
              <Link to="/" className="btn btn-ghost btn-sm">
                See live deals
              </Link>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 44 }}>🤔</div>
            <h2 style={{ fontWeight: 400, fontSize: 26, margin: '8px 0' }}>That link didn’t work</h2>
            <p className="text-2" style={{ lineHeight: 1.5 }}>{state.error}</p>
            <Link to="/alerts" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
              My alerts
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
