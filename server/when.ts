/**
 * "When" filters shared by the deals feed and alerts: broad months, an exact
 * departure window, and a trip-length range. All parts are optional and AND-ed.
 */
export interface WhenFilter {
  months: string[]; // "YYYY-MM"
  departFrom: string | null; // YYYY-MM-DD inclusive
  departTo: string | null; // YYYY-MM-DD inclusive
  minNights: number | null;
  maxNights: number | null;
}

export class WhenError extends Error {}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isRealDate = (s: string) => ISO_DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Longest departure window we accept — beyond that, "months" is the right tool. */
export const MAX_WINDOW_DAYS = 120;
export const MAX_NIGHTS = 30;

export function normalizeWhen(input: Partial<Record<keyof WhenFilter, unknown>>, today = new Date()): WhenFilter {
  const months = [...new Set(((input.months as unknown[]) ?? []).map(String))];
  for (const m of months) if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new WhenError(`Bad month ${m}`);

  const date = (v: unknown, field: string) => {
    if (v == null || v === '') return null;
    const s = String(v);
    if (!isRealDate(s)) throw new WhenError(`${field} must be a date like 2026-11-10`);
    return s;
  };
  let departFrom = date(input.departFrom, 'Start date');
  let departTo = date(input.departTo, 'End date');
  if (departFrom && !departTo) departTo = departFrom;
  if (departTo && !departFrom) departFrom = departTo;
  if (departFrom && departTo) {
    if (departFrom > departTo) [departFrom, departTo] = [departTo, departFrom];
    const todayIso = today.toISOString().slice(0, 10);
    if (departTo < todayIso) throw new WhenError('That date range is in the past');
    const span = (Date.parse(departTo) - Date.parse(departFrom)) / 86400_000;
    if (span > MAX_WINDOW_DAYS) throw new WhenError(`Pick a window of ${MAX_WINDOW_DAYS} days or less — or use months instead`);
  }

  const nights = (v: unknown, field: string) => {
    if (v == null || v === '') return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > MAX_NIGHTS) throw new WhenError(`${field} must be between 1 and ${MAX_NIGHTS} nights`);
    return n;
  };
  let minNights = nights(input.minNights, 'Minimum trip length');
  let maxNights = nights(input.maxNights, 'Maximum trip length');
  if (minNights != null && maxNights != null && minNights > maxNights) [minNights, maxNights] = [maxNights, minNights];

  return { months, departFrom, departTo, minNights, maxNights };
}

export function tripNights(departDate: string, returnDate: string | null): number | null {
  if (!returnDate) return null;
  return Math.round((Date.parse(returnDate) - Date.parse(departDate)) / 86400_000);
}

export function matchesWhen(w: WhenFilter, deal: { depart_date: string; return_date: string | null }): boolean {
  if (w.months.length && !w.months.includes(deal.depart_date.slice(0, 7))) return false;
  if (w.departFrom && deal.depart_date < w.departFrom) return false;
  if (w.departTo && deal.depart_date > w.departTo) return false;
  if (w.minNights != null || w.maxNights != null) {
    const n = tripNights(deal.depart_date, deal.return_date);
    if (n == null) return false;
    if (w.minNights != null && n < w.minNights) return false;
    if (w.maxNights != null && n > w.maxNights) return false;
  }
  return true;
}

export const hasDateWindow = (w: Pick<WhenFilter, 'departFrom' | 'departTo'>) => !!(w.departFrom && w.departTo);
