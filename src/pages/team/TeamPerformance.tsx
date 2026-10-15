import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { useScope } from '../../shell/scope';
import { agentScores, allCalls, callsByDay, DAY, durationLabel, isConnected, outcomeCounts, sentimentSummary } from '../../lib/metrics';
import { POSITIVE_OUTCOMES } from '../../data/types';
import { BarList, ColumnChart, Legend } from '../../ui/charts';
import { Avatar, Badge, Card, Empty, Meter, PageHead, Segmented, Stat } from '../../ui/primitives';
import { CallRowItem } from '../../components/calls/CallRowItem';
import '../agent/agent.css';

type Period = 'today' | '7' | '30';

export default function TeamPerformance() {
  const { state } = useStore();
  const { apps } = useScope();
  const [period, setPeriod] = useState<Period>('7');
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return period === 'today' ? d.getTime() : d.getTime() - (Number(period) - 1) * DAY;
  }, [period]);

  const rows = useMemo(() => allCalls(state.users, { apps, since }), [state.users, apps, since]);
  const daily = useMemo(() => callsByDay(allCalls(state.users, { apps }), 14), [state.users, apps]);
  const agents = state.agents.filter((a) => a.role === 'agent' && a.apps.some((x) => apps.includes(x)));
  const scores = agentScores(rows, agents);
  const sentiment = sentimentSummary(rows);
  const connected = rows.filter((r) => isConnected(r.call)).length;
  const positive = rows.filter((r) => r.call.outcome && POSITIVE_OUTCOMES.includes(r.call.outcome)).length;
  const scoped = state.users.filter((u) => apps.includes(u.app));
  const overdue = scoped.filter((u) => u.followUp?.state === 'overdue').length;
  const inChain = scoped.filter((u) => u.queue === 'followup').length;
  const converted = scoped.filter((u) => u.stageTag === 'Converted').length;
  const exited = scoped.filter((u) => u.stageTag === 'Exited — negative').length;
  const startOfToday = new Date().setHours(0, 0, 0, 0);

  return (
    <div className="page">
      <PageHead title="Team performance" desc="How the calling team is doing, and which calls deserve a listen." actions={<Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />} />

      <div className="stats">
        <Stat label="Calls" value={rows.length.toLocaleString('en-IN')} note={`${agents.length} agents`} />
        <Stat label="Connect rate" value={rows.length ? `${Math.round((connected / rows.length) * 100)}%` : '—'} note={`${connected} answered`} />
        <Stat label="Positive outcomes" value={positive} tone={positive ? 'ok' : undefined} />
        <Stat label="Average sentiment" value={sentiment.average ?? '—'} note={`${sentiment.analysed} calls analysed`} />
        <Stat label="Follow-ups overdue" value={overdue} tone={overdue ? 'warn' : undefined} note={`${inChain} in the weekly chain`} />
      </div>

      <Card title="Calls per day" sub="Last 14 days" actions={<Legend items={[{ label: 'Connected', color: 'var(--series-1)' }, { label: 'Didn’t connect', color: 'var(--series-4)' }]} />}>
        <ColumnChart ariaLabel="Team calls per day" data={daily.map((d) => ({ label: d.label, values: [d.connected, d.missed] }))} series={[{ label: 'Connected', color: 'var(--series-1)' }, { label: 'Didn’t connect', color: 'var(--series-4)' }]} />
      </Card>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Agent</th>
              <th className="r">Calls</th>
              <th className="r">Connected</th>
              <th className="r">Positive</th>
              <th className="r">Converted</th>
              <th className="r">Talk time</th>
              <th className="r">Sentiment</th>
              <th style={{ width: 180 }}>Today vs target</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => {
              const today = state.users.reduce((n, u) => n + u.callHistory.filter((c) => c.agentName === s.agent.name && c.atTs >= startOfToday).length, 0);
              return (
                <tr key={s.agent.id}>
                  <td>
                    <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <Avatar name={s.agent.name} />
                      <span>
                        <b style={{ fontWeight: 500 }}>{s.agent.name}</b>
                        {s.agent.trainee && <Badge tone="accent">Trainee</Badge>}
                        <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{s.agent.languages.join(', ')}</span>
                      </span>
                    </span>
                  </td>
                  <td className="r mono">{s.calls}</td>
                  <td className="r mono">{s.calls ? `${Math.round((s.connected / s.calls) * 100)}%` : '—'}</td>
                  <td className="r mono">{s.positive}</td>
                  <td className="r mono">{s.converted}</td>
                  <td className="r mono">{durationLabel(s.talkSec)}</td>
                  <td className="r mono">{s.avgSentiment ?? '—'}</td>
                  <td>
                    <div className="stack" style={{ gap: 4 }}>
                      <span className="mono" style={{ fontSize: 12.5 }}>{today} / {s.agent.dailyTarget || '—'}</span>
                      {s.agent.dailyTarget > 0 && <Meter value={today} max={s.agent.dailyTarget} color={today >= s.agent.dailyTarget ? 'var(--ok)' : 'var(--accent)'} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid-3">
        <Card title="Sentiment" sub={`${sentiment.analysed} analysed calls`}>
          <BarList
            ariaLabel="Calls by customer sentiment"
            max={Math.max(1, sentiment.positive, sentiment.neutral, sentiment.negative)}
            data={[
              { label: 'Positive (60+)', value: sentiment.positive, color: 'var(--ok)' },
              { label: 'Neutral', value: sentiment.neutral, color: 'var(--series-4)' },
              { label: 'Negative (40 or less)', value: sentiment.negative, color: 'var(--danger)' },
            ]}
          />
        </Card>
        <Card title="Outcomes">
          <BarList ariaLabel="Calls by outcome" data={outcomeCounts(rows).slice(0, 7)} />
        </Card>
        <Card title="Weekly follow-up chain" sub="Customers who were marked positive">
          <BarList
            ariaLabel="Follow-up chain"
            data={[
              { label: 'Entered the chain', value: inChain + converted + exited },
              { label: 'Still being called', value: inChain },
              { label: 'Converted to paid', value: converted, color: 'var(--ok)' },
              { label: 'Said no', value: exited, color: 'var(--danger)' },
            ]}
          />
        </Card>
      </div>

      <Card title="Calls to listen to" sub="Analysed calls where the customer was unhappy — newest first" actions={<Link to="/calls" className="btn btn--sm btn--ghost">All calls</Link>} pad={false}>
        {sentiment.flagged.length === 0 ? (
          <Empty title="Nothing flagged">No analysed call in this period went badly.</Empty>
        ) : (
          <ul className="plain-list">{sentiment.flagged.slice(0, 8).map((r) => <CallRowItem key={r.call.id} row={r} showAgent />)}</ul>
        )}
      </Card>
    </div>
  );
}
