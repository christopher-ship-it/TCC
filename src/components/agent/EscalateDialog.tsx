import { useState } from 'react';
import { useStore } from '../../store/StoreContext';
import type { CustomerUser, Language } from '../../data/types';
import { LANGUAGE_SCRIPT } from '../../lib/access';
import { CUSTOMER_LANGUAGES } from '../../lib/languages';
import { Button, Callout, Field, Segmented, Select, Sheet, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';

/** Hand a customer on: to an agent who speaks their language (reroute), or up to a supervisor (escalate). */
export function EscalateDialog({ user, onClose }: { user: CustomerUser; onClose: () => void }) {
  const { state, dispatch, currentAgent } = useStore();
  const toast = useToast();
  const agent = currentAgent!;
  const others = CUSTOMER_LANGUAGES.filter((l) => !agent.languages.includes(l));
  const [tab, setTab] = useState<'reroute' | 'escalate'>('reroute');
  const [lang, setLang] = useState<Language>(others[0] ?? 'Hindi');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('Pricing question');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const covering = state.agents.filter((a) => a.role === 'agent' && a.id !== agent.id && a.apps.includes(user.app) && a.languages.includes(lang) && (a.status ?? 'active') === 'active');
  const [owner, setOwner] = useState<string>('');

  function submit() {
    if (tab === 'reroute') {
      dispatch({ type: 'REQUEST_REROUTE', userId: user.id, agentId: agent.id, targetLanguage: lang, suggestedOwnerId: owner || covering[0]?.id, note: note || `Customer asked for ${lang}.` });
      toast(`Reroute to a ${lang} speaker sent for approval`);
    } else {
      dispatch({ type: 'REQUEST_ESCALATE', userId: user.id, agentId: agent.id, reason, urgency, note: note || reason });
      toast('Escalated to your supervisor');
    }
    onClose();
  }

  return (
    <Sheet
      kind="dialog"
      title={`Hand on ${user.name}`}
      desc={`${user.business} · ${user.city}`}
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 13 }}>The customer stays with you until a supervisor decides.</span>
          <span style={{ marginLeft: 'auto' }} />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{tab === 'reroute' ? 'Request reroute' : 'Escalate'}</Button>
        </>
      }
    >
      <Segmented label="What do you need" value={tab} onChange={setTab} options={[{ value: 'reroute', label: 'Different language' }, { value: 'escalate', label: 'Needs a supervisor' }]} />
      {tab === 'reroute' ? (
        <>
          <Field label="Language the customer speaks" htmlFor="esc-lang">
            <Select id="esc-lang" value={lang} onChange={(e) => { setLang(e.target.value as Language); setOwner(''); }}>
              {CUSTOMER_LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_SCRIPT[l] !== l ? `${LANGUAGE_SCRIPT[l]} · ${l}` : l}</option>)}
            </Select>
          </Field>
          <Callout tone={covering.length ? 'accent' : 'warn'}>
            {covering.length ? <>Agents who speak {lang}: <b>{covering.map((a) => a.name).join(', ')}</b>.</> : <>Nobody on the team covers {lang} for this app yet — a supervisor will decide.</>}
          </Callout>
          {covering.length > 0 && (
            <Field label="Suggest who should take it" htmlFor="esc-owner">
              <Select id="esc-owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {covering.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                <option value="">Any {lang} speaker — supervisor decides</option>
              </Select>
            </Field>
          )}
        </>
      ) : (
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="Reason" htmlFor="esc-reason">
            <Select id="esc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              {['Pricing question', 'Complaint', 'Refund request', 'Technical issue', 'Wants the manager'].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="How soon" htmlFor="esc-urg">
            <Select id="esc-urg" value={urgency} onChange={(e) => setUrgency(e.target.value as 'normal' | 'urgent')}>
              <option value="normal">Within a day</option>
              <option value="urgent">Now — customer is waiting</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label="What happened" htmlFor="esc-note">
        <Textarea id="esc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Wants the annual plan but needs a GST invoice first." />
      </Field>
    </Sheet>
  );
}
