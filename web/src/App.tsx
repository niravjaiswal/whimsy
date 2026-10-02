import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { api, useLiveStream, type Deal, type ScanEvent, type Stats } from './api';
import { Nav } from './components/Nav';
import { Sky } from './components/Sky';
import { AlertManage } from './pages/AlertManage';
import { AccountProvider } from './account';
import { Account } from './pages/Account';
import { AlertNew } from './pages/AlertNew';
import { SignIn } from './pages/SignIn';
import { ConfirmEmail } from './pages/ConfirmEmail';
import { DealPage } from './pages/DealPage';
import { Home } from './pages/Home';
import { MyAlerts } from './pages/MyAlerts';
import { Scanner } from './pages/Scanner';
import { money, pct } from './format';

type DealEvent = { kind: 'new' | 'dropped' | 'refreshed' | 'expired'; deal: Deal };

interface Live {
  stats: Stats | null;
  connected: boolean;
  scans: ScanEvent[];
  lastDealEvent: DealEvent | null;
}
const LiveContext = createContext<Live>({ stats: null, connected: false, scans: [], lastDealEvent: null });
export const useLive = () => useContext(LiveContext);

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function DealToast({ ev, onClose }: { ev: DealEvent; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [ev, onClose]);
  return (
    <div className="toast" role="status">
      <span className="live-dot" />
      <Link to={`/deal/${ev.deal.slug}`} onClick={onClose}>
        {ev.kind === 'dropped' ? 'Price drop' : 'New deal'}: {ev.deal.origin.city} → {ev.deal.destination.city}{' '}
        <b>{money(ev.deal.price)}</b> <span className="good">−{pct(ev.deal.discount)}</span>
      </Link>
      <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

export function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [scans, setScans] = useState<ScanEvent[]>([]);
  const [lastDealEvent, setLastDealEvent] = useState<DealEvent | null>(null);
  const [toast, setToast] = useState<DealEvent | null>(null);
  const loc = useLocation();
  const statsRef = useRef(stats);
  statsRef.current = stats;

  useEffect(() => {
    api<Stats>('/stats').then(setStats).catch(() => {});
  }, []);

  const connected = useLiveStream({
    stats: setStats,
    scan: (e) => {
      setScans((s) => [e, ...s].slice(0, 40));
      setStats((s) => (s ? { ...s, scansLastHour: s.scansLastHour + 1, totalScans: s.totalScans + (e.ok ? 1 : 0) } : s));
    },
    deal: (e) => {
      setLastDealEvent(e);
      if (e.kind === 'new' || e.kind === 'dropped') setToast(e);
      if (e.kind === 'new') setStats((s) => (s ? { ...s, activeDeals: s.activeDeals + 1, dealsToday: s.dealsToday + 1 } : s));
      if (e.kind === 'expired') setStats((s) => (s ? { ...s, activeDeals: Math.max(0, s.activeDeals - 1) } : s));
    },
  });

  const dim = loc.pathname !== '/';
  return (
    <AccountProvider>
    <LiveContext.Provider value={{ stats, connected, scans, lastDealEvent }}>
      <ScrollToTop />
      <Sky dim={dim} />
      <div className="shell">
        <Nav stats={stats} connected={connected} />
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/deal/:slug" element={<DealPage />} />
            <Route path="/alerts" element={<MyAlerts />} />
            <Route path="/alerts/new" element={<AlertNew />} />
            <Route path="/alerts/:token" element={<AlertManage />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/account" element={<Account />} />
            <Route path="/confirm/:token" element={<ConfirmEmail />} />
            <Route
              path="*"
              element={
                <div className="container empty">
                  <h3>This page flew away.</h3>
                  <p>
                    <Link to="/" className="linkish">
                      Back to the deals
                    </Link>
                  </p>
                </div>
              }
            />
          </Routes>
        </main>
        <footer className="footer">
          <div className="container">
            <span>Whimsy scans fares continuously and links out to book. Prices change fast — always confirm before you buy.</span>
            <span>
              <Link to="/scanner">How it works</Link> · <Link to="/alerts">Manage alerts</Link>
            </span>
          </div>
        </footer>
      </div>
      {toast && loc.pathname !== `/deal/${toast.deal.slug}` && <DealToast ev={toast} onClose={() => setToast(null)} />}
    </LiveContext.Provider>
    </AccountProvider>
  );
}
