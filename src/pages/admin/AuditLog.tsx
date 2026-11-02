import { useMemo, useState } from 'react';
import { ClipboardList, Download } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import type { AuditAction } from '../../data/types';
import { canAnywhere } from '../../lib/access';
import { downloadText } from '../../lib/metrics';
import { Badge, Button, Empty, PageHead, Select, type Tone } from '../../ui/primitives';
import { SearchFilter, SelectFilter, useFilters } from '../../ui/filters';
import { notesCall } from '../../lib/notes';
import { DATE_RANGES, dateWindow, inWindow, type DateRange } from '../../lib/filters';
import { Pager, usePaged } from '../../ui/Pager';

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
  customers_imported: { label: 'Customers imported', tone: 'accent' },
  customer_deleted: { label: 'Customer deleted', tone: 'danger' },
};

type Kind = 'all' | 'access' | 'sign-in' | 'customers' | 'exports';
const KIND: Record<Exclude<Kind, 'all'>, AuditAction[]> = {
  access: ['user_created', 'access_changed', 'user_suspended', 'user_reactivated'],
  'sign-in': ['signed_in', 'signed_out'],
  customers: ['escalation_approved', 'escalation_declined', 'owner_reassigned', 'queues_distributed', 'payment_marked_paid', 'customers_imported', 'customer_deleted'],
  exports: ['data_exported'],
};

/** The change log: who changed what, when. Admins see everyone; supervisors see their own team's changes. */
export default function AuditLog() {
  const { state, currentAgent, dispatch, backend } = useStore();
  const actor = currentAgent!;
  const [kind, setKind] = useState<Kind>('all');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const { values: af, set: setAf, reset: resetAf, active: afActive } = useFilters(['adate'] as const);
  const win = dateWindow((af.adate || 'any') as DateRange);
  const team = useMemo(() => new Set(state.agents.filter((a) => a.role === 'agent' || a.id === actor.id).map((a) => a.id)), [state.agents, actor.id]);
  const teamNames = useMemo(() => new Set(state.agents.filter((a) => team.has(a.id)).map((a) => a.name)), [state.agents, team]);

  const [older, setOlder] = useState<typeof state.audit>([]);
  const [more, setMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const everything = useMemo(() => {
    const seen = new Set<string>();
    return [...state.audit, ...older].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((x, y) => y.ts - x.ts);
  }, [state.audit, older]);
  const rows = everything
    .filter((e) => actor.role === 'admin' || team.has(e.actorId) || (e.target && teamNames.has(e.target)))
    .filter((e) => kind === 'all' || KIND[kind].includes(e.action))
    .filter((e) => !who || e.actorId === who)
    .filter((e) => inWindow(e.ts, win))
    .filter((e) => !q.trim() || `${e.actorName} ${e.target ?? ''} ${e.detail}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function loadOlder() {
    setLoadingOlder(true);
    try {
      const before = everything.length ? everything[everything.length - 1].ts : Date.now();
      const r = await notesCall<{ entries: typeof state.audit; more: boolean }>('GET', `/api/audit/page?before=${before}`);
      setOlder((cur) => [...cur, ...r.entries]);
      setMore(r.more);
    } catch {
      setMore(null);
    } finally {
      setLoadingOlder(false);
    }
  }

  const { items: pageRows, pager } = usePaged(rows, `${kind}|${who}|${q}|${af.adate}`);

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
        <SelectFilter label="When" value={af.adate} onChange={(v) => setAf('adate', v)} all="Any time" options={DATE_RANGES.filter((r) => r.value !== 'any').map((r) => ({ value: r.value, label: r.label }))} />
        <SearchFilter value={q} onChange={setQ} placeholder="Search names and details" label="Search the log" />
        {(afActive > 0 || kind !== 'all' || who || q) && <button type="button" className="btn btn--sm btn--ghost" onClick={() => { resetAf(); setKind('all'); setWho(''); setQ(''); }}>Clear filters</button>}
        <span className="muted" style={{ fontSize: 13, marginLeft: 'auto' }}>{rows.length.toLocaleString('en-IN')} entries</span>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<ClipboardList size={22} />} title="Nothing logged yet">Changes to people, approvals and exports appear here as they happen.</Empty>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {pageRows.map((e) => (
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
      {rows.length > 0 && <Pager pager={pager} noun="changes" />}
      {backend === 'server' && (
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <Button onClick={() => void loadOlder()} disabled={loadingOlder || more === false}>{loadingOlder ? 'Loading…' : more === false ? 'That is everything' : 'Load 100 older'}</Button>
          <a className="btn btn--sm" href="/api/logs/export?kind=activity&days=730" download>Download the full log (CSV)</a>
          <span className="muted" style={{ fontSize: 12.5 }}>The screen loads the latest 100. Older entries are kept for 90 days here and then archived, and the download includes them.</span>
        </div>
      )}
    </div>
  );
}
