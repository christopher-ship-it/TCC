import type React from 'react';
import SupervisorNav from '../../components/SupervisorNav';
import { useStore } from '../../store/StoreContext';

export default function TeamPerformance() {
  const { state, dispatch } = useStore();
  const agents = state.agents.filter((a) => a.role === 'agent');

  const callsToday = agents.reduce((s, a) => s + a.todayCalls, 0);
  const connectedToday = agents.reduce((s, a) => s + a.todayConnected, 0);
  const connectRate = callsToday ? Math.round((connectedToday / callsToday) * 100) : 0;
  const positiveToday = agents.reduce((s, a) => s + a.todayPositive, 0);
  const overdueFollowups = state.users.filter((u) => u.followUp?.state === 'overdue').length;
  const exitedNegative = state.users.filter((u) => u.stageTag === 'Exited — negative').length;

  const followupUsers = state.users
    .filter((u) => u.queue === 'followup')
    .sort((a, b) => rank(a.followUp?.state) - rank(b.followUp?.state))
    .slice(0, 8);

  const stillInChain = state.users.filter((u) => u.queue === 'followup').length;
  const convertedToPaid = state.users.filter((u) => u.stageTag === 'Converted').length;
  const enteredChain = stillInChain + convertedToPaid + exitedNegative;

  const unclaimedNew = state.users.filter((u) => u.app === 'realbroks' && u.queue === 'new' && !u.ownerAgentId).length;
  const unclaimedExpired = state.users.filter((u) => u.app === 'irondrobe' && u.queue === 'payments' && u.paymentDue?.status === 'expired' && !u.ownerAgentId).length;

  function agentName(id: string | null) {
    return state.agents.find((a) => a.id === id)?.name ?? 'Unassigned';
  }

  function reassign(userId: string, currentOwner: string | null) {
    const pool = agents.filter((a) => a.id !== currentOwner);
    const next = pool[Math.floor(Math.random() * pool.length)];
    if (next) dispatch({ type: 'REASSIGN_OWNER', userId, agentId: next.id });
  }

  return (
    <div>
      <SupervisorNav />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '2px solid var(--color-divider)' }}>
        <Stat label="Calls today" value={callsToday} />
        <Stat label="Connect rate" value={`${connectRate}%`} />
        <Stat label="Positive" value={positiveToday} accent />
        <Stat label="Overdue follow-ups" value={overdueFollowups} accent />
        <Stat label="Exited — marked negative" value={exitedNegative} last />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px' }}>
        <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Agents · today</div>
          <table className="table">
            <thead><tr><th>Agent</th><th>Working</th><th>Calls</th><th>Connected</th><th>Positive</th><th>Subscribed</th><th>Overdue</th><th>Avg handle</th></tr></thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}{a.trainee ? <span className="tag tag-neutral" style={{ marginLeft: 6 }}>trainee</span> : null}</td>
                  <td>{a.workingQueueLabel}</td>
                  <td>{a.todayCalls}</td>
                  <td>{a.todayConnected}</td>
                  <td>{a.todayPositive}</td>
                  <td style={{ color: 'var(--color-accent-700)', fontWeight: 600 }}>{a.todaySubscribed}</td>
                  <td>{a.todayOverdue}</td>
                  <td>{a.avgHandleLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="eyebrow" style={{ margin: 'var(--space-6) 0 var(--space-3)' }}>Follow-up chain · needs a decision</div>
          <table className="table">
            <thead><tr><th>User</th><th>Marked positive</th><th>Week</th><th>State</th><th>Owner</th><th></th></tr></thead>
            <tbody>
              {followupUsers.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td>{u.followUp?.markedPositiveLabel}</td>
                  <td>{u.followUp?.weekNumber}</td>
                  <td>
                    {u.followUp?.state === 'overdue' && <span className="tag tag-accent">Overdue {u.followUp.overdueDays}d</span>}
                    {u.followUp?.state === 'due-today' && <span className="tag tag-neutral">Due today</span>}
                    {u.followUp?.state === 'pending' && <span className="tag tag-outline">Pending</span>}
                  </td>
                  <td>{agentName(u.ownerAgentId)}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => reassign(u.id, u.ownerAgentId)}>reassign</button>
                    <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => dispatch({ type: 'CLOSE_FOLLOWUP', userId: u.id, converted: true })}>close</button>
                  </td>
                </tr>
              ))}
              {followupUsers.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--color-neutral-700)' }}>Nothing needs a decision right now.</td></tr>}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Chain funnel · live</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 12 }}>
            <FunnelBar label="Entered chain" value={enteredChain} pct={100} color="var(--color-neutral-800)" />
            <FunnelBar label="Still in chain" value={stillInChain} pct={enteredChain ? (stillInChain / enteredChain) * 100 : 0} color="var(--color-neutral-600)" />
            <FunnelBar label="Converted to paid" value={convertedToPaid} pct={enteredChain ? (convertedToPaid / enteredChain) * 100 : 0} color="var(--color-accent-2)" />
            <FunnelBar label="Exited — negative" value={exitedNegative} pct={enteredChain ? (exitedNegative / enteredChain) * 100 : 0} color="var(--color-neutral-400)" />
          </div>
          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Rules in force</div>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--color-neutral-700)' }}>
            Follow-up cadence <strong style={{ color: 'var(--color-text)' }}>every 7 days</strong><br />
            No-answers <strong style={{ color: 'var(--color-text)' }}>never removed from the chain</strong><br />
            Negative outcome <strong style={{ color: 'var(--color-text)' }}>exits immediately</strong><br />
            Inactive 30+ <strong style={{ color: 'var(--color-text)' }}>open to any assigned agent, any time</strong><br />
            Queue access <strong style={{ color: 'var(--color-text)' }}>set per agent at account creation</strong>
          </div>
          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Unassigned work</div>
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            RealBroks · <strong>{unclaimedNew} registrations</strong> unclaimed<br />
            IronDrobe · <strong>{unclaimedExpired} expired dues</strong> unclaimed
          </div>
          <button className="btn btn-primary btn-block" type="button" onClick={() => dispatch({ type: 'AUTO_DISTRIBUTE' })}>Distribute to agents</button>
        </div>
      </div>
    </div>
  );
}

function rank(state?: string) {
  if (state === 'overdue') return 0;
  if (state === 'due-today') return 1;
  return 2;
}

function Stat({ label, value, accent, last }: { label: string; value: React.ReactNode; accent?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: 'var(--space-3) var(--space-4)', borderRight: last ? 0 : '1px solid var(--color-divider)' }}>
      <div className="eyebrow">{label}</div>
      <div style={{ font: '800 26px var(--font-heading)', color: accent ? 'var(--color-accent-700)' : undefined }}>{value}</div>
    </div>
  );
}

function FunnelBar({ label, value, pct, color }: { label: string; value: number; pct: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>{label}</span><strong>{value}</strong></div>
      <div style={{ height: 18, background: color, width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}
