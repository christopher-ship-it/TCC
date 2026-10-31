// The filter controls every list shares, so a filter looks and works the same everywhere. Filters live in the page's
// address (like the Follow-ups page always did): a filtered view can be bookmarked, sent to someone, and survives a reload.

import { useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Chip, Input, Select } from './primitives';

/** String filters kept in the address. A value equal to its default is left out of the address. */
export function useFilters<K extends string>(keys: readonly K[], defaults: Partial<Record<K, string>> = {}) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, params.get(k) ?? defaults[k] ?? ''])) as Record<K, string>;
  const set = useCallback(
    (k: K, v: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!v || v === (defaults[k] ?? '')) next.delete(k);
          else next.set(k, v);
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults are constants per page
    [setParams],
  );
  const reset = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const k of keys) next.delete(k);
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  );
  const active = keys.filter((k) => values[k] !== (defaults[k] ?? '')).length;
  return { values, set, reset, active };
}

/** The row of filters above a list, with how many are shown and a way to clear them. */
export function FilterBar({ children, active, onReset, shown, total, noun = 'results' }: { children: ReactNode; active: number; onReset: () => void; shown?: number; total?: number; noun?: string }) {
  return (
    <div className="row" role="search" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
      {active > 0 && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={onReset} aria-label="Clear all filters">
          <X size={14} aria-hidden /> Clear filters ({active})
        </button>
      )}
      {shown !== undefined && total !== undefined && (
        <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }} aria-live="polite">
          {shown === total ? `${total.toLocaleString('en-IN')} ${noun}` : `${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} ${noun}`}
        </span>
      )}
    </div>
  );
}

export function SearchFilter({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <Search size={14} aria-hidden style={{ position: 'absolute', left: 9, opacity: 0.55, pointerEvents: 'none' }} />
      <Input type="search" aria-label={label ?? placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingLeft: 28, width: 240 }} />
    </span>
  );
}

/** A dropdown whose first entry is "everything". `value` '' means no filter. */
export function SelectFilter({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; all?: string }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 'auto', maxWidth: 220 }}>
      <option value="">{all ?? `${label}: all`}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

/** A small set of mutually exclusive choices as chips; the first option is usually "Any". */
export function ChipFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <span className="row" role="group" aria-label={label} style={{ gap: 6 }}>
      {options.map((o) => <Chip key={o.value} pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</Chip>)}
    </span>
  );
}
