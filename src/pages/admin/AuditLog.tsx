import { useMemo, useState } from 'react';
import { ClipboardList, Download } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import type { AuditAction } from '../../data/types';
import { canAnywhere } from '../../lib/access';
import { downloadText } from '../../lib/metrics';
import { Badge, Button, Empty, Input, PageHead, Select, type Tone } from '../../ui/primitives';

const ACTIONS: Record<AuditAction, { label: string; tone: Tone }> = {
  signed_in: { label: 'Signed in', tone: 'neutral' },
  signed_out: { label: 'Signed out', tone: 'neutral' },
  user_created: { label: 'Person added', tone: 'accent' },
  access_changed: { label: 'Access changed', tone: 'accent' },
  user_suspended: { label: 'Suspended', tone: 'danger' },
  user_reactivated: { label: 'Reactivated', tone: 'ok' },
  escalation_approved: { label: 'Escalation approved', tone: 'ok' },
  escalation_declined: { label: 'Escalation declined', tone: 'warn' },
  owner_reassigned: { label: 'Owner changed', tone: 'neutral' },
  queues_distributed: { label: 'Queues distributed', tone: 'neutral' },
  payment_marked_paid: { label: 'Marked paid', tone: 'ok' },
  data_exported: { label: 'Data exported', tone: 'warn' },
};

type Kind = 'all' | 'access' | 'sign-in' | 'customers' | 'exports';
const KIND: Record<Exclude<Kind, 'all'>, AuditAction[]> = {
  access: ['user_created', 'access_changed', 'user_suspended', 'user_reactivated'],
  'sign-in': ['signed_in', 'signed_out'],
  customers: ['escalation_approved', 'escalation_declined', 'owner_reassigned', 'queues_distributed', 'payment_marked_paid'],
  exports: ['data_exported'],
};

/** The change log: who changed what, when. Admins see everyone; supervisors see their own team's changes. */
export default function AuditLog() {
  const { state, currentAgent, dispatch } = useStore();
  const actor = currentAgent!;
  const [kind, setKind] = useState<Kind>('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const team = useMemo(() => new Set(state.agents.filter((a) => a.role === 'agent' || a.id === actor.id).map((a) => a.id)), [state.agents, actor.id]);
  const teamNames = useMemo(() => new Set(state.agents.filter((a) => team.has(a.id)).map((a) => a.name)), [state.agents, team]);

  const rows = state.audit
    .filter((e) => actor.role === 'admin' || team.has(e.actorId) || (e.target && teamNames.has(e.target)))
    .filter((e) => kind === 'all' || KIND[kind].includes(e.action))
    .filter((e) => !who || e.actorId === who)
    .filter((e) => !q.trim() || `${e.actorName} ${e.target ?? ''} ${e.detail}`.toLowerCase().includes(q.trim().toLowerCase()));

  const actors = [...new Map(state.audit.map((e) => [e.actorId, e.actorName])).entries()];

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const text = [['When', 'Who', 'What', 'Target', 'Detail'].map(esc).join(','), ...rows.map((e) => [new Date(e.ts).toISOString(), e.actorName, ACTIONS[e.action]?.label ?? e.action, e.target, e.detail].map(esc).join(','))].join('\n');
    downloadText(`tcc-change-log-${new Date().toISOString().slice(0, 10)}.csv`, text);
    dispatch({ type: 'LOG_EXPORT', actorId: actor.id, detail: `${rows.length} change-log entries exported` });
  }

  return (
    <div className="page">
      <PageHead
        title="Change log"
        desc="Every sign-in, access change, approval and export — who did it and when."
        actions={canAnywhere(actor, 'export') && <Button icon={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />
      <div className="row" style={{ gap: 10 }}>
        <Select aria-label="Kind of change" value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ width: 'auto' }}>
          <option value="all">Every change</option>
          <option value="access">People & access</option>
          <option value="sign-in">Sign-ins</option>
          <option value="customers">Customers & escalations</option>
          <option value="exports">Exports</option>
        </Select>
        <Select aria-label="Who" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Anyone</option>
          {actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Input aria-label="Search the log" placeholder="Search names and details" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      {rows.length === 0 ? (
        <Empty icon={<ClipboardList size={22} />} title="Nothing logged yet">Changes to people, approvals and exports appear here as they happen.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{new Date(e.ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
                  <td style={{ fontWeight: 500 }}>{e.actorName}</td>
                  <td><Badge tone={ACTIONS[e.action]?.tone ?? 'neutral'}>{ACTIONS[e.action]?.label ?? e.action}</Badge></td>
                  <td>{e.target && <b style={{ fontWeight: 500 }}>{e.target} · </b>}{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
