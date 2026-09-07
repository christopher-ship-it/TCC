import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TECSTELLAR_MARK } from '../../assets';
import { useStore } from '../../store/StoreContext';
import { STATE_DEFS } from '../../data/seed';
import { inrLabel } from '../../lib/dates';
import IndiaMap from '../../components/owner/IndiaMap';

export default function Geography() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();

  const noStateCount = state.users.filter((u) => u.state === null).length;

  const rows = useMemo(() => {
    return STATE_DEFS.map((s) => {
      const users = state.users.filter((u) => u.effectiveState === s.name);
      const agentsCovering = state.agents.filter((a) => a.role === 'agent' && a.states.includes(s.name)).length;
      return {
        name: s.name,
        users: users.length,
        active: users.filter((u) => u.active).length,
        paying: users.filter((u) => u.paying).length,
        mrr: users.reduce((sum, u) => sum + (u.mrr ?? 0), 0),
        language: s.language,
        agents: agentsCovering,
      };
    }).sort((a, b) => b.users - a.users);
  }, [state.users, state.agents]);

  const mapData = rows.map((r) => {
    const def = STATE_DEFS.find((s) => s.name === r.name)!;
    return { name: r.name, lon: def.lon, lat: def.lat, users: r.users, language: r.language, agents: r.agents };
  });

  const tnShare = state.users.length ? Math.round(((rows.find((r) => r.name === 'Tamil Nadu')?.users ?? 0) / state.users.length) * 100) : 0;
  const northern = ['Maharashtra', 'Delhi', 'Uttar Pradesh', 'Gujarat', 'Rajasthan', 'Madhya Pradesh', 'West Bengal'];
  const northernUsers = rows.filter((r) => northern.includes(r.name)).reduce((s, r) => s + r.users, 0);
  const tnUsers = rows.find((r) => r.name === 'Tamil Nadu')?.users ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 52, padding: '0 var(--space-4)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-900)', color: 'var(--color-neutral-100)' }}>
        <button type="button" onClick={() => navigate('/owner')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
          <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>TCC</span>
        </button>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.75 }}>All apps · geography</div>
        <button type="button" onClick={() => navigate('/owner')} style={{ fontSize: 12, opacity: 0.85, background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>← Dashboard</button>
        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12, color: 'var(--color-accent-400)' }} onClick={() => { dispatch({ type: 'LOGOUT' }); navigate('/'); }}>sign out</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '600px 1fr' }}>
        <div style={{ borderRight: '2px solid var(--color-divider)' }}>
          <IndiaMap data={mapData} />
        </div>
        <div style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', marginBottom: 'var(--space-4)' }}>
            <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-3) 0', borderRight: '1px solid var(--color-divider)' }}><div className="eyebrow">States with users</div><div style={{ font: '800 26px var(--font-heading)' }}>{rows.filter((r) => r.users > 0).length}</div></div>
            <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: '1px solid var(--color-divider)' }}><div className="eyebrow">Tamil Nadu share</div><div style={{ font: '800 26px var(--font-heading)' }}>{tnShare}%</div></div>
            <div style={{ padding: 'var(--space-3) var(--space-4)' }}><div className="eyebrow">No state on profile</div><div style={{ font: '800 26px var(--font-heading)', color: 'var(--color-accent-700)' }}>{noStateCount}</div></div>
          </div>
          <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-accent-100)', borderLeft: '2px solid var(--color-accent)', fontSize: 12, lineHeight: 1.5, marginBottom: 'var(--space-4)' }}>
            <strong>{noStateCount} users have no state on their profile</strong> — all of them default to Tamil Nadu, so every agent can reach them. They're flagged in the queue so the agent can capture the real state on the call.
          </div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>State-wise splitup</div>
          <table className="table">
            <thead><tr><th>State</th><th>Users</th><th>Active</th><th>Paying</th><th>MRR</th><th>Language</th><th>Agents</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{r.users.toLocaleString('en-IN')}</td>
                  <td>{r.active.toLocaleString('en-IN')}</td>
                  <td>{r.paying.toLocaleString('en-IN')}</td>
                  <td>{r.mrr ? inrLabel(r.mrr) : '—'}</td>
                  <td>{r.language}</td>
                  <td style={{ color: r.agents === 0 ? 'var(--color-accent-700)' : undefined, fontWeight: r.agents === 0 ? 600 : undefined }}>{r.agents}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 'var(--space-3)', fontSize: 12, color: 'var(--color-neutral-700)' }}>
            Every northern state is worked in Hindi — {northernUsers.toLocaleString('en-IN')} users across {northern.length} states against {tnUsers.toLocaleString('en-IN')} in Tamil Nadu alone. Rebalance in Supervisor → Allocation.
          </div>
        </div>
      </div>
    </div>
  );
}
