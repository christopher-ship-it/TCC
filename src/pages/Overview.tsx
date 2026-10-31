// The one home page for supervisors and admins: four numbers, two charts, and the agents. Everything else is one
// click away — a row opens that agent's detail. (The older Team performance / Geography / Allocation pages are
// switched off in src/lib/features.ts, not deleted.)

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useStore } from '../store/StoreContext';
import { useScope } from '../shell/scope';
import { agentScores, allCalls, callsByDay, DAY, isConnected } from '../lib/metrics';
import { MetricChart } from '../ui/MetricChart';
import { PageHead } from '../ui/primitives';
import { FilterBar, SearchFilter, SelectFilter, useFilters } from '../ui/filters';
import { AGENT_LANGUAGES } from '../lib/languages';
import { textMatch } from '../lib/filters';
import { APPS } from '../data/seed';
import { SuperAdminTotals } from './admin/Totals';
import { SignedInNow } from './admin/SignedInNow';
import { Pipeline } from './admin/Pipeline';

/** A fresh deployment: what to do first, ticked off as it happens. Gone once someone has made a call. */
function GettingStarted() {
  const { state, backend, currentAgent } = useStore();
  if (backend !== 'server' || currentAgent?.role !== 'admin') return null;
  const hasAgents = state.agents.some((a) => a.role === 'agent');
  const hasCustomers = state.users.length > 0;
  const hasCalls = state.users.some((u) => u.callHistory.length > 0);
  if (hasAgents && hasCustomers && hasCalls) return null;
  const steps: { done: boolean; title: string; body: string; to?: string; cta?: string }[] = [
    { done: hasAgents, title: 'Add your agents', body: 'For each one: their name, a username and password you give them, the products they call for and the languages they speak. Add their phone line ID so they can call from the browser.', to: '/people?edit=new', cta: 'Add an agent' },
    { done: hasCustomers, title: 'Agents add customers', body: 'An agent signs in, opens Call queue and chooses Add customer — mobile number and name are enough. The mobile number is the customer’s ID.', to: '/customers', cta: 'Or add one yourself' },
    { done: hasCalls, title: 'Call, and it’s all kept', body: 'Every call is recorded and analysed, and lands on that customer: click them in Customers for the full history, transcripts and how it’s going.' },
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Get started</CardTitle></CardHeader>
      <CardContent>
        <ol className="stack" style={{ gap: 14, listStyle: 'none', padding: 0, margin: 0 }}>
          {steps.map((s) => (
            <li key={s.title} className="flex gap-3">
              {s.done ? <CheckCircle2 size={20} className="shrink-0 text-primary" /> : <Circle size={20} className="shrink-0 text-muted-foreground" />}
              <div style={{ minWidth: 0 }}>
                <div className="font-medium" style={s.done ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{s.title}</div>
                {!s.done && <p className="text-muted-foreground" style={{ fontSize: 13.5, marginTop: 2 }}>{s.body}</p>}
                {!s.done && s.to && <Link to={s.to} className="btn btn--sm mt-2" style={{ display: 'inline-flex' }}>{s.cta}</Link>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

export default function Overview() {
  const { state, currentAgent } = useStore();
  const { apps } = useScope();
  const navigate = useNavigate();
  const { values: of, set: setOf, reset: resetOf, active: ofActive } = useFilters(['oq', 'olang', 'oprod', 'ocalling', 'orole'] as const);

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
  const shownScores = scores
    .filter((s) => !of.olang || s.agent.languages.includes(of.olang as never))
    .filter((s) => !of.oprod || s.agent.apps.includes(of.oprod as never))
    .filter((s) => !of.ocalling || (of.ocalling === 'yes') === (callsToday(s.agent.name) > 0))
    .filter((s) => !of.orole || (of.orole === 'trainee') === !!s.agent.trainee)
    .filter((s) => textMatch(of.oq, s.agent.name, s.agent.languages.join(' ')));

  return (
    <div className="page">
      <PageHead title="Overview" desc="What the calling team did today. Click an agent to see what they hold, what they have done and whether they are on a call." />
      <GettingStarted />
      {currentAgent?.role === 'admin' && <SuperAdminTotals />}
      {currentAgent?.role !== 'agent' && <Pipeline />}
      {currentAgent?.role !== 'agent' && <SignedInNow />}
      {currentAgent?.role === 'admin' && <h2 className="text-base font-semibold" style={{ marginTop: 8 }}>Today</h2>}

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
        <div className="px-4 pb-3">
          <FilterBar active={ofActive} onReset={resetOf} shown={shownScores.length} total={scores.length} noun="agents">
            <SearchFilter value={of.oq} onChange={(v) => setOf('oq', v)} placeholder="Agent name or language" label="Find an agent" />
            <SelectFilter label="Language" value={of.olang} onChange={(v) => setOf('olang', v)} options={AGENT_LANGUAGES.map((l) => ({ value: l, label: l }))} />
            {apps.length > 1 && <SelectFilter label="Product" value={of.oprod} onChange={(v) => setOf('oprod', v)} options={APPS.filter((a) => apps.includes(a.id)).map((a) => ({ value: a.id, label: a.name }))} />}
            <SelectFilter label="Calling today" value={of.ocalling} onChange={(v) => setOf('ocalling', v)} all="Calling today: any" options={[{ value: 'yes', label: 'Has called today' }, { value: 'no', label: 'No calls yet' }]} />
            <SelectFilter label="Experience" value={of.orole} onChange={(v) => setOf('orole', v)} all="Everyone" options={[{ value: 'trainee', label: 'Trainees' }, { value: 'regular', label: 'Not trainees' }]} />
          </FilterBar>
        </div>
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
            {shownScores.map((s) => {
              const n = callsToday(s.agent.name);
              const pct = s.agent.dailyTarget ? Math.min(100, Math.round((n / s.agent.dailyTarget) * 100)) : 0;
              return (
                <TableRow key={s.agent.id} className="cursor-pointer" onClick={() => navigate(`/agents/${encodeURIComponent(s.agent.id)}`)}>
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

    </div>
  );
}
