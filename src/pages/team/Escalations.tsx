import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Flag } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { APPS } from '../../data/seed';
import { LANGUAGE_SCRIPT } from '../../lib/access';
import { CUSTOMER_LANGUAGES } from '../../lib/languages';
import { textMatch } from '../../lib/filters';
import { FilterBar, SearchFilter, SelectFilter, useFilters } from '../../ui/filters';
import { Badge, Button, Card, Empty, Field, PageHead, Select, Stat, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';
import '../customer.css';

export default function Escalations() {
  const { state, dispatch, currentAgent } = useStore();
  const { apps } = useScope();
  const toast = useToast();
  const pending = state.escalations.filter((e) => e.status === 'pending' && apps.includes(e.app));
  const { values: f, set, reset, active } = useFilters(['eq', 'etype', 'eurg', 'eprod', 'elang', 'eby'] as const);
  const shown = pending
    .filter((e) => !f.etype || e.type === f.etype)
    .filter((e) => !f.eurg || e.urgency === f.eurg)
    .filter((e) => !f.eprod || e.app === f.eprod)
    .filter((e) => !f.elang || e.targetLanguage === f.elang)
    .filter((e) => !f.eby || e.raisedByAgentId === f.eby)
    .filter((e) => textMatch(f.eq, e.userName, e.userCity, e.reason, e.note));
  const raisers = [...new Set(pending.map((e) => e.raisedByAgentId))];
  const [selectedId, setSelectedId] = useState<string | undefined>(pending[0]?.id);
  const selected = shown.find((e) => e.id === selectedId) ?? shown[0];
  const covering = selected?.targetLanguage ? state.agents.filter((a) => a.role === 'agent' && a.apps.includes(selected.app) && a.languages.includes(selected.targetLanguage!) && (a.status ?? 'active') === 'active') : [];
  const [reassign, setReassign] = useState<string>('');
  const [note, setNote] = useState('');
  const name = (id: string) => state.agents.find((a) => a.id === id)?.name ?? 'Unknown';
  const avgMinutes = state.clearedEscalations.length ? Math.round(state.clearedEscalations.reduce((n, c) => n + c.minutes, 0) / state.clearedEscalations.length) : null;

  function decide(approve: boolean) {
    if (!selected) return;
    const actorId = currentAgent!.id;
    if (approve) dispatch({ type: 'APPROVE_ESCALATION', id: selected.id, reassignAgentId: reassign || selected.suggestedOwnerId || covering[0]?.id, resolutionNote: note, actorId });
    else dispatch({ type: 'DECLINE_ESCALATION', id: selected.id, resolutionNote: note, actorId });
    toast(approve ? `Approved — ${selected.userName}` : `Declined — ${selected.userName} stays with ${name(selected.raisedByAgentId)}`);
    setSelectedId(shown.find((e) => e.id !== selected.id)?.id);
    setNote('');
    setReassign('');
  }

  return (
    <div className="page">
      <PageHead title="Escalations" desc="Customers agents have handed up — language reroutes and things that need a supervisor." />
      <div className="stats">
        <Stat label="Waiting on you" value={pending.length} tone={pending.length ? 'warn' : undefined} />
        <Stat label="Language reroutes" value={pending.filter((e) => e.type === 'reroute').length} />
        <Stat label="Need a supervisor" value={pending.filter((e) => e.type === 'escalation').length} note={`${pending.filter((e) => e.urgency === 'urgent').length} urgent`} />
        <Stat label="Cleared recently" value={state.clearedEscalations.length} note={avgMinutes !== null ? `${avgMinutes} min to clear on average` : undefined} />
      </div>

      {pending.length > 0 && (
        <FilterBar active={active} onReset={reset} shown={shown.length} total={pending.length} noun="waiting">
          <SearchFilter value={f.eq} onChange={(v) => set('eq', v)} placeholder="Customer, city or reason" label="Find an escalation" />
          <SelectFilter label="Need" value={f.etype} onChange={(v) => set('etype', v)} options={[{ value: 'reroute', label: 'Language reroute' }, { value: 'escalation', label: 'Needs a supervisor' }]} />
          <SelectFilter label="Urgency" value={f.eurg} onChange={(v) => set('eurg', v)} options={[{ value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }]} />
          {apps.length > 1 && <SelectFilter label="Product" value={f.eprod} onChange={(v) => set('eprod', v)} options={APPS.filter((a) => apps.includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
          <SelectFilter label="Language asked for" value={f.elang} onChange={(v) => set('elang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
          <SelectFilter label="Raised by" value={f.eby} onChange={(v) => set('eby', v)} options={raisers.map((id) => ({ value: id, label: name(id) }))} />
        </FilterBar>
      )}

      {pending.length === 0 ? (
        <Card><Empty icon={<CheckCircle2 size={24} />} title="Nothing waiting">When an agent reroutes or escalates a customer, it shows up here.</Empty></Card>
      ) : shown.length === 0 ? (
        <Card><Empty title="Nothing matches">Try clearing a filter.</Empty></Card>
      ) : (
        <div className="cust-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 400px)' }}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Raised</th><th>Customer</th><th>Need</th><th>From</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className={`is-clickable${e.id === selected?.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(e.id)}>
                    <td className="mono" style={{ fontSize: 13 }}>{e.raisedAtLabel}</td>
                    <td>
                      <b style={{ fontWeight: 500 }}>{e.userName}</b>
                      <div className="muted" style={{ fontSize: 12.5 }}>{e.userCity} · {APPS.find((a) => a.id === e.app)?.name}</div>
                    </td>
                    <td>
                      {e.type === 'reroute' ? <Badge tone="accent">Speaks {e.targetLanguage}</Badge> : <Badge tone={e.urgency === 'urgent' ? 'danger' : 'warn'}>{e.reason}{e.urgency === 'urgent' ? ' · urgent' : ''}</Badge>}
                    </td>
                    <td>{name(e.raisedByAgentId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <Card title={selected.userName} sub={`${selected.type === 'reroute' ? 'Language reroute' : 'Escalation'} · raised ${selected.raisedAtLabel} by ${name(selected.raisedByAgentId)}`} actions={<Link to={`/customers/${selected.userId}`} className="btn btn--sm">Customer</Link>}>
              <div className="stack" style={{ gap: 14 }}>
                <blockquote style={{ margin: 0, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', lineHeight: 1.55 }}>“{selected.note}”</blockquote>
                {selected.type === 'reroute' && (
                  <Field label={`Give to someone who speaks ${selected.targetLanguage ? `${LANGUAGE_SCRIPT[selected.targetLanguage]} · ${selected.targetLanguage}` : 'their language'}`} htmlFor="es-to">
                    <Select id="es-to" value={reassign || selected.suggestedOwnerId || ''} onChange={(e) => setReassign(e.target.value)}>
                      {covering.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === selected.suggestedOwnerId ? ' — suggested' : ''}</option>)}
                      <option value="">Nobody — keep with {name(selected.raisedByAgentId)}</option>
                    </Select>
                  </Field>
                )}
                <Field label="Note back to the agent" htmlFor="es-note">
                  <Textarea id="es-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={selected.type === 'reroute' ? 'Handing to Divya — she covers Malayalam.' : 'Offer 10% on annual, I’ve approved it.'} />
                </Field>
                <div className="row">
                  <Button variant="primary" icon={<Flag size={15} />} onClick={() => decide(true)}>{selected.type === 'reroute' ? 'Approve and reassign' : 'Approve'}</Button>
                  <Button onClick={() => decide(false)}>Decline</Button>
                </div>
                <span className="muted" style={{ fontSize: 13 }}>Every decision is written to the change log.</span>
              </div>
            </Card>
          )}
        </div>
      )}

      {state.clearedEscalations.length > 0 && (
        <Card title="Recently cleared" pad={false}>
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl">
              <tbody>
                {state.clearedEscalations.map((c) => (
                  <tr key={c.id}><td className="mono" style={{ fontSize: 13 }}>{c.atLabel}</td><td><b style={{ fontWeight: 500 }}>{c.name}</b></td><td>{c.action}</td><td>{c.result}</td><td className="r mono">{c.minutes} min</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
