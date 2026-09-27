import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Airport, Region } from '../api';
import { REGION_EMOJI, monthLabel, nextMonths } from '../format';

export function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** A search-bar field that opens a popover. */
export function Field({
  label,
  value,
  placeholder,
  children,
  align,
  wide,
  style,
}: {
  label: string;
  value: string;
  placeholder?: boolean;
  children: (close: () => void) => ReactNode;
  align?: 'right';
  wide?: boolean;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useClickOutside(open, close);
  return (
    <div className="sb-field" data-open={open} ref={ref} style={style}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
      >
        <span className="sb-label">{label}</span>
        <span className={`sb-value ${placeholder ? 'placeholder' : ''}`}>{value}</span>
      </button>
      {open && <div className={`popover ${align === 'right' ? 'popover-right' : ''} ${wide ? 'popover-wide' : ''}`}>{children(close)}</div>}
    </div>
  );
}

export function AirportList({
  airports,
  selected,
  onChange,
  hubsOnly,
  single,
}: {
  airports: Airport[];
  selected: string[];
  onChange: (codes: string[]) => void;
  hubsOnly?: boolean;
  single?: boolean;
}) {
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const list = useMemo(() => {
    const base = airports.filter((a) => (hubsOnly ? a.hub : true));
    const s = q.trim().toLowerCase();
    const matched = s
      ? base.filter((a) => a.code.toLowerCase().startsWith(s) || a.city.toLowerCase().includes(s) || a.country.toLowerCase() === s)
      : base;
    return [...matched].sort((a, b) => {
      const sa = selected.includes(a.code) ? 0 : 1;
      const sb = selected.includes(b.code) ? 0 : 1;
      return sa - sb || a.city.localeCompare(b.city);
    });
  }, [airports, q, hubsOnly, selected]);
  const toggle = (code: string) => {
    if (single) return onChange([code]);
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };
  return (
    <>
      <input
        className="pop-search"
        autoFocus
        placeholder="Search city or airport code"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHl(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, list.length - 1));
          else if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && list[hl]) {
            e.preventDefault();
            toggle(list[hl].code);
            setQ('');
          }
        }}
      />
      <div className="pop-list" role="listbox" aria-multiselectable={!single}>
        {list.map((a, i) => {
          const sel = selected.includes(a.code);
          return (
            <button
              type="button"
              key={a.code}
              role="option"
              aria-selected={sel}
              className={`pop-item ${sel ? 'sel' : ''} ${i === hl ? 'hl' : ''}`}
              onClick={() => toggle(a.code)}
              onMouseEnter={() => setHl(i)}
            >
              {!single && <span className="check">{sel ? '✓' : ''}</span>}
              <span>{a.city}</span>
              <span className="code">{a.code}</span>
            </button>
          );
        })}
        {!list.length && <div className="muted" style={{ padding: 10, fontSize: 14 }}>No airports match “{q}”.</div>}
      </div>
    </>
  );
}

export function RegionList({
  regions,
  selected,
  onChange,
}: {
  regions: { id: Region; label: string }[];
  selected: Region[];
  onChange: (r: Region[]) => void;
}) {
  return (
    <div className="pop-list">
      <button type="button" className={`pop-item ${!selected.length ? 'sel' : ''}`} onClick={() => onChange([])}>
        <span className="check">{!selected.length ? '✓' : ''}</span>
        <span>🌍 Anywhere</span>
      </button>
      {regions.map((r) => {
        const sel = selected.includes(r.id);
        return (
          <button
            type="button"
            key={r.id}
            className={`pop-item ${sel ? 'sel' : ''}`}
            onClick={() => onChange(sel ? selected.filter((x) => x !== r.id) : [...selected, r.id])}
          >
            <span className="check">{sel ? '✓' : ''}</span>
            <span>
              {REGION_EMOJI[r.id]} {r.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function MonthChips({ selected, onChange, count = 10 }: { selected: string[]; onChange: (m: string[]) => void; count?: number }) {
  const months = nextMonths(count);
  return (
    <div className="chips">
      <button type="button" className={`chip ${!selected.length ? 'on' : ''}`} onClick={() => onChange([])}>
        Any time
      </button>
      {months.map((m, i) => {
        const on = selected.includes(m);
        const showYear = i === 0 || m.endsWith('-01');
        return (
          <button type="button" key={m} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? selected.filter((x) => x !== m) : [...selected, m])}>
            {monthLabel(m, showYear)}
          </button>
        );
      })}
    </div>
  );
}

export function summarize(codes: string[], airports: Airport[] | undefined, empty: string) {
  if (!codes.length) return empty;
  const names = codes.map((c) => airports?.find((a) => a.code === c)?.city ?? c);
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
}
