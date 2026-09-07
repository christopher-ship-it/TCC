import { useState } from 'react';
import SupervisorNav from '../../components/SupervisorNav';
import { useStore } from '../../store/StoreContext';
import { QUEUES, type QueueKey, type Role } from '../../data/types';
import { APPS } from '../../data/seed';

const PRESETS: Record<string, QueueKey[]> = {
  trainee: ['new'],
  standard: ['new', 'followup', 'inactive'],
  experienced: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'],
};

export default function TeamAccess() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('Deepa R');
  const [username, setUsername] = useState('deepa.r');
  const [password, setPassword] = useState('Tcc@482915');
  const [role, setRole] = useState<Role>('agent');
  const [apps, setApps] = useState<Set<string>>(new Set(['realbroks']));
  const [queues, setQueues] = useState<Set<QueueKey>>(new Set(PRESETS.standard));
  const [target, setTarget] = useState(50);

  const agents = state.agents.filter((a) => a.role !== 'admin');

  const coverage: Record<QueueKey, number> = QUEUES.reduce((acc, q) => {
    acc[q.key] = agents.filter((a) => a.role === 'agent' && a.queues.includes(q.key)).length;
    return acc;
  }, {} as Record<QueueKey, number>);

  const gaps: string[] = [];
  for (const app of APPS.filter((a) => a.live)) {
    for (const q of QUEUES) {
      const count = agents.filter((a) => a.role === 'agent' && a.apps.includes(app.id) && a.queues.includes(q.key)).length;
      if (count === 0) gaps.push(`${app.name} has no agent assigned to ${q.label}.`);
    }
  }

  function toggleSet<T>(set: Set<T>, value: T, setSet: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setSet(next);
  }

  function createLogin() {
    if (!name.trim() || !username.trim()) return;
    dispatch({
      type: 'CREATE_AGENT',
      agent: {
        id: `agent-${Date.now()}`,
        name, username: username.trim(), role,
        apps: Array.from(apps) as ('realbroks' | 'irondrobe')[],
        queues: Array.from(queues),
        languages: ['Tamil'],
        states: ['Tamil Nadu'],
        dailyTarget: target,
        clickToDial: true,
        lastActiveLabel: 'Never signed in',
        todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0,
        avgHandleLabel: '—', workingQueueLabel: QUEUES.find((q) => queues.has(q.key))?.label ?? '—',
      },
    });
    setName(''); setUsername('');
  }

  return (
    <div>
      <SupervisorNav />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', minHeight: 'calc(100vh - 52px)' }}>
        <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="eyebrow">Agent logins · {agents.length} active</div>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginLeft: 'auto' }}>
              Queue keys — {QUEUES.map((q) => <span key={q.key}><strong style={{ color: 'var(--color-text)' }}>{q.order}</strong> {q.short} </span>)}
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Apps</th><th>Queues</th><th>Last active</th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}{a.trainee ? <span className="tag tag-neutral" style={{ marginLeft: 6 }}>trainee</span> : null}</td>
                  <td style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12 }}>{a.username}</td>
                  <td style={{ textTransform: 'capitalize' }}>{a.role}</td>
                  <td>{a.role === 'supervisor' ? 'All apps' : a.apps.map((id) => APPS.find((x) => x.id === id)?.name).join(', ') || '—'}</td>
                  <td>
                    {a.role === 'supervisor' ? <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>All + team management</span> :
                      QUEUES.filter((q) => a.queues.includes(q.key)).map((q) => <span key={q.key} className="tag tag-accent" style={{ marginRight: 4 }}>{q.order}</span>)}
                  </td>
                  <td>{a.lastActiveLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="eyebrow" style={{ margin: 'var(--space-6) 0 var(--space-3)' }}>Coverage check · who can work each queue</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)' }}>
            {QUEUES.map((q, i) => (
              <div key={q.key} style={{ padding: 'var(--space-3)', borderRight: i < 5 ? '1px solid var(--color-divider)' : 0 }}>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{q.order} · {q.short}</div>
                <div style={{ font: '800 20px var(--font-heading)', color: coverage[q.key] === 0 ? 'var(--color-accent-700)' : undefined }}>{coverage[q.key]}</div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>agents</div>
              </div>
            ))}
          </div>
          {gaps.slice(0, 3).map((g, i) => (
            <div key={i} style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-accent-100)', borderLeft: '2px solid var(--color-accent)', fontSize: 12 }}>{g}</div>
          ))}
        </div>

        <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
          <h4 style={{ margin: '0 0 var(--space-4)' }}>Create agent login</h4>
          <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
            <label htmlFor="ta-name">Full name</label>
            <input className="input" id="ta-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="field"><label htmlFor="ta-user">Username</label><input className="input" id="ta-user" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div className="field"><label htmlFor="ta-pw">Temporary password</label><input className="input" id="ta-pw" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          </div>

          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Role</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label className="radio"><input type="radio" checked={role === 'agent'} onChange={() => setRole('agent')} /><span className="dot" />Agent — works assigned queues only</label>
              <label className="radio"><input type="radio" checked={role === 'supervisor'} onChange={() => setRole('supervisor')} /><span className="dot" />Supervisor — all queues + team management</label>
            </div>
          </div>

          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Apps this login can open</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {APPS.map((app) => (
                <label key={app.id} className="radio" style={{ opacity: app.live ? 1 : 0.5 }}>
                  <input type="checkbox" disabled={!app.live} checked={apps.has(app.id)} onChange={() => toggleSet(apps, app.id, setApps)} /><span className="dot" />
                  {app.name} {!app.live && <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>— not live</span>}
                </label>
              ))}
            </div>
          </div>

          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>Queue access</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)', fontSize: 11 }}>
              {Object.keys(PRESETS).map((p) => (
                <button key={p} type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 11 }} onClick={() => setQueues(new Set(PRESETS[p]))}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ border: '1px solid var(--color-divider)' }}>
            {QUEUES.map((q, i) => (
              <label key={q.key} className="radio" style={{ display: 'flex', padding: '9px var(--space-3)', borderBottom: i < QUEUES.length - 1 ? '1px solid var(--color-divider)' : 0, background: queues.has(q.key) ? 'var(--color-surface)' : undefined }}>
                <input type="checkbox" checked={queues.has(q.key)} onChange={() => toggleSet(queues, q.key, setQueues)} /><span className="dot" />
                <span style={{ flex: 1 }}>{queues.has(q.key) ? <strong>{q.order} · {q.label}</strong> : `${q.order} · ${q.label}`}</span>
              </label>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-2)', fontSize: 12, color: 'var(--color-neutral-700)', lineHeight: 1.5 }}>Unticked queues are hidden from this login — not greyed out, not listed.</div>

          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label htmlFor="ta-target">Daily call target</label>
            <input className="input" id="ta-target" type="number" value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </div>
          <button className="btn btn-primary btn-block" type="button" style={{ margin: 0 }} onClick={createLogin}>Create login &amp; send SMS</button>
        </div>
      </div>
    </div>
  );
}
