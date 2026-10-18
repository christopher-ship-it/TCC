// The one home page for supervisors and admins: four numbers, two charts, and the agents. Everything else is one
// click away — a row opens that agent's detail. (The older Team performance / Geography / Allocation pages are
// switched off in src/lib/features.ts, not deleted.)

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useStore } from '../store/StoreContext';
import { useScope } from '../shell/scope';
import { agentScores, allCalls, callsByDay, DAY, durationLabel, isConnected, outcomeCounts, type AgentScore } from '../lib/metrics';
import { MetricChart } from '../ui/MetricChart';
import { BarList } from '../ui/charts';
import { CallRowItem } from '../components/calls/CallRowItem';
import { PageHead } from '../ui/primitives';

export default function Overview() {
  const { state } = useStore();
  const { apps } = useScope();
  const [open, setOpen] = useState<AgentScore | null>(null);

  const startOfToday = useMemo(() => new Date().setHours(0, 0, 0, 0), []);
  const week = useMemo(() => allCalls(state.users, { apps, since: startOfToday - 6 * DAY }), [state.users, apps, startOfToday]);
  const all = useMemo(() => allCalls(state.users, { apps }), [state.users, apps]);
  const today = week.filter((r) => r.call.atTs >= startOfToday);
  const daily = useMemo(() => callsByDay(all, 14), [all]);
  const agents = state.agents.filter((a) => a.role === 'agent' && a.apps.some((x) => apps.includes(x)));
  const scores = useMemo(() => agentScores(week, agents), [week, agents]);
  const openTickets = state.users.filter((u) => apps.includes(u.app) && u.queue === 'tickets').length;
  const callsToday = (name: string) => today.filter((r) => r.call.agentName === name).length;
  const activeToday = new Set(today.map((r) => r.call.agentName)).size;

  return (
    <div className="page">
      <PageHead title="Overview" desc="What the calling team did today. Click an agent for the detail." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Calls today', today.length],
          ['Connected', today.filter((r) => isConnected(r.call)).length],
          ['Open tickets', openTickets],
          ['Agents calling', `${activeToday} / ${agents.length}`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
            <CardContent><div className="text-[28px] leading-tight font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</div></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MetricChart title="Calls per day" value={daily.reduce((n, d) => n + d.connected + d.missed, 0).toLocaleString('en-IN')} note="last 14 days" data={daily.map((d) => ({ label: d.label, value: d.connected + d.missed }))} height={150} />
        <MetricChart title="Connected calls" value={daily.reduce((n, d) => n + d.connected, 0).toLocaleString('en-IN')} note="last 14 days" data={daily.map((d) => ({ label: d.label, value: d.connected }))} height={150} />
      </div>

      <Card>
        <div className="px-4 pt-3 pb-2 text-base font-semibold">Agents</div>
        <Table>
          <TableHeader>
            <TableRow data-head>
              <TableHead>Agent</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead className="text-right">Today</TableHead>
              <TableHead className="text-right">7 days</TableHead>
              <TableHead style={{ width: 160 }}>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scores.map((s) => {
              const n = callsToday(s.agent.name);
              const pct = s.agent.dailyTarget ? Math.min(100, Math.round((n / s.agent.dailyTarget) * 100)) : 0;
              return (
                <TableRow key={s.agent.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                  <TableCell className="font-medium">{s.agent.name}{s.agent.trainee && <Badge className="ml-2" variant="outline">Trainee</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{s.agent.languages.join(', ')}</TableCell>
                  <TableCell className="text-right tabular-nums">{n}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.calls}</TableCell>
                  <TableCell>
                    <div className="h-1.5 rounded-full bg-secondary"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.agent.name}</DialogTitle>
                <DialogDescription>Last 7 days · {open.agent.languages.join(', ')}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Calls', open.calls],
                  ['Connected', open.calls ? `${Math.round((open.connected / open.calls) * 100)}%` : '—'],
                  ['Positive', open.positive],
                  ['Converted', open.converted],
                  ['Talk time', durationLabel(open.talkSec)],
                  ['Sentiment', open.avgSentiment ?? '—'],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">{l}</div>
                    <div className="text-xl font-semibold tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Outcomes</div>
                <BarList ariaLabel="Outcomes" data={outcomeCounts(week.filter((r) => r.call.agentName === open.agent.name)).slice(0, 6)} />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm font-medium">Recent calls <Link to="/calls" className="text-primary">All calls</Link></div>
                <ul className="plain-list">
                  {week.filter((r) => r.call.agentName === open.agent.name).slice(0, 5).map((r) => <CallRowItem key={r.call.id} row={r} />)}
                </ul>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
