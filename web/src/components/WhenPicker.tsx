import { useMemo, useState } from 'react';
import { dateRange, monthLabel } from '../format';
import { MonthChips } from './Pickers';

export interface When {
  months: string[];
  departFrom: string | null;
  departTo: string | null;
  minNights: number | null;
  maxNights: number | null;
}

export const ANY_WHEN: When = { months: [], departFrom: null, departTo: null, minNights: null, maxNights: null };

const DAY = 86400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));
const todayIso = () => iso(new Date());
/** Earliest departure we'll let people pick — the scanner needs a little runway. */
export const minPickable = () => addDays(todayIso(), 2);
export const maxPickable = () => addDays(todayIso(), 330);

// ── trip length ─────────────────────────────────────────────────────────────
export const LENGTHS: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: 'any', label: 'Any length', min: null, max: null },
  { id: 'weekend', label: 'Weekend · 2–4 nights', min: 2, max: 4 },
  { id: 'week', label: 'About a week · 5–9', min: 5, max: 9 },
  { id: 'long', label: 'Long trip · 10+', min: 10, max: null },
];

export function nightsLabel(min: number | null, max: number | null) {
  if (min == null && max == null) return '';
  if (min != null && max != null) return min === max ? `${min} nights` : `${min}–${max} nights`;
  return min != null ? `${min}+ nights` : `≤${max} nights`;
}

export function whenSummary(w: When): string {
  let base = 'Any time';
  if (w.departFrom && w.departTo) base = w.departFrom === w.departTo ? dateRange(w.departFrom, null) : dateRange(w.departFrom, w.departTo);
  else if (w.months.length) base = w.months.length <= 2 ? w.months.map((m) => monthLabel(m)).join(', ') : `${w.months.length} months`;
  const n = nightsLabel(w.minNights, w.maxNights);
  return n ? `${base} · ${n}` : base;
}

export const isAnyWhen = (w: When) =>
  !w.months.length && !w.departFrom && !w.departTo && w.minNights == null && w.maxNights == null;

// ── URL encoding: dep=2026-11-24..2026-11-28, nights=2-4 / 10- ─────────────
export function whenFromParams(p: URLSearchParams): When {
  const [departFrom, departTo] = (p.get('dep') ?? '').split('..');
  const [lo, hi] = (p.get('nights') ?? '').split('-');
  const n = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  return {
    months: p.get('when')?.split(',').filter(Boolean) ?? [],
    departFrom: ok(departFrom),
    // A half-picked range (start only) survives the URL round trip while choosing.
    departTo: ok(departFrom) ? ok(departTo) : null,
    minNights: n(lo),
    maxNights: n(hi),
  };
}

export function whenToParams(w: When, p: URLSearchParams) {
  const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
  set('when', w.months.join(',') || null);
  set('dep', w.departFrom ? `${w.departFrom}..${w.departTo ?? ''}` : null);
  set('nights', w.minNights != null || w.maxNights != null ? `${w.minNights ?? ''}-${w.maxNights ?? ''}` : null);
  return p;
}

// ── holiday presets ─────────────────────────────────────────────────────────
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = utc(year, month, 1).getUTCDay();
  return utc(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(year: number, month: number, weekday: number) {
  const last = utc(year, month + 1, 0);
  return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

export function holidayPresets(from = new Date()): { label: string; departFrom: string; departTo: string }[] {
  const out: { label: string; departFrom: string; departTo: string }[] = [];
  const min = minPickable();
  const max = maxPickable();
  for (const y of [from.getUTCFullYear(), from.getUTCFullYear() + 1]) {
    const thanks = iso(nthWeekday(y, 10, 4, 4));
    const mlk = iso(nthWeekday(y, 0, 1, 3));
    const pres = iso(nthWeekday(y, 1, 1, 3));
    const mem = iso(lastWeekday(y, 4, 1));
    const labor = iso(nthWeekday(y, 8, 1, 1));
    out.push(
      { label: 'MLK weekend', departFrom: addDays(mlk, -4), departTo: addDays(mlk, -2) },
      { label: 'Presidents’ Day', departFrom: addDays(pres, -4), departTo: addDays(pres, -2) },
      { label: 'Spring break', departFrom: `${y}-03-07`, departTo: `${y}-03-28` },
      { label: 'Memorial Day', departFrom: addDays(mem, -4), departTo: addDays(mem, -2) },
      { label: 'July 4th', departFrom: `${y}-06-30`, departTo: `${y}-07-04` },
      { label: 'Labor Day', departFrom: addDays(labor, -4), departTo: addDays(labor, -2) },
      { label: 'Thanksgiving', departFrom: addDays(thanks, -5), departTo: addDays(thanks, -1) },
      { label: 'Winter holidays', departFrom: `${y}-12-18`, departTo: `${y}-12-26` },
      { label: 'New Year’s', departFrom: `${y}-12-27`, departTo: `${y}-12-31` },
    );
  }
  return out
    .filter((h) => h.departTo >= min && h.departFrom <= max)
    .map((h) => ({ ...h, departFrom: h.departFrom < min ? min : h.departFrom }))
    .sort((a, b) => a.departFrom.localeCompare(b.departFrom))
    .slice(0, 7);
}

// ── range calendar ──────────────────────────────────────────────────────────
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthGrid({
  year,
  month,
  from,
  to,
  hover,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  from: string | null;
  to: string | null;
  hover: string | null;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
}) {
  const min = minPickable();
  const max = maxPickable();
  const first = utc(year, month, 1).getUTCDay();
  const days = utc(year, month + 1, 0).getUTCDate();
  // While choosing an end date, preview the range under the cursor.
  const end = to ?? (from && hover && hover > from ? hover : null);
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(utc(year, month, i + 1)))];
  return (
    <div className="cal-month">
      <div className="cal-title">{monthLabel(`${year}-${String(month + 1).padStart(2, '0')}`, true)}</div>
      <div className="cal-grid" role="grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="cal-dow">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const disabled = d < min || d > max;
          const isStart = d === from;
          const isEnd = d === end;
          const inRange = !!(from && end && d > from && d < end);
          return (
            <button
              type="button"
              key={d}
              disabled={disabled}
              className={`cal-day ${isStart ? 'start' : ''} ${isEnd ? 'end' : ''} ${inRange ? 'in' : ''} ${isStart && !end ? 'solo' : ''}`}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              aria-pressed={isStart || isEnd || inRange}
              aria-label={d}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RangeCalendar({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (from: string | null, to: string | null) => void;
}) {
  const start = new Date(`${from ?? minPickable()}T00:00:00Z`);
  const [cursor, setCursor] = useState({ y: start.getUTCFullYear(), m: start.getUTCMonth() });
  const [hover, setHover] = useState<string | null>(null);
  // Picking: first click sets start; second click (on/after start) sets end; a click
  // while a full range is selected starts over.
  const pick = (d: string) => {
    if (!from || (from && to)) return onChange(d, null);
    if (d < from) return onChange(d, null);
    onChange(from, d);
  };
  const next = utc(cursor.y, cursor.m + 1, 1);
  const minMonth = minPickable().slice(0, 7);
  const maxMonth = maxPickable().slice(0, 7);
  const curKey = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
  const nextKey = iso(next).slice(0, 7);
  const move = (delta: number) => {
    const d = utc(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  return (
    <div className="cal" onMouseLeave={() => setHover(null)}>
      <button type="button" className="icon-btn cal-nav prev" onClick={() => move(-1)} disabled={curKey <= minMonth} aria-label="Previous month">
        ‹
      </button>
      <button type="button" className="icon-btn cal-nav next" onClick={() => move(1)} disabled={nextKey >= maxMonth} aria-label="Next month">
        ›
      </button>
      <div className="cal-months">
        <MonthGrid year={cursor.y} month={cursor.m} from={from} to={to} hover={hover} onPick={pick} onHover={setHover} />
        <div className="cal-second">
          <MonthGrid year={next.getUTCFullYear()} month={next.getUTCMonth()} from={from} to={to} hover={hover} onPick={pick} onHover={setHover} />
        </div>
      </div>
    </div>
  );
}

// ── the picker ──────────────────────────────────────────────────────────────
export function WhenPicker({ value, onChange }: { value: When; onChange: (w: When) => void }) {
  const [tab, setTab] = useState<'months' | 'dates'>(value.departFrom ? 'dates' : 'months');
  const presets = useMemo(() => holidayPresets(), []);
  const lengthId =
    LENGTHS.find((l) => l.min === value.minNights && l.max === value.maxNights)?.id ?? (value.minNights == null && value.maxNights == null ? 'any' : null);
  const setDates = (departFrom: string | null, departTo: string | null) => onChange({ ...value, months: [], departFrom, departTo });

  return (
    <div className="when">
      <div className="seg when-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'months'} className={tab === 'months' ? 'on' : ''} onClick={() => setTab('months')}>
          Flexible months
        </button>
        <button type="button" role="tab" aria-selected={tab === 'dates'} className={tab === 'dates' ? 'on' : ''} onClick={() => setTab('dates')}>
          Specific dates
        </button>
      </div>

      {tab === 'months' ? (
        <div className="when-body">
          <MonthChips selected={value.months} onChange={(months) => onChange({ ...value, months, departFrom: null, departTo: null })} count={11} />
        </div>
      ) : (
        <div className="when-body">
          <div className="chips when-presets">
            {presets.map((h) => {
              const on = value.departFrom === h.departFrom && value.departTo === h.departTo;
              return (
                <button type="button" key={h.label + h.departFrom} className={`chip chip-sm ${on ? 'on' : ''}`} onClick={() => setDates(h.departFrom, h.departTo)}>
                  {h.label}
                </button>
              );
            })}
          </div>
          <RangeCalendar from={value.departFrom} to={value.departTo} onChange={setDates} />
          <div className="when-status">
            <span className="text-2">
              {value.departFrom && value.departTo
                ? `Leaving between ${dateRange(value.departFrom, value.departTo)}`
                : value.departFrom
                  ? 'Now pick the last day you could leave (or pick the same day)'
                  : 'Pick the first day you could leave'}
            </span>
            {value.departFrom && (
              <button type="button" className="linkish" onClick={() => setDates(null, null)}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="when-length">
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          Trip length
        </div>
        <div className="chips">
          {LENGTHS.map((l) => (
            <button
              type="button"
              key={l.id}
              className={`chip chip-sm ${lengthId === l.id ? 'on' : ''}`}
              onClick={() => onChange({ ...value, minNights: l.min, maxNights: l.max })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Query params for /api/deals and alert payloads — only complete ranges filter. */
export function whenQuery(w: When) {
  const complete = !!(w.departFrom && w.departTo);
  return {
    months: w.months,
    departFrom: complete ? w.departFrom : null,
    departTo: complete ? w.departTo : null,
    minNights: w.minNights,
    maxNights: w.maxNights,
  };
}
