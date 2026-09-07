import { useEffect, useState } from 'react';
import SupervisorNav from '../../components/SupervisorNav';
import { useStore } from '../../store/StoreContext';
import type { Language } from '../../data/types';
import { STATE_DEFS } from '../../data/seed';

const ALL_LANGUAGES: Language[] = ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Hindi', 'Bengali', 'English'];

export default function Allocation() {
  const { state, dispatch } = useStore();
  const agents = state.agents.filter((a) => a.role === 'agent');
  const [selectedId, setSelectedId] = useState(agents[0]?.id);
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];

  const [languages, setLanguages] = useState<Set<Language>>(new Set(selected?.languages ?? ['Tamil']));
  const [states, setStates] = useState<Set<string>>(new Set(selected?.states ?? ['Tamil Nadu']));

  useEffect(() => {
    if (selected) {
      setLanguages(new Set(selected.languages));
      setStates(new Set(selected.states));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function reachableCount(langs: Set<Language>, sts: Set<string>, agentApps: string[]) {
    return state.users.filter((u) => {
      if (!agentApps.includes(u.app)) return false;
      const stateOk = sts.has(u.effectiveState);
      const langOk = u.state === null ? true : langs.has(u.language);
      return stateOk && langOk;
    }).length;
  }

  function toggleLang(l: Language) {
    if (l === 'Tamil') return;
    const next = new Set(languages);
    if (next.has(l)) next.delete(l); else next.add(l);
    setLanguages(next);
  }
  function toggleState(name: string) {
    if (name === 'Tamil Nadu') return;
    const next = new Set(states);
    if (next.has(name)) next.delete(name); else next.add(name);
    setStates(next);
  }

  function save() {
    if (!selected) return;
    dispatch({ type: 'UPDATE_AGENT_ALLOCATION', agentId: selected.id, languages: Array.from(languages), states: Array.from(states) });
  }

  if (!selected) return null;

  return (
    <div>
      <SupervisorNav />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 460px' }}>
        <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Who covers what</div>
          <table className="table">
            <thead><tr><th>Agent</th><th>Languages</th><th>States allocated</th><th>Reachable users</th><th></th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} style={a.id === selected.id ? { background: 'var(--color-surface)' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{a.languages.join(' · ')}</td>
                  <td>{a.states.includes('Tamil Nadu') && a.states.length > 1 ? `Tamil Nadu + ${a.states.length - 1} more` : a.states.join(', ')}</td>
                  <td>{reachableCount(new Set(a.languages), new Set(a.states), a.apps).toLocaleString('en-IN')}</td>
                  <td><button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => setSelectedId(a.id)}>edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="eyebrow" style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>Rules</div>
          <div style={{ borderTop: '2px solid var(--color-divider)', borderBottom: '2px solid var(--color-divider)', fontSize: 13 }}>
            {[
              'A user is served only to agents who hold that state and a language the user speaks.',
              'No state on the profile → defaults to Tamil Nadu, so every agent can pick it up. The agent captures the real state during the call and the user re-routes automatically.',
              'Every agent must hold Tamil — it is the default-state language.',
              'A language mismatch found on a call can be re-routed only with supervisor approval.',
            ].map((rule, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: i < 3 ? '1px solid var(--color-divider)' : 0 }}>
                <span style={{ font: '800 12px ui-monospace,Menlo,monospace', color: 'var(--color-accent-700)', minWidth: 24 }}>{String(i + 1).padStart(2, '0')}</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
          <h4 style={{ margin: '0 0 var(--space-2)' }}>Allocation · {selected.name}</h4>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginBottom: 'var(--space-4)' }}>Set at account creation, editable any time. Queue access is on the Team &amp; access tab.</div>

          <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
            <label>Languages this agent can call in</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {ALL_LANGUAGES.map((l) => (
                <label key={l} className="radio">
                  <input type="checkbox" checked={languages.has(l)} disabled={l === 'Tamil'} onChange={() => toggleLang(l)} /><span className="dot" />
                  {l} {l === 'Tamil' && <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>— required for all agents</span>}
                  {l === 'Bengali' && <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>— optional; northern states are worked in Hindi</span>}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>States allocated</div>
            <div style={{ marginLeft: 'auto' }}>
              <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 11 }} onClick={() => setStates(new Set(['Tamil Nadu', ...STATE_DEFS.filter((s) => languages.has(s.language)).map((s) => s.name)]))}>match my languages</button>
            </div>
          </div>
          <div style={{ border: '1px solid var(--color-divider)', maxHeight: 260, overflow: 'auto' }}>
            {STATE_DEFS.map((s, i) => {
              const needsLang = s.name !== 'Tamil Nadu' && !languages.has(s.language);
              return (
                <label key={s.name} className="radio" style={{ display: 'flex', padding: '8px var(--space-3)', borderBottom: i < STATE_DEFS.length - 1 ? '1px solid var(--color-divider)' : 0, background: states.has(s.name) ? 'var(--color-surface)' : undefined, opacity: needsLang ? 0.6 : 1 }}>
                  <input type="checkbox" checked={states.has(s.name)} disabled={s.name === 'Tamil Nadu' || needsLang} onChange={() => toggleState(s.name)} /><span className="dot" />
                  <span style={{ flex: 1 }}>
                    {states.has(s.name) ? <strong>{s.name}</strong> : s.name}
                    {s.name === 'Tamil Nadu' && <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}> + no-state default</span>}
                    {needsLang && <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}> needs {s.language}</span>}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{s.weight.toLocaleString('en-IN')}</span>
                </label>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '2px solid var(--color-divider)' }}>
            <div>
              <div className="eyebrow">Reachable with this allocation</div>
              <div style={{ font: '800 22px var(--font-heading)' }}>{reachableCount(languages, states, selected.apps).toLocaleString('en-IN')} users</div>
            </div>
          </div>
          <button className="btn btn-primary btn-block" type="button" onClick={save}>Save allocation</button>
        </div>
      </div>
    </div>
  );
}
