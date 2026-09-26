import { AIRPORT_BY_CODE } from './airports.js';
import type { DealRow } from './deals.js';

export const cityOf = (code: string) => AIRPORT_BY_CODE.get(code)?.city ?? code;

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateRange(depart: string, ret: string | null): string {
  const [, m1, d1] = depart.split('-').map(Number);
  if (!ret) return `${MONTHS[m1 - 1]} ${d1}`;
  const [, m2, d2] = ret.split('-').map(Number);
  return m1 === m2 ? `${MONTHS[m1 - 1]} ${d1}–${d2}` : `${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

export const pct = (d: number) => `${Math.round(d * 100)}%`;

export const TIER_LABEL = { good: 'Good deal', great: 'Great deal', incredible: 'Incredible deal' } as const;

export function dealHeadline(d: DealRow): string {
  return `${cityOf(d.origin)} → ${cityOf(d.destination)} ${money(d.price)} round-trip`;
}

export function dealLine(d: DealRow): string {
  const stops = d.stops === 0 ? 'nonstop' : `${d.stops} stop${d.stops === 1 ? '' : 's'}`;
  return `${dateRange(d.depart_date, d.return_date)} · ${pct(d.discount)} below typical ${money(d.baseline)} · ${d.airline ?? 'Various'} · ${stops}`;
}
