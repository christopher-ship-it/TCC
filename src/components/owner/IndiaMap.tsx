// India, state by state, coloured by how many customers each has. Hover (or focus) a state for its numbers; click it to
// pick it. The outlines ship with the app (@svg-maps/india, CC BY 4.0), so the map works offline.
//
// "By state": the more customers, the deeper the colour. "By language": each state takes the colour of the language
// most of its customers are called in, deeper for more customers.

import { useMemo, useState } from 'react';
import india from '@svg-maps/india';
import type { Language } from '../../data/types';
import { LANGUAGE_COLOR, dominantLanguage, type StateStat } from '../../lib/geo';

export type MapMode = 'customers' | 'language';

interface Loc { id: string; name: string; path: string }
const LOCATIONS = (india as unknown as { locations: Loc[]; viewBox: string }).locations;
const VIEWBOX = (india as unknown as { viewBox: string }).viewBox;

const EMPTY = 'var(--surface-3)';

/** Deeper colour for more customers: square-root scale so a few large states don't wash out the rest. */
const shade = (color: string, n: number, max: number) => (n <= 0 ? EMPTY : `color-mix(in srgb, ${color} ${Math.round(22 + Math.sqrt(n / max) * 78)}%, var(--surface-2, #fff))`);

export default function IndiaMap({ stats, mode, selected, onSelect, agentsFor, legend }: { stats: Map<string, StateStat>; mode: MapMode; selected: string | null; onSelect: (state: string | null) => void; agentsFor?: (state: string) => number; legend?: { label: string; color: string; value: number }[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; name: string } | null>(null);
  const max = useMemo(() => Math.max(1, ...[...stats.values()].map((s) => s.customers)), [stats]);
  const nf = (n: number) => n.toLocaleString('en-IN');

  const move = (e: React.MouseEvent | React.FocusEvent, name: string) => {
    const box = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    if ('clientX' in e) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, name });
    else {
      const b = (e.currentTarget as SVGElement).getBoundingClientRect();
      setTip({ x: b.left - box.left + b.width / 2, y: b.top - box.top, name });
    }
  };
  const t = tip ? stats.get(tip.name) : undefined;

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={VIEWBOX} style={{ width: '100%', height: 'auto', maxHeight: 640, display: 'block' }} role="group" aria-label="Map of India, coloured by customers in each state">
        {LOCATIONS.map((l) => {
          const s = stats.get(l.name);
          const n = s?.customers ?? 0;
          const fill = !s ? EMPTY : mode === 'language' ? shade(LANGUAGE_COLOR[dominantLanguage(s)], n, max) : shade('var(--series-1)', n, max);
          const isSel = selected === l.name;
          return (
            <path
              key={l.id}
              d={l.path}
              fill={fill}
              stroke={isSel ? 'var(--ink, #111)' : 'var(--surface, #fff)'}
              strokeWidth={isSel ? 2 : 0.8}
              strokeLinejoin="round"
              tabIndex={0}
              role="button"
              aria-pressed={isSel}
              aria-label={`${l.name}: ${nf(n)} customer${n === 1 ? '' : 's'}`}
              style={{ cursor: 'pointer', outline: 'none', transition: 'filter 120ms' }}
              onMouseMove={(e) => move(e, l.name)}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => move(e, l.name)}
              onBlur={() => setTip(null)}
              onClick={() => onSelect(isSel ? null : l.name)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(isSel ? null : l.name))}
              onMouseEnter={(e) => ((e.currentTarget as SVGPathElement).style.filter = 'brightness(0.92)')}
              onMouseOut={(e) => ((e.currentTarget as SVGPathElement).style.filter = '')}
            />
          );
        })}
      </svg>

      {tip && (
        <div role="status" style={{ position: 'absolute', left: Math.min(tip.x + 14, 360), top: Math.max(0, tip.y - 8), pointerEvents: 'none', background: 'var(--navy, #14213d)', color: '#fff', padding: '8px 11px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'nowrap', boxShadow: '0 6px 20px rgba(0,0,0,.25)', zIndex: 2 }}>
          <b>{tip.name}</b>
          <div>{t ? `${nf(t.customers)} customer${t.customers === 1 ? '' : 's'}` : 'No customers'}</div>
          {t && (
            <>
              <div style={{ opacity: 0.85 }}>{nf(t.active)} active · {nf(t.paying)} paying</div>
              <div style={{ opacity: 0.85 }}>
                {(Object.entries(t.byLanguage) as [Language, number][]).sort((a, b) => b[1] - a[1]).map(([l, c]) => `${l} ${nf(c)}`).join(' · ')}
              </div>
            </>
          )}
          {agentsFor && <div style={{ opacity: 0.85 }}>{agentsFor(tip.name)} agent{agentsFor(tip.name) === 1 ? '' : 's'} speak {t ? dominantLanguage(t) : 'its language'}</div>}
        </div>
      )}

      {mode === 'customers' ? (
        <div className="row" style={{ gap: 10, fontSize: 12.5, marginTop: 10, alignItems: 'center' }} aria-label="Colour scale">
          <span className="muted">Fewer</span>
          <span aria-hidden style={{ flex: '0 1 200px', height: 10, borderRadius: 5, background: `linear-gradient(to right, ${shade('var(--series-1)', 1, max * 400)}, ${shade('var(--series-1)', max, max)})` }} />
          <span className="muted">More · most is {nf(max)}</span>
        </div>
      ) : (
        <div className="row" style={{ gap: 14, fontSize: 12.5, marginTop: 10, flexWrap: 'wrap' }} role="list" aria-label="Languages">
          {(legend ?? []).map((l) => (
            <span key={l.label} role="listitem" className="row" style={{ gap: 6 }}>
              <span aria-hidden style={{ width: 11, height: 11, borderRadius: 3, background: l.color }} />
              {l.label} <span className="muted">{nf(l.value)}</span>
            </span>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Outlines: @svg-maps/india (CC BY 4.0). Ladakh is drawn with Jammu and Kashmir.</p>
    </div>
  );
}
