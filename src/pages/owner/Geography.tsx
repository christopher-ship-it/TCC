import { useMemo } from 'react';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { STATE_DEFS } from '../../data/seed';
import { inrLabel } from '../../lib/dates';
import { isActive, LANGUAGE_SCRIPT } from '../../lib/access';
import IndiaMap from '../../components/owner/IndiaMap';
import { Badge, Callout, Card, PageHead, Stat } from '../../ui/primitives';
import '../customer.css';

export default function Geography() {
  const { state } = useStore();
  const { apps } = useScope();
  const users = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const rows = useMemo(
    () =>
      STATE_DEFS.map((s) => {
        const here = users.filter((u) => u.effectiveState === s.name);
        return {
          ...s,
          users: here.length,
          active: here.filter((u) => u.active).length,
          paying: here.filter((u) => u.paying).length,
          mrr: here.reduce((n, u) => n + (u.mrr ?? 0), 0),
          agents: state.agents.filter((a) => a.role === 'agent' && isActive(a) && a.states.includes(s.name) && a.languages.includes(s.language)).length,
        };
      }).sort((a, b) => b.users - a.users),
    [users, state.agents],
  );
  const noState = users.filter((u) => u.state === null).length;
  const top = rows[0];

  return (
    <div className="page">
      <PageHead title="Geography" desc="Where customers are, and whether someone who speaks their language covers each state." />
      <div className="stats">
        <Stat label="States with customers" value={rows.filter((r) => r.users > 0).length} />
        <Stat label={`${top?.name ?? 'Top state'} share`} value={users.length ? `${Math.round(((top?.users ?? 0) / users.length) * 100)}%` : '—'} />
        <Stat label="No state on profile" value={noState} tone={noState ? 'warn' : undefined} note="Counted as Tamil Nadu until an agent asks" />
        <Stat label="States with no agent" value={rows.filter((r) => r.users > 0 && r.agents === 0).length} tone={rows.some((r) => r.users > 0 && r.agents === 0) ? 'danger' : 'ok'} />
      </div>
      <div className="cust-layout" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 6fr)' }}>
        <Card title="Customers by state">
          <IndiaMap data={rows.map((r) => ({ name: r.name, lon: r.lon, lat: r.lat, users: r.users, language: r.language, agents: r.agents }))} />
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          {noState > 0 && <Callout tone="warn">{noState} customers have no state on their profile. Any agent can reach them; whoever calls first should ask and update it.</Callout>}
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>State</th><th className="r">Customers</th><th className="r">Active</th><th className="r">Paying</th><th className="r">MRR</th><th>Agents who speak it</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td><b style={{ fontWeight: 500 }}>{r.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{LANGUAGE_SCRIPT[r.language]} · {r.language}</div></td>
                    <td className="r mono">{r.users.toLocaleString('en-IN')}</td>
                    <td className="r mono">{r.active.toLocaleString('en-IN')}</td>
                    <td className="r mono">{r.paying.toLocaleString('en-IN')}</td>
                    <td className="r mono">{r.mrr ? inrLabel(r.mrr) : '—'}</td>
                    <td>{r.agents === 0 ? (r.users ? <Badge tone="danger">None</Badge> : <span className="subtle">—</span>) : <span className="mono">{r.agents}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
