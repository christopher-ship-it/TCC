// One agent's day in detail, for supervisors and admins: signed in or not, on a call or not, what they hold right now,
// what they have finished today and what is lined up for them. Opened from the Overview's agent rows.

import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { usePresence } from '../../lib/usePresence';
import { agentProgress } from '../../lib/pipeline';
import { DEFAULT_CAPACITY } from '../../lib/assignment';
import { primaryLanguageOf } from '../../lib/languages';
import { durationLabel } from '../../lib/metrics';
import { APPS } from '../../data/seed';
import { QUEUES } from '../../data/types';
import { Badge, Empty, PageHead } from '../../ui/primitives';

const queueLabel = (key: string) => QUEUES.find((q) => q.key === key)?.short ?? key;
const clock = (ts: number) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const ago = (ts: number, now: number) => {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const CALL_WORD = { dialing: 'Dialling', ringing: 'Ringing', incoming: 'Incoming call', connected: 'Talking' } as const;

export default function AgentDetail() {
  const { id = '' } = useParams();
  const { state } = useStore();
  const { apps } = useScope();
  const { people, now } = usePresence();
  const agent = state.agents.find((a) => a.id === id && a.role === 'agent');
  const users = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const clockNow = people ? now : Date.now();
  const progress = useMemo(() => (agent ? agentProgress(agent, users, clockNow) : null), [agent, users, clockNow]);

  if (!agent || !progress) {
    return (
      <div className="page">
        <Link to="/team" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft size={14} /> Overview</Link>
        <Empty title="No such agent">They may have been removed, or work in a product you don’t manage.</Empty>
      </div>
    );
  }

  const presence = people?.find((p) => p.id === agent.id);
  const live = presence?.call ?? null;
  const liveCustomer = live?.customerId ? state.users.find((u) => u.id === live.customerId) : null;
  const primary = primaryLanguageOf(agent);
  const untouched = progress.open.filter((o) => !o.called).length;
  const stats: [string, string | number, string?][] = [
    ['Calls today', agent.dailyTarget ? `${progress.callsToday.length} / ${agent.dailyTarget}` : progress.callsToday.length, `${progress.connectedToday} connected`],
    ['Holding now', `${progress.open.length} / ${DEFAULT_CAPACITY}`, untouched ? `${untouched} not called yet` : progress.open.length ? 'all called' : 'nothing handed out'],
    ['Lined up for them', progress.lined, 'arrive as they finish'],
    ['Last call', progress.lastCallAt ? ago(progress.lastCallAt, clockNow) : 'None yet'],
  ];

  return (
    <div className="page">
      <Link to="/team" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft size={14} /> Overview</Link>
      <PageHead
        title={agent.name}
        desc={`${agent.languages.join(', ')}${primary ? ` · first language ${primary}` : ''} · ${agent.apps.map((a) => APPS.find((x) => x.id === a)?.name ?? a).join(', ')}`}
        actions={
          <span className="row" style={{ gap: 8 }}>
            {agent.trainee && <Badge tone="accent">Trainee</Badge>}
            {live ? <Badge tone="accent" dot>{CALL_WORD[live.state]}</Badge> : null}
            <Badge tone={presence?.online ? 'ok' : 'neutral'} dot>{presence ? (presence.online ? 'Signed in' : presence.lastSeen ? `Offline · seen ${ago(presence.lastSeen, clockNow)}` : 'Never signed in') : '…'}</Badge>
          </span>
        }
      />

      {live && (
        <Card>
          <CardContent className="py-3 text-sm">
            {CALL_WORD[live.state]}
            {liveCustomer ? <> with <Link to={`/customers/${liveCustomer.id}`} className="font-medium text-primary">{liveCustomer.name}</Link> ({liveCustomer.language})</> : ''}
            {' '}· for {durationLabel(Math.max(0, Math.round((clockNow - live.since) / 1000)))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value, note]) => (
          <Card key={label}>
            <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-[28px] leading-tight font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</div>
              {note && <div className="text-xs text-muted-foreground">{note}</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <div className="px-4 pt-3 pb-2 text-base font-semibold">In progress · customers they hold</div>
        {progress.open.length === 0 ? (
          <div className="px-4 pb-4"><Empty title="Nothing handed out">{presence?.online ? (progress.lined ? 'Customers are handed out within a few seconds.' : 'Nobody is waiting in their languages and lists.') : 'Customers go only to agents who are signed in.'}</Empty></div>
        ) : (
          <Table>
            <TableHeader><TableRow data-head><TableHead>Customer</TableHead><TableHead>List</TableHead><TableHead>Language</TableHead><TableHead>Signed up</TableHead><TableHead>Handed out</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {progress.open.map(({ user, list, since, called }) => (
                <TableRow key={user.id}>
                  <TableCell><Link to={`/customers/${user.id}`} className="font-medium text-primary">{user.name}</Link><div className="text-xs text-muted-foreground">{user.business} · {user.city}</div></TableCell>
                  <TableCell>{queueLabel(list)}</TableCell>
                  <TableCell>{user.language}</TableCell>
                  <TableCell className="text-muted-foreground">{user.registeredAtLabel}</TableCell>
                  <TableCell className="text-muted-foreground">{since ? ago(since, clockNow) : 'By hand'}</TableCell>
                  <TableCell>{called ? <Badge tone="ok" dot>Called</Badge> : <Badge dot>Not called yet</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="px-4 pt-3 pb-2 text-base font-semibold">Done today · {progress.callsToday.length} calls</div>
        {progress.callsToday.length === 0 ? (
          <div className="px-4 pb-4"><Empty title="No calls yet today">Their calls show here as they are logged.</Empty></div>
        ) : (
          <Table>
            <TableHeader><TableRow data-head><TableHead>Time</TableHead><TableHead>Customer</TableHead><TableHead>Result</TableHead><TableHead>Outcome</TableHead><TableHead className="text-right">Talk time</TableHead></TableRow></TableHeader>
            <TableBody>
              {progress.callsToday.map(({ user, call }) => (
                <TableRow key={call.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{clock(call.atTs)}</TableCell>
                  <TableCell><Link to={`/customers/${user.id}/calls/${call.id}`} className="font-medium text-primary">{user.name}</Link></TableCell>
                  <TableCell>{call.status}</TableCell>
                  <TableCell className="text-muted-foreground">{call.outcome ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{call.telephony?.durationSec ? durationLabel(call.telephony.durationSec) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
