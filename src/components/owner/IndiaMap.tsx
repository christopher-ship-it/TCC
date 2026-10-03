import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export interface StatePoint {
  name: string;
  lon: number;
  lat: number;
  users: number;
  language: string;
  agents: number;
}

const W = 540;
const H = 560;

/** India outline with one circle per state, area = customers. Hover for the numbers; the table beside it carries the same data. */
export default function IndiaMap({ data }: { data: StatePoint[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; d: StatePoint } | null>(null);
  const [failed, setFailed] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.users));

  useEffect(() => {
    let cancelled = false;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    d3.json<any>('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')
      .then((topo) => {
        if (cancelled || !topo) return;
        const countries = (topojson.feature(topo, topo.objects.countries) as any).features;
        const india = countries.find((f: any) => String(f.id) === '356');
        const projection = d3.geoMercator().fitExtent([[16, 16], [W - 16, H - 16]], india);
        const path = d3.geoPath(projection as any);
        svg.append('path').datum(india).attr('d', path as any).attr('fill', 'var(--surface-3)').attr('stroke', 'var(--line-strong)').attr('stroke-width', 1);
        const r = d3.scaleSqrt().domain([0, max]).range([0, 34]);
        svg
          .append('g')
          .selectAll('circle')
          .data(data.filter((d) => d.users > 0).sort((a, b) => b.users - a.users))
          .join('circle')
          .attr('cx', (d) => (projection([d.lon, d.lat]) as [number, number])[0])
          .attr('cy', (d) => (projection([d.lon, d.lat]) as [number, number])[1])
          .attr('r', (d) => Math.max(4, r(d.users)))
          .attr('fill', 'var(--series-1)')
          .attr('fill-opacity', 0.78)
          .attr('stroke', 'var(--surface)')
          .attr('stroke-width', 2)
          .style('cursor', 'pointer')
          .on('mousemove', (event: MouseEvent, d) => {
            const box = svgRef.current!.getBoundingClientRect();
            setTip({ x: event.clientX - box.left, y: event.clientY - box.top, d });
          })
          .on('mouseleave', () => setTip(null));
        svg
          .selectAll('text.lbl')
          .data(data.filter((d) => d.users >= max * 0.12))
          .join('text')
          .attr('x', (d) => (projection([d.lon, d.lat]) as [number, number])[0] + r(d.users) + 6)
          .attr('y', (d) => (projection([d.lon, d.lat]) as [number, number])[1] + 4)
          .attr('font-size', 12)
          .attr('font-weight', 500)
          .attr('fill', 'var(--ink-2)')
          .text((d) => `${d.name} ${d.users.toLocaleString('en-IN')}`);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [data, max]);

  return (
    <div style={{ position: 'relative' }}>
      {failed && <p className="muted">The map outline couldn’t load (offline?) — the table has the same numbers.</p>}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxHeight: 560 }} role="img" aria-label="Map of India with a circle over each state sized by customer count" />
      {tip && (
        <div role="status" style={{ position: 'absolute', left: tip.x + 12, top: tip.y - 10, pointerEvents: 'none', background: 'var(--navy)', color: '#fff', padding: '7px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.45, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-2)' }}>
          <b>{tip.d.name}</b> · {tip.d.users.toLocaleString('en-IN')} customers
          <br />
          {tip.d.language} · {tip.d.agents} agent{tip.d.agents === 1 ? '' : 's'} cover it
        </div>
      )}
      <div className="row" style={{ gap: 16, fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }}>
        <span>Circle area = customers</span>
        <span style={{ marginLeft: 'auto' }}>Outline: Natural Earth 1:110m</span>
      </div>
    </div>
  );
}
