import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, forgetAlert, rememberAlert, useApi, useMeta, type Alert, type Deal } from '../api';
import { AlertForm, draftFromAlert, draftToPayload } from '../components/AlertForm';
import { ago } from '../format';

interface AlertResp {
  alert: Alert;
  matches: Deal[];
  deliveries: { channel: string; deal_count: number; ok: number; error: string | null; created_at: number }[];
  pushDevices: number;
}

export function AlertManage() {
  const { token } = useParams();
  const meta = useMeta();
  const navigate = useNavigate();
  const { data, error, refetch, setData } = useApi<AlertResp>(`/alerts/${token}`);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<Record<string, string> | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (data?.alert) rememberAlert({ token: data.alert.token, name: data.alert.name ?? 'My alert' });
  }, [data?.alert]);

  if (error)
    return (
      <div className="container">
        <div className="panel-glass empty" style={{ marginTop: 40 }}>
          <h3>We couldn’t find that alert</h3>
          <p>It may have been deleted. Lost your link? Recover it by email from My alerts.</p>
          <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
            <Link to="/alerts" className="btn btn-ghost btn-sm">
              My alerts
            </Link>
            <Link to="/alerts/new" className="btn btn-primary btn-sm">
              New alert
            </Link>
          </div>
        </div>
      </div>
    );
  if (!data || !meta) return <div className="container"><div className="skeleton" style={{ height: 600, marginTop: 30 }} /></div>;

  const { alert } = data;
  const patch = async (body: object) => {
    const r = await api<{ alert: Alert }>(`/alerts/${token}`, { method: 'PATCH', json: body });
    setData({ ...data, alert: r.alert });
    return r.alert;
  };

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <section style={{ padding: '32px 0 22px' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>
              Created {ago(alert.createdAt)}
              {alert.lastNotifiedAt ? ` · last pinged ${ago(alert.lastNotifiedAt)}` : ' · no pings yet'}
            </div>
            <h1 style={{ fontWeight: 400, letterSpacing: '-0.03em', fontSize: 38, margin: '4px 0 0' }}>{alert.name ?? 'Your deal alert'}</h1>
          </div>
          <div className="row">
            <button className={`pill ${alert.paused ? '' : 'on'}`} onClick={() => patch({ paused: !alert.paused })}>
              <span className={`live-dot ${alert.paused ? 'off' : ''}`} /> {alert.paused ? 'Paused — resume' : 'Watching'}
            </button>
            <button
              className="pill"
              onClick={() =>
                api<{ results: Record<string, string> }>(`/alerts/${token}/test`, { method: 'POST' })
                  .then((r) => (setTest(r.results), setMsg('')))
                  .catch((e) => setMsg(e.message))
              }
            >
              Send test
            </button>
          </div>
        </div>
        {test && (
          <div className="row" style={{ marginTop: 10, fontSize: 14 }}>
            {Object.entries(test).map(([k, v]) => (
              <span key={k} className={v === 'ok' ? 'ok-msg' : 'error-msg'} style={{ margin: 0 }}>
                {k}: {v === 'ok' ? 'sent ✓' : v}
              </span>
            ))}
          </div>
        )}
        {msg && <p className="error-msg">{msg}</p>}
      </section>

      <AlertForm
        key={alert.token}
        meta={meta}
        initial={draftFromAlert(alert)}
        submitLabel={saved ? 'Saved ✓' : 'Save changes'}
        pushRegistered={data.pushDevices}
        onPushSubscribed={async (subscription) => {
          await api(`/alerts/${token}/push`, { method: 'POST', json: { subscription } });
          refetch();
        }}
        onSubmit={async (draft) => {
          await patch(draftToPayload(draft));
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
        footer={
          <>
            <div className="panel">
              <div style={{ fontSize: 15, marginBottom: 8 }}>Recent notifications</div>
              {data.deliveries.length ? (
                <div className="log">
                  {data.deliveries.slice(0, 8).map((d, i) => (
                    <div key={i} className="log-row" style={{ gridTemplateColumns: '80px 1fr auto' }}>
                      <span className="text-2">{d.channel}</span>
                      <span className={d.ok ? 'under' : 'fail'} title={d.error ?? ''}>
                        {d.ok ? `${d.deal_count} deal${d.deal_count > 1 ? 's' : ''}` : `failed: ${d.error}`}
                      </span>
                      <span className="muted">{ago(d.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                  Nothing sent yet. We only ping when something genuinely good shows up.
                </p>
              )}
            </div>
            <div className="panel">
              <div style={{ fontSize: 15, marginBottom: 6 }}>Manage link</div>
              <div className="code-box">{alert.manageUrl}</div>
              <button
                className="btn btn-danger btn-sm"
                style={{ marginTop: 14 }}
                onClick={async () => {
                  if (!confirm('Delete this alert? This cannot be undone.')) return;
                  await api(`/alerts/${token}`, { method: 'DELETE' });
                  forgetAlert(alert.token);
                  navigate('/alerts');
                }}
              >
                Delete alert
              </button>
            </div>
          </>
        }
      />
    </div>
  );
}
