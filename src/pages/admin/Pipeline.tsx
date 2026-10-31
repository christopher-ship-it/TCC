// New customers and the call lists at a glance, for supervisors and admins: who signed up today, what is in the lists,
// how much is already with an agent, how much waits and why — language by language, since customers only ever go to
// someone who speaks theirs (src/lib/assignment.ts).

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { usePresence } from '../../lib/usePresence';
import { queueSnapshot, signUps } from '../../lib/pipeline';
import { QUEUES } from '../../data/types';
import { Badge } from '../../ui/primitives';

export function Pipeline() {
  const { state } = useStore();
  const { apps } = useScope();
  const { people, now } = usePresence();
  const users = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const agents = useMemo(() => state.agents.filter((a) => a.role === 'agent' && a.apps.some((x) => apps.includes(x))), [state.agents, apps]);
  const online = useMemo(() => new Set((people ?? []).filter((p) => p.online).map((p) => p.id)), [people]);
  const clock = people ? now : Date.now();
  const sign = useMemo(() => signUps(users), [users]);
  const snap = useMemo(() => queueSnapshot(users, agents, online, clock), [users, agents, online, clock]);

  const stats: [string, number, string?][] = [
    ['Signed up today', sign.today, `${sign.yesterday} yesterday · ${sign.last7} in 7 days`],
    ['In the call lists', snap.total, 'New installs, No answer, Follow-up'],
    ['With an agent', snap.held, 'handed out, 5 at a time'],
    ['Waiting', snap.waiting, snap.noAgentOnline ? `${snap.noAgentOnline} with nobody signed in who speaks their language` : 'handed out as agents finish'],
  ];

  return (
    <Card>
      <div className="px-4 pt-3 pb-1 text-base font-semibold">New customers and the call lists</div>
      <CardContent className="stack" style={{ gap: 14 }}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(([label, value, note]) => (
            <Card key={label}>
              <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
              <CardContent>
                <div className="text-[28px] leading-tight font-semibold tabular-nums">{value.toLocaleString('en-IN')}</div>
                {note && <div className="text-xs text-muted-foreground">{note}</div>}
              </CardContent>
            </Card>
          ))}
        </div>

        {sign.undated > 0 && (
          <p className="text-sm text-muted-foreground">
            {sign.undated.toLocaleString('en-IN')} customers came from the product without a sign-up date, so they can’t be counted as signed up on a day{sign.undatedNew ? ` (${sign.undatedNew} of them at the first step)` : ''}. They never join New installs until the product sends the date.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
            <TableHeader><TableRow data-head><TableHead>Language</TableHead><TableHead className="text-right">Signed up today</TableHead><TableHead className="text-right">In lists</TableHead><TableHead className="text-right">Waiting</TableHead><TableHead className="text-right">Agents signed in</TableHead></TableRow></TableHeader>
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
      </CardContent>
    </Card>
  );
}
