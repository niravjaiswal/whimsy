import type { Region, Tier } from './api';

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const pct = (d: number) => `${Math.round(d * 100)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];

export function shortDate(iso: string) {
  const [y, m, d] = parts(iso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]}, ${MONTHS[m - 1]} ${d}`;
}

export function dateRange(depart: string, ret: string | null) {
  const [, m1, d1] = parts(depart);
  if (!ret) return `${MONTHS[m1 - 1]} ${d1}`;
  const [, m2, d2] = parts(ret);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

export function monthLabel(ym: string, long = false) {
  const [y, m] = ym.split('-').map(Number);
  return long ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}

export function nextMonths(n = 10, from = new Date()) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function duration(mins: number | null) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function time12(hhmm: string | null) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function ago(ts: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const stopsLabel = (s: number | null) => (s == null ? '' : s === 0 ? 'Nonstop' : `${s} stop${s > 1 ? 's' : ''}`);

export const TIER_LABEL: Record<Tier, string> = { good: 'Good deal', great: 'Great deal', incredible: 'Incredible' };

export const REGION_EMOJI: Record<Region, string> = {
  'north-america': '🏔',
  caribbean: '🏝',
  'latin-america': '🌮',
  europe: '🥐',
  asia: '🍜',
  oceania: '🐨',
  'middle-east': '🕌',
  africa: '🦁',
};

export const num = (n: number) => n.toLocaleString('en-US');
