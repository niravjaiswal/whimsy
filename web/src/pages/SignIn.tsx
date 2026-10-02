import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account';

/** Only same-site paths are valid post-sign-in destinations. */
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/account');

export function SignIn() {
  const account = useAccount();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const autoTried = useRef(false);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const verify = async (e: string, c: string) => {
    setBusy(true);
    setErr('');
    try {
      await account.verifyCode(e, c);
      nav(next, { replace: true });
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // One-tap link from the email: /signin#email=…&code=… (hash never reaches a server).
  useEffect(() => {
    if (autoTried.current || !account.ready || !account.enabled) return;
    const h = new URLSearchParams(window.location.hash.slice(1));
    const e = h.get('email');
    const c = h.get('code');
    if (e && c) {
      autoTried.current = true;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setEmail(e);
      setCode(c);
      setStep('code');
      void verify(e, c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.ready, account.enabled]);

  if (account.ready && account.session) return <Navigate to={next} replace />;

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      await account.sendCode(email.trim());
      setStep('code');
      setCooldown(30);
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 480, paddingBottom: 60 }}>
      <div className="panel" style={{ marginTop: 48, padding: 32 }}>
        {!account.ready ? (
          <div className="center">
            <span className="spinner" />
          </div>
        ) : !account.enabled ? (
          <div className="empty" style={{ padding: 10 }}>
            <h3>Accounts aren’t available right now</h3>
            <p>Alerts still work without one — your manage link is the key.</p>
          </div>
        ) : step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <h1 style={{ fontWeight: 400, fontSize: 30, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Sign in to Whimsy</h1>
            <p className="text-2" style={{ margin: '0 0 22px', lineHeight: 1.5 }}>
              Keep your alerts on every device, save deals, and set home airports. No password — we’ll email you a code.
            </p>
            <label className="muted" htmlFor="signin-email" style={{ fontSize: 13 }}>
              Email
            </label>
            <input
              id="signin-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginTop: 6 }}
            />
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : 'Email me a code'}
            </button>
            {err && <p className="error-msg">{err}</p>}
            <p className="muted" style={{ fontSize: 13, marginTop: 18, lineHeight: 1.5 }}>
              New here? Same thing — entering the code creates your account. You can also{' '}
              <Link to="/alerts/new" className="linkish" style={{ padding: 0 }}>
                set an alert without one
              </Link>
              .
            </p>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify(email.trim(), code);
            }}
          >
            <h1 style={{ fontWeight: 400, fontSize: 30, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Check your email</h1>
            <p className="text-2" style={{ margin: '0 0 22px', lineHeight: 1.5 }}>
              We sent an 8-digit code to <b style={{ fontWeight: 500, color: 'var(--text)' }}>{email}</b>. Enter it here, or tap the link in the email.
            </p>
            <input
              className="input code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-label="Sign-in code"
              placeholder="0000 0000"
              maxLength={9}
              value={code}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                setCode(digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits);
                if (digits.length === 8) void verify(email.trim(), digits);
              }}
            />
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} disabled={busy || code.replace(/\D/g, '').length !== 8}>
              {busy ? <span className="spinner" style={{ width: 18, height: 18 }} /> : 'Sign in'}
            </button>
            {err && <p className="error-msg">{err}</p>}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
              <button type="button" className="linkish" onClick={() => (setStep('email'), setCode(''), setErr(''))}>
                ← Different email
              </button>
              <button type="button" className="linkish" disabled={!!cooldown || busy} onClick={() => void send()}>
                {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
