import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { APPS } from '../../data/seed';
import { POSITIVE_OUTCOMES } from '../../data/types';
import { APP_LOGOS } from '../../assets';
import { inrLabel, fmtDay } from '../../lib/dates';
import { agentScores, allCalls, callsByDay, DAY, isConnected, sentimentSummary } from '../../lib/metrics';
import { BarList } from '../../ui/charts';
import { MetricChart } from '../../ui/MetricChart';
import { Badge, Card, PageHead, Stat } from '../../ui/primitives';

/** The owner's view across every app: customers, money, the calling funnel and service health. */
export default function Overview() {
  const { state } = useStore();
  const { apps } = useScope();
  const users = useMemo(() => state.users.filter((u) => apps.includes(u.app)), [state.users, apps]);
  const calls = useMemo(() => allCalls(state.users, { apps }), [state.users, apps]);
  const week = calls.filter((r) => r.call.atTs >= Date.now() - 7 * DAY);
  const mrr = users.reduce((n, u) => n + (u.mrr ?? 0), 0);
  const dues = users.filter((u) => u.paymentDue && u.paymentDue.status !== 'upcoming');
  const atRisk = dues.reduce((n, u) => n + (u.paymentDue?.amount ?? 0), 0);
  const openTickets = users.filter((u) => u.queue === 'tickets');
  const breaches = openTickets.filter((u) => u.tickets[0]?.slaBreached).length;

  const registered30 = users.filter((u) => u.registeredDaysAgo <= 30);
  const funnel = [
    { label: 'Registered in the last 30 days', value: registered30.length },
    { label: 'Reached by phone', value: registered30.filter((u) => u.callHistory.some(isConnected)).length },
    { label: 'Said they’re interested', value: registered30.filter((u) => u.callHistory.some((c) => c.outcome && POSITIVE_OUTCOMES.includes(c.outcome))).length },
    { label: 'Started paying', value: registered30.filter((u) => u.paying || u.stageTag === 'Converted').length, color: 'var(--ok)' },
  ];

  const signups = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => {
      const daysAgo = 13 - i;
      return { label: fmtDay(today - daysAgo * DAY), values: [users.filter((u) => u.registeredDaysAgo === daysAgo).length] };
    });
  }, [users]);
  const daily = callsByDay(calls, 14);
  const leaders = agentScores(week, state.agents.filter((a) => a.apps.some((x) => apps.includes(x)))).slice(0, 6);
  const sentiment = sentimentSummary(week);

  return (
    <div className="page">
      <PageHead title="Overview" desc="Every app at a glance — customers, revenue, the calling funnel and what needs attention." />
      <div className="stats">
        <Stat label="Customers" value={users.length.toLocaleString('en-IN')} note={`${users.filter((u) => u.active).length.toLocaleString('en-IN')} active in the last 30 days`} />
        <Stat label="Paying" value={users.filter((u) => u.paying).length.toLocaleString('en-IN')} note={users.length ? `${((users.filter((u) => u.paying).length / users.length) * 100).toFixed(1)}% of customers` : undefined} />
        <Stat label="Monthly revenue" value={inrLabel(mrr)} tone="ok" />
        <Stat label="Overdue dues" value={inrLabel(atRisk)} tone={atRisk ? 'warn' : undefined} note={`${dues.length} customers`} />
        <Stat label="Calls this week" value={week.length.toLocaleString('en-IN')} note={sentiment.average !== null ? `Average sentiment ${sentiment.average}` : undefined} />
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>App</th><th className="r">Customers</th><th className="r">Active</th><th className="r">Paying</th><th className="r">MRR</th><th className="r">Dues waiting</th><th className="r">Open tickets</th><th className="r">Sentiment (7d)</th></tr></thead>
          <tbody>
            {APPS.filter((a) => apps.includes(a.id)).map((a) => {
              const mine = users.filter((u) => u.app === a.id);
              const s = sentimentSummary(week.filter((r) => r.user.app === a.id));
              return (
                <tr key={a.id}>
                  <td>
                    <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <img src={APP_LOGOS[a.id]} alt={a.name} style={{ height: 18, width: 104, objectFit: 'contain', objectPosition: 'left center' }} />
                      {!a.live && <Badge>In development</Badge>}
                    </span>
                  </td>
                  {a.live || mine.length ? (
                    <>
                      <td className="r mono">{mine.length.toLocaleString('en-IN')}</td>
                      <td className="r mono">{mine.filter((u) => u.active).length.toLocaleString('en-IN')}</td>
                      <td className="r mono">{mine.filter((u) => u.paying).length.toLocaleString('en-IN')}</td>
                      <td className="r mono">{inrLabel(mine.reduce((n, u) => n + (u.mrr ?? 0), 0))}</td>
                      <td className="r mono">{inrLabel(mine.filter((u) => u.queue === 'payments').reduce((n, u) => n + (u.paymentDue?.amount ?? 0), 0))}</td>
                      <td className="r mono">{mine.filter((u) => u.queue === 'tickets').length}</td>
                      <td className="r mono">{s.average ?? '—'}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="muted">Connects when the app ships.</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <MetricChart title="New sign-ups" value={signups.reduce((n, d) => n + d.values[0], 0).toLocaleString('en-IN')} note="last 14 days" data={signups.map((d) => ({ label: d.label, value: d.values[0] }))} />
        <MetricChart title="Calls per day" value={daily.reduce((n, d) => n + d.connected + d.missed, 0).toLocaleString('en-IN')} note={`${daily.reduce((n, d) => n + d.connected, 0)} connected, last 14 days`} data={daily.map((d) => ({ label: d.label, value: d.connected + d.missed }))} />
      </div>

      <div className="grid-3">
        <Card title="Sign-up to paying" sub="Last 30 days">
          <BarList ariaLabel="Conversion funnel" data={funnel} />
        </Card>
        <Card title="Most conversations this week" actions={<Link to="/team" className="btn btn--sm btn--ghost">Team</Link>}>
          <BarList ariaLabel="Connected calls by agent" data={leaders.map((l) => ({ label: l.agent.name, value: l.connected, display: `${l.connected}` }))} />
        </Card>
        <Card title="Service health">
          <div className="kv"><span>Tickets past SLA</span><span className="mono" style={{ color: breaches ? 'var(--danger)' : undefined }}>{breaches} of {openTickets.length}</span></div>
          <div className="kv"><span>Payment or app failures</span><span className="mono">{users.filter((u) => u.queue === 'errors').length}</span></div>
          <div className="kv"><span>Expired plans</span><span className="mono">{users.filter((u) => u.paymentDue?.status === 'expired').length}</span></div>
          <div className="kv"><span>Escalations waiting</span><span className="mono">{state.escalations.filter((e) => e.status === 'pending' && apps.includes(e.app)).length}</span></div>
          <div className="kv"><span>Unhappy calls this week</span><span className="mono">{sentiment.negative}</span></div>
        </Card>
      </div>
    </div>
  );
}
