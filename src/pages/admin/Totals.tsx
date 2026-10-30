// The super admin's "everything in TCC" on the Overview: how many customers, calls, follow-ups, notes, escalations
// and people there are, overall and per product. Follows the product picker in the header. Counted in
// src/lib/totals.ts; notes come from the server, since each person's browser only holds their own.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { APPS } from '../../data/seed';
import { QUEUES } from '../../data/types';
import { countEverything, type NoteCount, type Totals } from '../../lib/totals';
import { notesCall } from '../../lib/notes';
import { durationLabel } from '../../lib/metrics';
import { BarList } from '../../ui/charts';
import { Stat } from '../../ui/primitives';

const n = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-IN'));
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/** A small second line under a number in the by-product table. */
const Sub = ({ children }: { children: ReactNode }) => <div className="muted whitespace-nowrap" style={{ fontSize: 12 }}>{children}</div>;

function Breakdown({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function SuperAdminTotals() {
  const { state, backend } = useStore();
  const { apps } = useScope();
  const [notes, setNotes] = useState<NoteCount[] | null>(null);

  useEffect(() => {
    if (backend !== 'server') return;
    let live = true;
    notesCall<{ notes: NoteCount[] }>('GET', '/api/system/counts').then((r) => live && setNotes(r.notes)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend]);

  const { overall: t, byApp } = useMemo(
    () => countEverything({ users: state.users, agents: state.agents, escalations: state.escalations, notes }, apps),
    [state.users, state.agents, state.escalations, notes, apps],
  );
  const products = APPS.filter((a) => apps.includes(a.id));

  return (
    <section className="stack" aria-labelledby="totals-head">
      <div>
        <h2 id="totals-head" className="text-base font-semibold">Everything in TCC</h2>
        <p className="text-muted-foreground" style={{ fontSize: 13.5 }}>
          All-time totals{products.length === 1 ? ` for ${products[0].name}` : ' across every product'}. Only you see this.
        </p>
      </div>

      <div className="stats">
        <Stat label="Customers" value={n(t.customers)} note={`${n(t.fromProduct)} from the product · ${n(t.addedInTcc)} added in TCC`} />
        <Stat label="Calls made" value={n(t.calls)} note={`${n(t.connected)} connected (${pct(t.connected, t.calls)}) · ${n(t.callsToday)} today`} />
        <Stat label="Talk time" value={durationLabel(t.talkSec)} note={`${n(t.incoming)} incoming calls`} />
        <Stat label="Follow-ups" value={n(t.followUps)} tone={t.followUpsOverdue ? 'warn' : undefined} note={`${n(t.followUpsOverdue)} overdue · ${n(t.followUpsToday)} today`} />
        <Stat label="Notes" value={n(t.notes)} note={t.notes === null ? 'Kept on TCC’s server only' : `${n(t.notesForAgents)} left for agents`} />
        <Stat label="Escalations" value={n(t.escalations)} tone={t.escalationsWaiting ? 'warn' : undefined} note={`${n(t.escalationsWaiting)} waiting · ${n(t.escalationsUrgent)} urgent`} />
        <Stat label="Positive / negative" value={`${n(t.positive)} / ${n(t.negative)}`} note={`${n(t.neverCalled)} customers never called`} />
        <Stat label="Agents" value={n(t.agents)} note={`${n(t.supervisors)} supervisors · ${n(t.admins)} admins`} />
      </div>

      {products.length > 1 && (
        <Card>
          <div className="px-4 pt-3 pb-2 text-base font-semibold">By product</div>
          <div style={{ overflowX: 'auto' }}>
            <Table>
              <TableHeader>
                <TableRow data-head>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Follow-ups</TableHead>
                  <TableHead className="text-right">Notes</TableHead>
                  <TableHead className="text-right">Escalations</TableHead>
                  <TableHead className="text-right">Agents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((a) => {
                  const r: Totals = byApp[a.id];
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.customers)}{r.fromProduct > 0 && <Sub>{n(r.fromProduct)} from {a.name}</Sub>}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.calls)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.connected)}{r.calls > 0 && <Sub>{pct(r.connected, r.calls)}</Sub>}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.followUps)}{r.followUpsOverdue > 0 && <Sub>{n(r.followUpsOverdue)} overdue</Sub>}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.notes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.escalations)}{r.escalationsWaiting > 0 && <Sub>{n(r.escalationsWaiting)} waiting</Sub>}</TableCell>
                      <TableCell className="text-right tabular-nums">{n(r.agents)}{r.supervisors > 0 && <Sub>+ {n(r.supervisors)} supervisor{r.supervisors === 1 ? '' : 's'}</Sub>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {t.notes !== null && t.notes > products.reduce((s, a) => s + (byApp[a.id].notes ?? 0), 0) && (
            <p className="muted px-4 pb-3" style={{ fontSize: 12.5 }}>Notes written for every product count in the total above, not under one product.</p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Breakdown title="Customers by call list">
          <BarList
            ariaLabel="Customers by call list"
            data={[
              ...QUEUES.map((q) => ({ label: q.label, value: t.byQueue[q.key] ?? 0 })),
              { label: 'In no list', value: t.byQueue.none, color: 'var(--series-4)' },
            ]}
          />
          <p className="muted mt-3" style={{ fontSize: 12.5 }}>Lists in the order agents work them: the top one first.</p>
        </Breakdown>
        <Breakdown title="Calls by result">
          <BarList ariaLabel="Calls by result" data={Object.entries(t.byStatus).map(([label, value]) => ({ label, value, color: label.startsWith('Answered') ? undefined : 'var(--series-4)' }))} />
          <p className="muted mt-3" style={{ fontSize: 12.5 }}>
            {n(t.calls7d)} calls in the last 7 days. <Link to="/calls" className="text-primary">See every call</Link>
          </p>
        </Breakdown>
        <Breakdown title="Follow-ups">
          <BarList
            ariaLabel="Follow-ups by kind"
            data={[
              { label: 'Date an agent set', value: t.followUpsByKind.agent },
              { label: 'Daily retry', note: 'No answer yet: called every day for 14 days', value: t.followUpsByKind.auto },
              { label: 'Weekly (positive)', value: t.followUpsByKind.weekly },
              { label: 'Overdue', value: t.followUpsOverdue, color: 'var(--warn)' },
            ]}
          />
          <p className="muted mt-3" style={{ fontSize: 12.5 }}><Link to="/follow-ups?when=upcoming" className="text-primary">Open follow-ups</Link></p>
        </Breakdown>
        <Breakdown title="Escalations">
          <BarList
            ariaLabel="Escalations by state"
            data={[
              { label: 'Waiting', value: t.escalationsWaiting, color: 'var(--warn)' },
              { label: 'Of those, urgent', value: t.escalationsUrgent, color: 'var(--danger)' },
              { label: 'Approved', value: t.escalationsApproved },
              { label: 'Declined', value: t.escalationsDeclined, color: 'var(--series-4)' },
            ]}
          />
          <p className="muted mt-3" style={{ fontSize: 12.5 }}><Link to="/escalations" className="text-primary">Open escalations</Link></p>
        </Breakdown>
      </div>
    </section>
  );
}
