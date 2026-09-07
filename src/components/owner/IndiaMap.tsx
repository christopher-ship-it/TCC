import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

interface StatePoint {
  name: string;
  lon: number;
  lat: number;
  users: number;
  language: string;
  agents: number;
}

const W = 540;
const H = 560;

export default function IndiaMap({ data }: { data: StatePoint[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const svg = d3.select(svgRef.current).attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    svg.selectAll('*').remove();
    const tip = d3.select(tipRef.current);

    d3.json<any>('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then((topo) => {
      if (cancelled || !topo) return;
      const countries = (topojson.feature(topo, topo.objects.countries) as any).features;
      const india = countries.find((f: any) => String(f.id) === '356');
      const projection = d3.geoMercator().fitExtent([[16, 16], [W - 16, H - 16]], india);
      const path = d3.geoPath(projection as any);

      const grad = svg.append('defs').append('linearGradient').attr('id', 'brandGrad').attr('x1', '0').attr('y1', '1').attr('x2', '1').attr('y2', '0');
      grad.append('stop').attr('offset', '0%').attr('stop-color', '#22a544');
      grad.append('stop').attr('offset', '70%').attr('stop-color', '#29a9e0');
      grad.append('stop').attr('offset', '100%').attr('stop-color', '#1e8fc6');

      svg.append('path').datum(india).attr('d', path as any).attr('fill', 'var(--color-neutral-200)').attr('stroke', 'var(--color-text)').attr('stroke-width', 1.25);

      const r = d3.scaleSqrt().domain([0, d3.max(data, (d) => d.users) ?? 1]).range([0, 34]);
      const g = svg.append('g');
      g.selectAll('circle')
        .data(data.slice().sort((a, b) => b.users - a.users))
        .join('circle')
        .attr('cx', (d) => (projection([d.lon, d.lat]) as [number, number])[0])
        .attr('cy', (d) => (projection([d.lon, d.lat]) as [number, number])[1])
        .attr('r', (d) => r(d.users))
        .attr('fill', 'url(#brandGrad)')
        .attr('fill-opacity', 0.72)
        .attr('stroke', 'var(--color-text)')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer')
        .on('mousemove', (event: MouseEvent, d) => {
          const bounds = wrapRef.current?.getBoundingClientRect();
          tip.style('opacity', 1)
            .style('left', `${event.clientX - (bounds?.left ?? 0) + 12}px`)
            .style('top', `${event.clientY - (bounds?.top ?? 0) - 10}px`)
            .html(`<strong>${d.name}</strong> · ${d.users.toLocaleString('en-IN')} users<br>${d.language} · ${d.agents} agent${d.agents === 1 ? '' : 's'} assigned`);
        })
        .on('mouseleave', () => tip.style('opacity', 0));

      svg.selectAll('text.lbl')
        .data(data.filter((d) => d.users >= Math.max(200, (d3.max(data, (x) => x.users) ?? 1) * 0.05)))
        .join('text')
        .attr('class', 'lbl')
        .attr('x', (d) => (projection([d.lon, d.lat]) as [number, number])[0] + r(d.users) + 5)
        .attr('y', (d) => (projection([d.lon, d.lat]) as [number, number])[1] + 4)
        .attr('font-family', 'var(--font-heading)')
        .attr('font-weight', 800)
        .attr('font-size', 11)
        .attr('fill', 'var(--color-text)')
        .text((d) => `${d.name} ${d.users.toLocaleString('en-IN')}`);
    }).catch(() => {
      // Offline / CDN unreachable — the state table alongside the map still carries the same data.
    });

    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
        <div className="eyebrow">Users by state · all apps</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-700)' }}>Circle area = users</div>
      </div>
      <svg ref={svgRef} role="img" aria-label="Map of India with a circle over each state sized by user count" />
      <div ref={tipRef} style={{ position: 'absolute', pointerEvents: 'none', opacity: 0, background: 'var(--color-text)', color: 'var(--color-bg)', padding: '6px 9px', fontSize: 12, lineHeight: 1.35, whiteSpace: 'nowrap' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '2px solid var(--color-divider)', fontSize: 11, color: 'var(--color-neutral-700)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: '50%', border: '1px solid var(--color-text)', background: 'linear-gradient(45deg,#22a544,#29a9e0 70%,#1e8fc6)', opacity: 0.8 }} />500</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 19, height: 19, borderRadius: '50%', border: '1px solid var(--color-text)', background: 'linear-gradient(45deg,#22a544,#29a9e0 70%,#1e8fc6)', opacity: 0.8 }} />2,000</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 33, height: 33, borderRadius: '50%', border: '1px solid var(--color-text)', background: 'linear-gradient(45deg,#22a544,#29a9e0 70%,#1e8fc6)', opacity: 0.8 }} />6,000</span>
        <span style={{ marginLeft: 'auto' }}>Outline: Natural Earth 1:110m</span>
      </div>
    </div>
  );
}
