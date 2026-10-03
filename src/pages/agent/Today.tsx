import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, Headset, Inbox } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { QUEUES } from '../../data/types';
import { APP_LOGOS } from '../../assets';
import { tasksForQueue, nextTask } from '../../lib/queue';
import { queueNote } from '../../lib/queueNotes';
import { allCalls, durationLabel, isConnected } from '../../lib/metrics';
import { POSITIVE_OUTCOMES } from '../../data/types';
import { can } from '../../lib/access';
import { Badge, Button, Card, Empty, Meter, PageHead, Stat } from '../../ui/primitives';
import { CallRowItem } from '../../components/calls/CallRowItem';
import './agent.css';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function Today() {
  const { state, currentAgent } = useStore();
  const navigate = useNavigate();
  const agent = currentAgent!;
  const apps = APPS.filter((a) => a.live && can(agent, a.id, 'call'));

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const mine = useMemo(() => allCalls(state.users, { agentName: agent.name }), [state.users, agent.name]);
  const today = mine.filter((r) => r.call.atTs >= start.getTime());
  const connected = today.filter((r) => isConnected(r.call)).length;
  const positive = today.filter((r) => r.call.outcome && POSITIVE_OUTCOMES.includes(r.call.outcome)).length;
  const talk = today.reduce((n, r) => n + (r.call.telephony?.durationSec ?? 0), 0);
  const next = nextTask(agent, state.users, null);

  const followUpsDue = useMemo(
    () => state.users.filter((u) => u.ownerAgentId === agent.id && u.queue === 'followup' && u.followUp && u.followUp.state !== 'pending').slice(0, 6),
    [state.users, agent.id],
  );

  return (
    <div className="page">
      <PageHead
        eyebrow={new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`${greeting()}, ${agent.name.split(' ')[0]}`}
        desc={next ? `Next up: ${next.user.name} in ${QUEUES.find((q) => q.key === next.queue)?.label}.` : 'Your queues are clear.'}
        actions={
          next && (
            <Button variant="primary" size="lg" icon={<Headset size={18} />} onClick={() => navigate(`/work/${next.user.app}?queue=${next.queue}&focus=${next.user.id}`)}>
              Call my next customer
            </Button>
          )
        }
      />

      <div className="stats">
        <div className="stat">
          <span className="stat__label">Calls today</span>
          <span className="stat__value">{today.length}<span className="muted" style={{ fontSize: 15 }}> / {agent.dailyTarget || '—'}</span></span>
          {agent.dailyTarget > 0 && <Meter value={today.length} max={agent.dailyTarget} color="var(--ok)" />}
        </div>
        <Stat label="Connected" value={connected} note={today.length ? `${Math.round((connected / today.length) * 100)}% of calls today` : 'No calls yet today'} />
        <Stat label="Positive outcomes" value={positive} tone={positive ? 'ok' : undefined} note="Interested or better" />
        <Stat label="Talk time" value={durationLabel(talk)} note="On the line today" />
      </div>

      {apps.map((app) => {
        const queues = QUEUES.filter((q) => agent.queues.includes(q.key));
        return (
          <section key={app.id} className="stack" aria-label={`${app.name} queues`}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 12 }}>
                <img src={APP_LOGOS[app.id]} alt={app.name} style={{ height: 22, width: 120, objectFit: 'contain', objectPosition: 'left center' }} />
                <span className="muted" style={{ fontSize: 13 }}>{app.tagline}</span>
              </div>
              <Link to={`/work/${app.id}`} className="btn btn--sm">Open queue <ArrowRight size={14} /></Link>
            </div>
            {queues.length === 0 ? (
              <Card><Empty icon={<Inbox size={22} />} title="No queues assigned yet">Ask your supervisor to give you a queue.</Empty></Card>
            ) : (
              <div className="queue-cards">
                {queues.map((q) => {
                  const tasks = tasksForQueue(agent, state.users, app.id, q.key);
                  return (
                    <Link key={q.key} to={`/work/${app.id}?queue=${q.key}`} className={`queue-card${tasks.length === 0 ? ' queue-card--empty' : ''}`}>
                      <span className="queue-card__count mono">{tasks.length}</span>
                      <span className="queue-card__label">{q.label}</span>
                      <span className="queue-card__note">{queueNote(q.key, tasks)}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <div className="grid-2">
        <Card title="Follow-ups due" sub="Warm leads you own that are due or overdue" actions={<Badge tone={followUpsDue.length ? 'warn' : 'neutral'}>{followUpsDue.length}</Badge>}>
          {followUpsDue.length === 0 ? (
            <Empty icon={<CalendarClock size={22} />} title="Nothing due">Follow-ups you mark positive come back here a week later.</Empty>
          ) : (
            <ul className="plain-list">
              {followUpsDue.map((u) => (
                <li key={u.id}>
                  <Link to={`/work/${u.app}?queue=followup&focus=${u.id}`} className="list-link">
                    <span style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{u.name}</span>
                      <span className="truncate muted" style={{ display: 'block', fontSize: 12.5 }}>Week {u.followUp!.weekNumber} · due {u.followUp!.nextDueLabel}</span>
                    </span>
                    <Badge tone={u.followUp!.state === 'overdue' ? 'danger' : 'warn'}>{u.followUp!.state === 'overdue' ? `${u.followUp!.overdueDays}d overdue` : 'Due today'}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Your recent calls" actions={<Link to="/calls" className="btn btn--sm btn--ghost">All calls</Link>} pad={false}>
          {mine.length === 0 ? (
            <Empty title="No calls yet">Calls you log appear here with their recording and analysis.</Empty>
          ) : (
            <ul className="plain-list" style={{ padding: '4px 0' }}>
              {mine.slice(0, 6).map((r) => <CallRowItem key={r.call.id} row={r} />)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
