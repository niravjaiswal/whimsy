import { useEffect, useMemo, useState } from 'react';
import { api, pushSupported, subscribePush, type Alert, type Deal, type Meta, type Region, type Tier } from '../api';
import { REGION_EMOJI, money } from '../format';
import { MiniDeal } from './DealCard';
import { AirportList, useClickOutside } from './Pickers';
import { WhenPicker, whenQuery } from './WhenPicker';

export interface AlertDraft {
  name: string;
  email: string;
  origins: string[];
  regions: Region[];
  destinations: string[];
  maxPrice: number | null;
  minTier: Tier;
  months: string[];
  departFrom: string | null;
  departTo: string | null;
  minNights: number | null;
  maxNights: number | null;
  frequency: 'instant' | 'daily';
  channels: { email: boolean; push: boolean; ntfy: string; webhook: string };
}

export function draftFromAlert(a: Alert): AlertDraft {
  return {
    name: a.name ?? '',
    email: a.email ?? '',
    origins: a.origins,
    regions: a.regions,
    destinations: a.destinations,
    maxPrice: a.maxPrice,
    minTier: a.minTier,
    months: a.months,
    departFrom: a.departFrom,
    departTo: a.departTo,
    minNights: a.minNights,
    maxNights: a.maxNights,
    frequency: a.frequency,
    channels: { email: !!a.channels.email, push: !!a.channels.push, ntfy: a.channels.ntfy ?? '', webhook: a.channels.webhook ?? '' },
  };
}

export function draftToPayload(d: AlertDraft) {
  return {
    name: d.name || null,
    email: d.email || null,
    origins: d.origins,
    regions: d.regions,
    destinations: d.destinations,
    maxPrice: d.maxPrice,
    minTier: d.minTier,
    ...whenQuery(d),
    frequency: d.frequency,
    channels: {
      email: d.channels.email || undefined,
      push: d.channels.push || undefined,
      ntfy: d.channels.ntfy.trim() || undefined,
      webhook: d.channels.webhook.trim() || undefined,
    },
  };
}

const TIERS: { id: Tier; label: string; hint: string }[] = [
  { id: 'good', label: 'Good', hint: '20%+ off' },
  { id: 'great', label: 'Great', hint: '35%+ off' },
  { id: 'incredible', label: 'Incredible', hint: '50%+ off' },
];

function CityPicker({ meta, selected, onChange }: { meta: Meta; selected: string[]; onChange: (c: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className="chip" onClick={() => setOpen((o) => !o)}>
        + Specific cities
      </button>
      {open && (
        <div className="popover">
          <AirportList airports={meta.airports} selected={selected} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export function AlertForm({
  meta,
  initial,
  submitLabel,
  onSubmit,
  pushRegistered = 0,
  onPushSubscribed,
  footer,
}: {
  meta: Meta;
  initial: AlertDraft;
  submitLabel: string;
  onSubmit: (draft: AlertDraft, pushSubscription: PushSubscriptionJSON | null) => Promise<void>;
  pushRegistered?: number;
  onPushSubscribed?: (sub: PushSubscriptionJSON) => Promise<void>;
  footer?: React.ReactNode;
}) {
  const [d, setD] = useState<AlertDraft>(initial);
  const [pushSub, setPushSub] = useState<PushSubscriptionJSON | null>(null);
  const [pushState, setPushState] = useState<'idle' | 'asking' | 'error'>('idle');
  const [pushErr, setPushErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<{ count: number; deals: Deal[] } | null>(null);
  const up = (patch: Partial<AlertDraft>) => setD((x) => ({ ...x, ...patch }));
  const ch = (patch: Partial<AlertDraft['channels']>) => setD((x) => ({ ...x, channels: { ...x.channels, ...patch } }));

  // Live preview of what this alert would match right now.
  const previewKey = JSON.stringify([d.origins, d.regions, d.destinations, d.maxPrice, d.minTier, whenQuery(d)]);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ count: number; deals: Deal[] }>('/alerts/preview', {
        method: 'POST',
        json: { origins: d.origins, regions: d.regions, destinations: d.destinations, maxPrice: d.maxPrice, minTier: d.minTier, ...whenQuery(d) },
      })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const enablePush = async () => {
    setPushState('asking');
    setPushErr('');
    try {
      const sub = await subscribePush(meta.vapidPublicKey);
      setPushSub(sub);
      ch({ push: true });
      if (onPushSubscribed) await onPushSubscribed(sub);
      setPushState('idle');
    } catch (e) {
      setPushState('error');
      setPushErr((e as Error).message);
      ch({ push: false });
    }
  };

  const hubs = useMemo(() => meta.airports.filter((a) => a.hub), [meta]);
  const cityName = (c: string) => meta.airports.find((a) => a.code === c)?.city ?? c;
  const anyChannel = d.channels.push || d.channels.email || d.channels.ntfy.trim() || d.channels.webhook.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!anyChannel) return setErr('Pick at least one way to be notified.');
    if (d.departFrom && !d.departTo) return setErr('Pick the last day you could leave to finish your date range.');
    setBusy(true);
    try {
      await onSubmit(d, pushSub);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <div className="panel" style={{ padding: '6px 22px' }}>
        <div className="field">
          <span className="label">Where are you flying from?</span>
          <div className="hint">Pick every airport you’d happily leave from. Leave empty for all of them.</div>
          <div className="chips">
            {d.origins.map((c) => (
              <button type="button" key={c} className="chip on" onClick={() => up({ origins: d.origins.filter((x) => x !== c) })}>
                {cityName(c)} <span className="x">×</span>
              </button>
            ))}
            <OriginAdd hubs={hubs} selected={d.origins} onChange={(o) => up({ origins: o })} empty={!d.origins.length} />
          </div>
        </div>

        <div className="field">
          <span className="label">Where to?</span>
          <div className="hint">The fun part: leave it wide open, or pick regions and cities that make you smile.</div>
          <div className="chips">
            <button type="button" className={`chip ${!d.regions.length && !d.destinations.length ? 'on' : ''}`} onClick={() => up({ regions: [], destinations: [] })}>
              🌍 Anywhere
            </button>
            {meta.regions.map((r) => {
              const on = d.regions.includes(r.id);
              return (
                <button type="button" key={r.id} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ regions: on ? d.regions.filter((x) => x !== r.id) : [...d.regions, r.id] })}>
                  {REGION_EMOJI[r.id]} {r.label}
                </button>
              );
            })}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {d.destinations.map((c) => (
              <button type="button" key={c} className="chip on" onClick={() => up({ destinations: d.destinations.filter((x) => x !== c) })}>
                {cityName(c)} <span className="x">×</span>
              </button>
            ))}
            <CityPicker meta={meta} selected={d.destinations} onChange={(c) => up({ destinations: c })} />
          </div>
        </div>

        <div className="field">
          <span className="label">When?</span>
          <div className="hint">Keep it loose with whole months, or lock in the exact week you can get away.</div>
          <WhenPicker value={d} onChange={(w) => up(w)} />
        </div>

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label" style={{ margin: 0 }}>
              Max round-trip price
            </span>
            <span>{d.maxPrice ? money(d.maxPrice) : 'No limit'}</span>
          </div>
          <input
            className="range-input"
            type="range"
            min={50}
            max={1550}
            step={50}
            value={d.maxPrice ?? 1550}
            onChange={(e) => up({ maxPrice: Number(e.target.value) >= 1550 ? null : Number(e.target.value) })}
            aria-label="Max price"
            style={{ marginTop: 12 }}
          />
        </div>

        <div className="field">
          <span className="label">How good does the deal need to be?</span>
          <div className="seg" style={{ marginTop: 8 }}>
            {TIERS.map((t) => (
              <button type="button" key={t.id} className={d.minTier === t.id ? 'on' : ''} onClick={() => up({ minTier: t.id })}>
                {t.label} <span className="muted" style={{ fontSize: 12 }}>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">How should we tell you?</span>
          <div className="hint">Pick as many as you like.</div>

          <div className={`channel ${d.channels.push ? 'on' : ''}`}>
            <div className="ic">🔔</div>
            <div className="body">
              <div className="title">
                <span>Browser push</span>
                {d.channels.push ? (
                  <button type="button" className="linkish" onClick={() => ch({ push: false })}>
                    Turn off
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!pushSupported() || pushState === 'asking'} onClick={enablePush}>
                    {pushState === 'asking' ? 'Waiting…' : 'Enable'}
                  </button>
                )}
              </div>
              <p className="desc">
                {!pushSupported()
                  ? 'Not supported in this browser. On iPhone, add Whimsy to your Home Screen first.'
                  : d.channels.push
                    ? pushSub || pushRegistered
                      ? `On${pushRegistered ? ` · ${pushRegistered} device${pushRegistered > 1 ? 's' : ''}` : ' for this browser'}.`
                      : 'On — click Enable on each device you want alerts on.'
                    : 'Instant notifications on this device, even when the tab is closed.'}
              </p>
              {pushState === 'error' && <p className="error-msg">{pushErr}</p>}
            </div>
          </div>

          {meta.emailEnabled && (
          <div className={`channel ${d.channels.email ? 'on' : ''}`}>
            <div className="ic">✉️</div>
            <div className="body">
              <div className="title">
                <span>Email</span>
                <span className={`toggle ${d.channels.email ? 'on' : ''}`} role="switch" aria-checked={d.channels.email} tabIndex={0} onClick={() => ch({ email: !d.channels.email })} onKeyDown={(e) => e.key === ' ' && ch({ email: !d.channels.email })} />
              </div>
              <p className="desc">A clean email with the fare, dates and a booking link. Also how you recover your alerts later.</p>
              <input className="input" type="email" placeholder="you@example.com" value={d.email} onChange={(e) => (up({ email: e.target.value }), e.target.value && !d.channels.email && ch({ email: true }))} />
            </div>
          </div>
          )}

          <div className={`channel ${d.channels.ntfy ? 'on' : ''}`}>
            <div className="ic">📱</div>
            <div className="body">
              <div className="title">
                <span>Phone push via ntfy</span>
                {!d.channels.ntfy && (
                  <button type="button" className="linkish" onClick={() => ch({ ntfy: `whimsy-${Math.random().toString(36).slice(2, 10)}` })}>
                    Generate topic
                  </button>
                )}
              </div>
              <p className="desc">
                Free, no account: install the{' '}
                <a href="https://ntfy.sh" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                  ntfy app
                </a>{' '}
                and subscribe to this topic. Keep it secret-ish — anyone with the name can read it.
              </p>
              <input className="input" placeholder="e.g. whimsy-3kf9x2a" value={d.channels.ntfy} onChange={(e) => ch({ ntfy: e.target.value })} />
            </div>
          </div>

          <div className={`channel ${d.channels.webhook ? 'on' : ''}`}>
            <div className="ic">🪝</div>
            <div className="body">
              <div className="title">
                <span>Discord, Slack or webhook</span>
              </div>
              <p className="desc">Paste a Discord or Slack incoming-webhook URL — great for a group chat of travel buddies.</p>
              <input className="input" placeholder="https://discord.com/api/webhooks/…" value={d.channels.webhook} onChange={(e) => ch({ webhook: e.target.value })} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 6 }}>
            <span className="text-2" style={{ fontSize: 14 }}>
              Frequency
            </span>
            <div className="seg">
              <button type="button" className={d.frequency === 'instant' ? 'on' : ''} onClick={() => up({ frequency: 'instant' })}>
                Instant
              </button>
              <button type="button" className={d.frequency === 'daily' ? 'on' : ''} onClick={() => up({ frequency: 'daily' })}>
                Daily digest
              </button>
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="alert-name">Name this alert (optional)</label>
          <input id="alert-name" className="input" placeholder="e.g. Winter escape from Detroit" value={d.name} onChange={(e) => up({ name: e.target.value })} maxLength={80} style={{ marginTop: 8 }} />
        </div>
      </div>

      <div className="sticky" style={{ display: 'grid', gap: 12 }}>
        <div className="panel">
          <div className="muted" style={{ fontSize: 13 }}>
            Right now this alert would match
          </div>
          <div style={{ fontSize: 40, letterSpacing: '-0.03em', margin: '2px 0 6px' }}>
            {preview ? preview.count : '—'} <span style={{ fontSize: 17 }} className="text-2">live deal{preview?.count === 1 ? '' : 's'}</span>
          </div>
          {preview && preview.deals.length > 0 ? (
            <div style={{ margin: '0 -10px' }}>
              {preview.deals.slice(0, 4).map((x) => (
                <MiniDeal key={x.id} deal={x} />
              ))}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
              Nothing live at the moment for these filters — that’s normal. Great deals pop up and vanish within hours; that’s why alerts exist.
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 16 }}>
            {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : submitLabel}
          </button>
          {err && <p className="error-msg">{err}</p>}
        </div>
        {footer}
      </div>
    </form>
  );
}

function OriginAdd({ hubs, selected, onChange, empty }: { hubs: Meta['airports']; selected: string[]; onChange: (c: string[]) => void; empty: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={`chip ${empty ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>
        {empty ? '✈ Any airport' : '+ Add airport'}
      </button>
      {open && (
        <div className="popover">
          <AirportList airports={hubs} selected={selected} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
