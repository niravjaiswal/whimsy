import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import type { Stats } from '../api';
import { num } from '../format';

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 17.5 27 7.5 20.5 26 15.8 19.6Z" fill="#fff" />
      <path d="M15.8 19.6 27 7.5 13.2 17.9Z" fill="rgba(255,255,255,.55)" />
      <path d="M3 24c3.5-1 5.5-.3 7.2.8" stroke="rgba(255,255,255,.7)" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.5 2.6" fill="none" />
    </svg>
  );
}

export function Nav({ stats, connected }: { stats: Stats | null; connected: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const running = !!stats?.scanner.running && connected;
  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="container nav-inner">
        <Link to="/" className="brand" aria-label="Whimsy home">
          <Logo />
          <span>Whimsy</span>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <NavLink to="/" end className="nav-link hide-sm">
            Deals
          </NavLink>
          <NavLink to="/scanner" className="nav-link">
            <span className="row" style={{ gap: 8 }}>
              <span className={`live-dot ${running ? '' : 'off'}`} />
              <span className="hide-sm-text">{stats ? `${num(stats.routes)} routes` : 'Scanner'}</span>
            </span>
          </NavLink>
          <NavLink to="/alerts" end className="nav-link hide-sm">
            My alerts
          </NavLink>
        </nav>
        <Link to="/alerts/new" className="btn btn-primary btn-sm">
          Get alerts
        </Link>
      </div>
    </header>
  );
}
