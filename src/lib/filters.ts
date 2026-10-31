// Plain helpers the list filters share. No React here, so they can be tested.

/** Does the search text appear in any of these? Case-insensitive; digits match phone numbers however they are written. */
export function textMatch(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return fields.some((f) => {
    if (f === null || f === undefined) return false;
    const s = String(f).toLowerCase();
    return s.includes(q) || (digits.length >= 3 && s.replace(/\D/g, '').includes(digits));
  });
}

export const DAY = 86_400_000;

export type DateRange = 'any' | 'today' | 'yesterday' | '7d' | '30d';

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/** The [from, to) window of a named range, in local days. `to` is Infinity when open-ended. */
export function dateWindow(range: DateRange, now = Date.now()): { from: number; to: number } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t = today.getTime();
  switch (range) {
    case 'today': return { from: t, to: t + DAY };
    case 'yesterday': return { from: t - DAY, to: t };
    case '7d': return { from: t - 6 * DAY, to: Infinity };
    case '30d': return { from: t - 29 * DAY, to: Infinity };
    default: return { from: -Infinity, to: Infinity };
  }
}

export const inWindow = (ts: number, w: { from: number; to: number }): boolean => ts >= w.from && ts < w.to;
