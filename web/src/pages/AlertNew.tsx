import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account';
import { api, rememberAlert, useMeta, type Alert, type Region } from '../api';
import { AlertForm, draftToPayload, type AlertDraft } from '../components/AlertForm';
import { whenFromParams } from '../components/WhenPicker';

export function AlertNew() {
  const meta = useMeta();
  const [params] = useSearchParams();
  const [created, setCreated] = useState<Alert | null>(null);
  const list = (k: string) => params.get(k)?.split(',').filter(Boolean) ?? [];

  const account = useAccount();
  const initial: AlertDraft = {
    name: '',
    email: account.session?.user.email ?? '',
    origins: list('from'),
    regions: list('to') as Region[],
    destinations: list('dest'),
    maxPrice: Number(params.get('max')) || null,
    minTier: 'good',
    ...whenFromParams(params),
    frequency: 'instant',
    // Signed in: your (already confirmed) email is the natural default channel.
    channels: { email: !!account.session?.user.email && !!meta?.emailEnabled, push: false, ntfy: '', webhook: '' },
  };

  if (created) return <Created alert={created} />;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <section className="hero" style={{ padding: '40px 0 28px' }}>
        <h1 style={{ fontSize: 'clamp(32px,4.6vw,50px)' }}>Tell us the vibe. We’ll watch the fares.</h1>
        <p className="lede">No route required. Set loose filters and we’ll ping you the moment something great lands.</p>
      </section>
      {meta && account.ready ? (
        <AlertForm
          meta={meta}
          initial={initial}
          submitLabel="Start watching"
          onSubmit={async (draft, pushSubscription) => {
            const { alert } = await api<{ alert: Alert }>('/alerts', {
              method: 'POST',
              json: { ...draftToPayload(draft), pushSubscription },
            });
            rememberAlert({ token: alert.token, name: alert.name ?? 'My alert' });
            setCreated(alert);
            window.scrollTo(0, 0);
          }}
        />
      ) : (
        <div className="skeleton" style={{ height: 600 }} />
      )}
    </div>
  );
}

function Created({ alert }: { alert: Alert }) {
  const signedIn = !!useAccount().session;
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<Record<string, string> | null>(null);
  const [testErr, setTestErr] = useState('');
  return (
    <div className="container" style={{ maxWidth: 640, paddingBottom: 60 }}>
      <div className="panel" style={{ marginTop: 40, textAlign: 'center', padding: 36 }}>
        <div style={{ fontSize: 44 }}>🛫</div>
        <h2 style={{ fontWeight: 400, fontSize: 30, letterSpacing: '-0.02em', margin: '8px 0 8px' }}>You’re on the list.</h2>
        {alert.email && alert.channels.email && !alert.emailVerified && (
          <p className="pill" style={{ margin: '0 auto 16px', display: 'inline-flex' }}>
            📬 Check {alert.email} and click the confirmation link to turn on email alerts
          </p>
        )}
        <p className="text-2" style={{ lineHeight: 1.5, margin: '0 auto 22px', maxWidth: 440 }}>
          We’re watching every route that matches. When a fare drops 40%+ below normal, you’ll hear about it
          {alert.frequency === 'daily' ? ' in your daily digest' : ' right away'}.
        </p>
        <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          {signedIn ? 'Saved to your account. Private manage link:' : 'Your private manage link — save it, it’s the only key'}
        </div>
        <div className="code-box">{alert.manageUrl}</div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigator.clipboard.writeText(alert.manageUrl).then(() => setCopied(true))}
          >
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              api<{ results: Record<string, string> }>(`/alerts/${alert.token}/test`, { method: 'POST' })
                .then((r) => (setTest(r.results), setTestErr('')))
                .catch((e) => setTestErr(e.message))
            }
          >
            Send a test
          </button>
          <Link to={`/alerts/${alert.token}`} className="btn btn-primary btn-sm">
            Manage alert
          </Link>
        </div>
        {test && (
          <div style={{ marginTop: 14, fontSize: 14 }}>
            {Object.entries(test).map(([k, v]) => (
              <div key={k} className={v === 'ok' ? 'ok-msg' : 'error-msg'}>
                {k}: {v === 'ok' ? 'sent ✓' : v}
              </div>
            ))}
          </div>
        )}
        {testErr && <p className="error-msg">{testErr}</p>}
      </div>
    </div>
  );
}
