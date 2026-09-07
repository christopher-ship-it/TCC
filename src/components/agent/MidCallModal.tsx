import { useState } from 'react';
import { useStore } from '../../store/StoreContext';
import type { CustomerUser, Language } from '../../data/types';

const LANGUAGES: Language[] = ['Telugu', 'Kannada', 'Malayalam', 'Hindi', 'Bengali', 'English'];

export default function MidCallModal({ user, onClose }: { user: CustomerUser; onClose: () => void }) {
  const { state, dispatch, currentAgent } = useStore();
  const [tab, setTab] = useState<'reroute' | 'escalate'>('reroute');
  const defaultLang = LANGUAGES.find((l) => !currentAgent?.languages.includes(l)) ?? LANGUAGES[0];
  const [lang, setLang] = useState<Language>(defaultLang);
  const [note, setNote] = useState(`Customer could not follow ${currentAgent?.languages[0] ?? 'Tamil'}, asked for ${defaultLang}.`);
  const [reason, setReason] = useState('Pricing question');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const coveringAgents = currentAgent ? state.agents.filter((a) => a.role === 'agent' && a.apps.includes(user.app) && a.languages.includes(lang) && a.id !== currentAgent.id) : [];
  const [suggestedOwnerId, setSuggestedOwnerId] = useState<string | undefined>(coveringAgents[0]?.id);

  if (!currentAgent) return null;

  function submit() {
    const agent = currentAgent!;
    if (tab === 'reroute') {
      dispatch({ type: 'REQUEST_REROUTE', userId: user.id, agentId: agent.id, targetLanguage: lang, suggestedOwnerId, note });
    } else {
      dispatch({ type: 'REQUEST_ESCALATE', userId: user.id, agentId: agent.id, reason, urgency, note });
    }
    onClose();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ width: 'min(640px,100%)' }} onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="eyebrow">On call · {user.city}, {user.effectiveState}</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22 }}>{user.name} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-neutral-700)' }}>· {user.shopCode}</span></div>
        </div>
        <div className="seg" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" onClick={() => setTab('reroute')} style={{ padding: 10, border: 0, background: tab === 'reroute' ? 'var(--color-accent)' : 'var(--color-neutral-100)', color: tab === 'reroute' ? 'var(--color-bg)' : 'inherit', font: '800 13px var(--font-heading)', cursor: 'pointer' }}>Reroute — language</button>
          <button type="button" onClick={() => setTab('escalate')} style={{ padding: 10, border: 0, background: tab === 'escalate' ? 'var(--color-accent)' : 'var(--color-neutral-100)', color: tab === 'escalate' ? 'var(--color-bg)' : 'inherit', font: '800 13px var(--font-heading)', cursor: 'pointer' }}>Escalate — supervisor</button>
        </div>

        {tab === 'reroute' ? (
          <>
            <div className="field">
              <label htmlFor="mc-lang">Language the customer actually speaks</label>
              <select className="input" id="mc-lang" value={lang} onChange={(e) => { const v = e.target.value as Language; setLang(v); const next = state.agents.filter((a) => a.role === 'agent' && a.apps.includes(user.app) && a.languages.includes(v) && a.id !== currentAgent.id); setSuggestedOwnerId(next[0]?.id); }}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-surface)', borderLeft: '2px solid var(--color-accent)', fontSize: 12, lineHeight: 1.5 }}>
              You hold <strong>{currentAgent.languages.join(', ')}</strong>. {coveringAgents.length > 0 ? <>Agents who cover {lang}: <strong>{coveringAgents.map((a) => a.name).join(', ')}</strong>.</> : <>No agent currently covers {lang} — this will need a new hire or cross-training.</>} The reroute needs supervisor approval; until then the record stays with you.
            </div>
            <div className="field">
              <label htmlFor="mc-owner">Suggested owner</label>
              <select className="input" id="mc-owner" value={suggestedOwnerId} onChange={(e) => setSuggestedOwnerId(e.target.value)}>
                {coveringAgents.map((a) => <option key={a.id} value={a.id}>{a.name} — {lang}</option>)}
                <option value="">Any {lang} agent — supervisor decides</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="mc-reason">Reason</label>
              <select className="input" id="mc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {['Pricing question', 'Complaint', 'Refund request', 'Technical issue', 'Wants the manager'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="mc-urgency">Urgency</label>
              <select className="input" id="mc-urgency" value={urgency} onChange={(e) => setUrgency(e.target.value as 'normal' | 'urgent')}>
                <option value="normal">Normal — callback within a day</option>
                <option value="urgent">Urgent — customer waiting</option>
              </select>
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="mc-note">What happened on the call</label>
          <textarea className="input" id="mc-note" style={{ minHeight: 72 }} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" type="button" onClick={submit}>{tab === 'reroute' ? 'Request reroute' : 'Escalate to supervisor'}</button>
        </div>
      </div>
    </div>
  );
}
