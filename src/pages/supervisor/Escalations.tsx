import React, { useState } from 'react';
import SupervisorNav from '../../components/SupervisorNav';
import { useStore } from '../../store/StoreContext';

export default function Escalations() {
  const { state, dispatch } = useStore();
  const pending = state.escalations.filter((e) => e.status === 'pending');
  const [selectedId, setSelectedId] = useState(pending[0]?.id);
  const selected = state.escalations.find((e) => e.id === selectedId) ?? pending[0];

  const reroutes = pending.filter((e) => e.type === 'reroute').length;
  const wantsSupervisor = pending.filter((e) => e.type === 'escalation').length;

  const coveringAgents = selected?.targetLanguage
    ? state.agents.filter((a) => a.role === 'agent' && a.apps.includes(selected.app) && a.languages.includes(selected.targetLanguage!))
    : [];
  const [reassignId, setReassignId] = useState<string | undefined>(coveringAgents[0]?.id);
  const [note, setNote] = useState('');

  function approve() {
    if (!selected) return;
    dispatch({ type: 'APPROVE_ESCALATION', id: selected.id, reassignAgentId: reassignId, resolutionNote: note || 'Approved.' });
    const next = pending.filter((e) => e.id !== selected.id)[0];
    setSelectedId(next?.id);
    setNote('');
  }
  function decline() {
    if (!selected) return;
    dispatch({ type: 'DECLINE_ESCALATION', id: selected.id, resolutionNote: note || 'Declined — kept with agent.' });
    const next = pending.filter((e) => e.id !== selected.id)[0];
    setSelectedId(next?.id);
    setNote('');
  }

  function agentName(id: string) {
    return state.agents.find((a) => a.id === id)?.name ?? id;
  }

  return (
    <div>
      <SupervisorNav />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', borderBottom: '2px solid var(--color-divider)' }}>
        <Stat label="Waiting on you" value={pending.length} accent />
        <Stat label="Language reroutes" value={reroutes} />
        <Stat label="Wants supervisor" value={wantsSupervisor} />
        <Stat label={`Cleared today · avg ${state.clearedEscalations.length ? Math.round(state.clearedEscalations.reduce((s, c) => s + c.minutes, 0) / state.clearedEscalations.length) : 0} min`} value={state.clearedEscalations.length} last />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', minHeight: 520 }}>
        <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
          <table className="table">
            <thead><tr><th>Raised</th><th>Customer</th><th>App</th><th>Type</th><th>Reason</th><th>From</th><th></th></tr></thead>
            <tbody>
              {pending.map((e) => (
                <tr key={e.id} style={e.id === selected?.id ? { background: 'var(--color-surface)' } : undefined}>
                  <td>{e.raisedAtLabel}</td>
                  <td style={{ fontWeight: 600 }}>{e.userName}<br /><span style={{ fontWeight: 400, color: 'var(--color-neutral-700)' }}>{e.userCity}</span></td>
                  <td style={{ textTransform: 'capitalize' }}>{e.app}</td>
                  <td>{e.type === 'reroute' ? <span className="tag tag-accent">Reroute</span> : <span className="tag tag-outline">Escalation</span>}</td>
                  <td>{e.reason}</td>
                  <td>{agentName(e.raisedByAgentId)}</td>
                  <td><button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => setSelectedId(e.id)}>open</button></td>
                </tr>
              ))}
              {pending.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--color-neutral-700)' }}>Nothing waiting — queue is clear.</td></tr>}
            </tbody>
          </table>

          <div className="eyebrow" style={{ margin: 'var(--space-6) 0 var(--space-2)' }}>Cleared today</div>
          <table className="table" style={{ fontSize: 12 }}>
            <tbody>
              {state.clearedEscalations.map((c) => (
                <tr key={c.id}><td>{c.atLabel}</td><td style={{ fontWeight: 600 }}>{c.name}</td><td>{c.action}</td><td>{c.result}</td><td>{c.minutes} min</td></tr>
              ))}
              {state.clearedEscalations.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--color-neutral-700)' }}>Nothing cleared yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
          {selected ? (
            <>
              <div className="eyebrow">Escalation · {selected.raisedAtLabel}</div>
              <h4 style={{ margin: 'var(--space-2) 0' }}>{selected.userName}</h4>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginBottom: 'var(--space-3)' }}>{selected.userCity} · {selected.app}</div>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-surface)', borderLeft: '2px solid var(--color-accent)', fontSize: 13, lineHeight: 1.55, marginBottom: 'var(--space-3)' }}>
                “{selected.note}”
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 'var(--space-2)' }}>{agentName(selected.raisedByAgentId)} · {selected.reason}</div>
              </div>
              {selected.type === 'reroute' && (
                <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
                  <label htmlFor="es-assign">Reassign to</label>
                  <select className="input" id="es-assign" value={reassignId} onChange={(e) => setReassignId(e.target.value)}>
                    {coveringAgents.map((a) => <option key={a.id} value={a.id}>{a.name} — {selected.targetLanguage}</option>)}
                    <option value="">Keep with {agentName(selected.raisedByAgentId)}</option>
                  </select>
                </div>
              )}
              <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="es-note">Note back to the agent</label>
                <textarea className="input" id="es-note" style={{ minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-block" type="button" style={{ margin: 0 }} onClick={approve}>Approve &amp; reassign</button>
              <button className="btn btn-secondary btn-block" type="button" onClick={decline}>Decline — keep with agent</button>
              <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '2px solid var(--color-divider)', fontSize: 12, color: 'var(--color-neutral-700)', lineHeight: 1.6 }}>
                Approving moves the record's whole call history to the new owner{selected.type === 'reroute' ? ", updates the profile language, and keeps the follow-up date unchanged." : '.'}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--color-neutral-700)' }}>Select an item on the left to review it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent, last }: { label: string; value: React.ReactNode; accent?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: last ? 0 : '1px solid var(--color-divider)' }}>
      <div className="eyebrow">{label}</div>
      <div style={{ font: '800 26px var(--font-heading)', color: accent ? 'var(--color-accent-700)' : undefined }}>{value}</div>
    </div>
  );
}
