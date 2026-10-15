// Small SVG charts for TCC's analytics. No chart library: each chart measures its own width so text never scales,
// draws thin marks on a hairline grid, and has a hover tooltip. Series colours are validated for colour-blind
// separation (agent = --series-1, customer / second series = --series-2); text always uses ink tokens.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const AXIS = 'var(--muted)';
const GRID = 'var(--line-soft)';

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 90), Math.max(90, width - 90));
  return (
    <div
      role="status"
      style={{
        position: 'absolute', left, top: Math.max(0, tip.y - 10), transform: 'translate(-50%, -100%)', pointerEvents: 'none',
        background: 'var(--navy)', color: '#fff', fontSize: 12.5, lineHeight: 1.45, padding: '7px 10px', borderRadius: 8, boxShadow: 'var(--shadow-2)', whiteSpace: 'nowrap', zIndex: 5,
      }}
    >
      {tip.content}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: 'dot' | 'line' }[] }) {
  return (
    <div className="row" style={{ gap: 16, fontSize: 12.5, color: 'var(--ink-2)' }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 6 }}>
          {i.shape === 'line' ? <span style={{ width: 14, height: 2, borderRadius: 1, background: i.color }} /> : <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// ------------------------------------------------------------------ line

export interface LinePoint {
  label: string;
  value: number | null;
  tip?: ReactNode;
}

/** One series over an ordered set of points (e.g. sentiment across a customer's calls). Gaps where value is null. */
export function LineChart({ points, min = 0, max = 100, height = 200, color = 'var(--series-1)', bands, ariaLabel }: { points: LinePoint[]; min?: number; max?: number; height?: number; color?: string; bands?: { from: number; to: number; label: string }[]; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 16, t: 14, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (points.length <= 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.t + h - ((v - min) / (max - min)) * h;
  const ticks = [min, (min + max) / 2, max];
  const segs: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur) segs.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(i)},${y(p.value)}`;
  });
  if (cur) segs.push(cur);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(w / 70))));
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {bands?.map((b) => (
            <g key={b.label}>
              <rect x={pad.l} width={w} y={y(b.to)} height={y(b.from) - y(b.to)} fill="var(--surface-2)" />
              <text x={pad.l + w - 4} y={y(b.to) + 12} textAnchor="end" fontSize={11} fill="var(--subtle)">{b.label}</text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS} className="num">{Math.round(t)}</text>
            </g>
          ))}
          {segs.map((d, i) => <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {points.map((p, i) =>
            p.value === null ? null : (
              <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 6 : 4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            ),
          )}
          {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1 ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={AXIS}>{p.label}</text> : null))}
          {points.map((_, i) => {
            const half = points.length <= 1 ? w / 2 : w / (points.length - 1) / 2;
            return <rect key={i} x={x(i) - half} width={half * 2} y={pad.t} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />;
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + h} stroke="var(--line-strong)" />}
        </svg>
      )}
      <Tooltip tip={hp && hover !== null ? { x: x(hover), y: hp.value === null ? pad.t : y(hp.value), content: hp.tip ?? `${hp.label}: ${hp.value ?? 'no data'}` } : null} width={width} />
    </div>
  );
}

// ------------------------------------------------------------------ columns (stacked)

export interface ColumnDatum {
  label: string;
  values: number[];
  tip?: ReactNode;
}

/** Columns per period, optionally stacked (series share --series-* colours, in fixed order). */
export function ColumnChart({ data, series, height = 220, ariaLabel, unit = '' }: { data: ColumnDatum[]; series: { label: string; color: string }[]; height?: number; ariaLabel: string; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 38, r: 10, t: 14, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const total = (d: ColumnDatum) => d.values.reduce((a, b) => a + b, 0);
  const max = niceMax(Math.max(1, ...data.map(total)));
  const band = data.length ? w / data.length : w;
  const bw = Math.min(24, Math.max(4, band * 0.62));
  const y = (v: number) => pad.t + h - (v / max) * h;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(w / 46))));
  const hd = hover !== null ? data[hover] : null;
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + w} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={AXIS} className="num">{Number.isInteger(t) ? t.toLocaleString('en-IN') : t.toFixed(1)}{unit}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.l + band * i + band / 2;
            let base = 0;
            const nonZero = d.values.map((v, s) => ({ v, s })).filter((x) => x.v > 0);
            return (
              <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                {nonZero.map(({ v, s }, k) => {
                  const top = y(base + v);
                  const bottom = y(base);
                  base += v;
                  const isTop = k === nonZero.length - 1;
                  const gap = k > 0 ? 2 : 0; // surface gap between stacked segments
                  const hh = Math.max(0, bottom - top - gap);
                  const r = isTop ? Math.min(4, hh / 2, bw / 2) : 0;
                  const x0 = cx - bw / 2;
                  const d0 = `M${x0},${top + hh + 0}V${top + r}${r ? `Q${x0},${top} ${x0 + r},${top}` : ''}H${x0 + bw - r}${r ? `Q${x0 + bw},${top} ${x0 + bw},${top + r}` : ''}V${top + hh}Z`;
                  return <path key={s} d={d0} fill={series[s]?.color ?? 'var(--series-4)'} />;
                })}
                {(i % labelEvery === 0 || i === data.length - 1) && <text x={cx} y={height - 8} textAnchor="middle" fontSize={11} fill={AXIS}>{d.label}</text>}
                <rect x={pad.l + band * i} width={band} y={pad.t} height={h} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip
        tip={
          hd && hover !== null
            ? {
                x: pad.l + band * hover + band / 2,
                y: y(total(hd)),
                content: hd.tip ?? (
                  <>
                    <div style={{ fontWeight: 600 }}>{hd.label}</div>
                    {series.map((s, k) => (
                      <div key={s.label}>{s.label}: {hd.values[k] ?? 0}{unit}</div>
                    ))}
                  </>
                ),
              }
            : null
        }
        width={width}
      />
    </div>
  );
}

// ------------------------------------------------------------------ horizontal bars

export interface BarDatum {
  label: ReactNode;
  value: number;
  display?: string;
  color?: string;
  note?: ReactNode;
}

/** Ranked horizontal bars with the value at the tip — outcomes, leaderboards. Plain HTML so labels wrap naturally. */
export function BarList({ data, max, color = 'var(--series-1)', ariaLabel }: { data: BarDatum[]; max?: number; color?: string; ariaLabel: string }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul aria-label={ariaLabel} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <li key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 36%) 1fr auto', gap: 12, alignItems: 'center', fontSize: 13.5 }}>
          <span className="truncate" style={{ color: 'var(--ink-2)' }}>{d.label}</span>
          <span style={{ height: 12, display: 'flex', alignItems: 'center' }} title={d.display ?? String(d.value)}>
            <span style={{ display: 'block', height: 12, width: `${Math.max(d.value > 0 ? 2 : 0, (d.value / m) * 100)}%`, background: d.color ?? color, borderRadius: '0 4px 4px 0' }} />
          </span>
          <span className="mono" style={{ fontSize: 13, minWidth: 36, textAlign: 'right' }}>{d.display ?? d.value}</span>
          {d.note && <span className="muted" style={{ gridColumn: '2 / -1', fontSize: 12, marginTop: -6 }}>{d.note}</span>}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ conversation timeline

export interface SpeakingSpan {
  speaker: 'agent' | 'customer';
  from: number;
  to: number;
  text?: string;
}

/** Who talked when across one call: two lanes (agent, customer) on a shared time axis. Click a span to seek. */
export function ConversationTimeline({ spans, duration, playhead, onSeek, measured }: { spans: SpeakingSpan[]; duration: number; playhead?: number; onSeek?: (sec: number) => void; measured: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const pad = { l: 74, r: 10, t: 6, b: 22 };
  const lane = 22;
  const height = pad.t + lane * 2 + 10 + pad.b;
  const w = Math.max(0, width - pad.l - pad.r);
  const d = Math.max(1, duration);
  const x = (s: number) => pad.l + (s / d) * w;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ticks = Array.from({ length: 5 }, (_, i) => (d * i) / 4);
  const laneY = (s: 'agent' | 'customer') => pad.t + (s === 'agent' ? 0 : lane + 10);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Who spoke when — ${measured ? 'measured on the line' : 'estimated from the transcript'}`} onMouseLeave={() => setTip(null)}>
          {(['agent', 'customer'] as const).map((s) => (
            <g key={s}>
              <text x={0} y={laneY(s) + 15} fontSize={12} fill="var(--ink-2)">{s === 'agent' ? 'Agent' : 'Customer'}</text>
              <rect x={pad.l} y={laneY(s)} width={w} height={lane} rx={4} fill="var(--surface-2)" />
            </g>
          ))}
          {spans.map((sp, i) => (
            <rect
              key={i}
              x={x(sp.from)}
              y={laneY(sp.speaker) + 3}
              width={Math.max(2, x(sp.to) - x(sp.from) - 1)}
              height={lane - 6}
              rx={3}
              fill={sp.speaker === 'agent' ? 'var(--series-1)' : 'var(--series-2)'}
              style={{ cursor: onSeek ? 'pointer' : undefined }}
              onClick={() => onSeek?.(sp.from)}
              onMouseEnter={() => setTip({ x: x((sp.from + sp.to) / 2), y: laneY(sp.speaker), content: <span>{sp.speaker === 'agent' ? 'Agent' : 'Customer'} · {fmt(sp.from)}–{fmt(sp.to)}{sp.text ? <><br />{sp.text.length > 60 ? `${sp.text.slice(0, 60)}…` : sp.text}</> : null}</span> })}
            />
          ))}
          {ticks.map((t, i) => (
            <text key={t} x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'} fontSize={11} fill={AXIS} className="num">{fmt(t)}</text>
          ))}
          {playhead !== undefined && playhead > 0 && <line x1={x(Math.min(playhead, d))} x2={x(Math.min(playhead, d))} y1={pad.t - 2} y2={pad.t + lane * 2 + 12} stroke="var(--ink)" strokeWidth={1.5} />}
        </svg>
      )}
      <Tooltip tip={tip} width={width} />
    </div>
  );
}

/** Agent vs customer share of talk time as one split bar with both values labelled. */
export function TalkSplit({ agent, customer }: { agent: number; customer: number }) {
  const total = agent + customer;
  if (total <= 0) return <span className="muted">No speech measured</span>;
  const a = Math.round((agent / total) * 100);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 2, height: 10 }} role="img" aria-label={`Agent ${a}%, customer ${100 - a}%`}>
        <span style={{ width: `${a}%`, background: 'var(--series-1)', borderRadius: '4px 0 0 4px' }} />
        <span style={{ flex: 1, background: 'var(--series-2)', borderRadius: '0 4px 4px 0' }} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
        <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--series-1)' }} />Agent <b className="mono" style={{ fontWeight: 500 }}>{a}%</b></span>
        <span className="row" style={{ gap: 6 }}>Customer <b className="mono" style={{ fontWeight: 500 }}>{100 - a}%</b><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--series-2)' }} /></span>
      </div>
    </div>
  );
}
