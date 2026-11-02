// New customers and the call lists at a glance, for supervisors and admins: who signed up today, what is in the lists,
// how much is already with an agent, how much waits and why — language by language, since customers only ever go to
// someone who speaks theirs (src/lib/assignment.ts).

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { usePresence } from '../../lib/usePresence';
import { queueSnapshot, signUps } from '../../lib/pipeline';
import { QUEUES } from '../../data/types';
import { Badge } from '../../ui/primitives';

export function Pipeline({ extra = [] }: { extra?: { label: string; value: string | number; note?: string }[] }) {
  const { state } = useStore();
  const { apps } = useScope();
  const { people, now } = usePresence();
  const users = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const agents = useMemo(() => state.agents.filter((a) => a.role === 'agent' && a.apps.some((x) => apps.includes(x))), [state.agents, apps]);
  const online = useMemo(() => new Set((people ?? []).filter((p) => p.online).map((p) => p.id)), [people]);
  const clock = people ? now : Date.now();
  const sign = useMemo(() => signUps(users), [users]);
  const snap = useMemo(() => queueSnapshot(users, agents, online, clock), [users, agents, online, clock]);

  const stats: { label: string; value: string | number; note?: string; to?: string }[] = [
    { label: 'Signed up today', value: sign.today, note: `${sign.yesterday} yesterday · ${sign.last7} in 7 days`, to: '/installs' },
    { label: 'New installs list', value: snap.lists.find((l) => l.key === 'new')?.total ?? 0, note: 'see who they are', to: '/installs?ip=list' },
    { label: 'With an agent', value: snap.held, note: `of ${snap.total} in the lists` },
    { label: 'Waiting', value: snap.waiting, note: snap.noAgentOnline ? `${snap.noAgentOnline}: nobody signed in speaks their language` : 'handed out as agents finish' },
    ...extra,
  ];

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((st) => {
          const body = (
            <>
              <div className="text-xs text-muted-foreground">{st.label}</div>
              <div className="text-2xl leading-tight font-semibold tabular-nums">{typeof st.value === 'number' ? st.value.toLocaleString('en-IN') : st.value}</div>
              {st.note && <div className="text-xs text-muted-foreground">{st.note}</div>}
            </>
          );
          return st.to ? (
            <Link key={st.label} to={st.to} className="rounded-lg border border-border bg-card p-3 hover:bg-secondary/50">{body}</Link>
          ) : (
            <div key={st.label} className="rounded-lg border border-border bg-card p-3">{body}</div>
          );
        })}
      </div>

      {sign.undated > 0 && (
        <p className="text-sm text-muted-foreground">
          {sign.undated.toLocaleString('en-IN')} customers came from the product without a sign-up date, so they can’t be counted as signed up on a day{sign.undatedNew ? ` (${sign.undatedNew} at the first step)` : ''}.
        </p>
      )}

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Call lists and languages</summary>
        <div className="grid grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-2">
          <Table>
            <TableHeader><TableRow data-head><TableHead>List</TableHead><TableHead className="text-right">In list</TableHead><TableHead className="text-right">With an agent</TableHead><TableHead className="text-right">Waiting</TableHead></TableRow></TableHeader>
            <TableBody>
              {snap.lists.map((l) => (
                <TableRow key={l.key}>
                  <TableCell className="font-medium">{QUEUES.find((q) => q.key === l.key)?.label ?? l.key}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.total}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.held}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.waiting}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table>
            <TableHeader><TableRow data-head><TableHead>Language</TableHead><TableHead className="text-right">Today</TableHead><TableHead className="text-right">In lists</TableHead><TableHead className="text-right">Waiting</TableHead><TableHead className="text-right">Agents on</TableHead></TableRow></TableHeader>
            <TableBody>
              {snap.byLanguage.map((r) => (
                <TableRow key={r.language}>
                  <TableCell className="font-medium">{r.language}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.signedToday}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.inQueue}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.waiting}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {people ? r.onlineAgents : '…'}
                    {people && r.waiting > 0 && r.onlineAgents === 0 && <> <Badge tone="danger">Nobody</Badge></>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}
