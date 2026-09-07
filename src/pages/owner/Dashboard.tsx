import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TECSTELLAR_MARK } from '../../assets';
import { useStore } from '../../store/StoreContext';
import { inrLabel } from '../../lib/dates';
import { Rng } from '../../lib/rng';
import { APPS } from '../../data/seed';

const RANGES = ['Today', '7 days', '30 days', 'All time'];

export default function Dashboard() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [range, setRange] = useState('Today');

  const liveApps = APPS.filter((a) => a.live);
  const totalUsers = state.users.length;
  const active = state.users.filter((u) => u.active).length;
  const paying = state.users.filter((u) => u.paying).length;
  const mrr = state.users.reduce((s, u) => s + (u.mrr ?? 0), 0);
  const agents = state.agents.filter((a) => a.role === 'agent');
  const callsToday = agents.reduce((s, a) => s + a.todayCalls, 0);
  const positiveToday = agents.reduce((s, a) => s + a.todayPositive, 0);

  const perApp = liveApps.map((app) => {
    const users = state.users.filter((u) => u.app === app.id);
    const share = users.length / totalUsers;
    return {
      app,
      users: users.length,
      mau: users.filter((u) => u.active).length,
      paying: users.filter((u) => u.paying).length,
      mrr: users.reduce((s, u) => s + (u.mrr ?? 0), 0),
      dues: users.filter((u) => u.queue === 'payments').reduce((s, u) => s + (u.paymentDue?.amount ?? 0), 0),
      tickets: users.filter((u) => u.queue === 'tickets').length,
      positiveToday: Math.round(positiveToday * share),
    };
  });

  const registered30 = state.users.filter((u) => u.registeredDaysAgo <= 30);
  const reached30 = registered30.filter((u) => u.callHistory.length > 0);
  const positive30 = registered30.filter((u) => u.queue === 'followup' || u.stageTag === 'Converted');
  const subscribed30 = registered30.filter((u) => u.stageTag === 'Converted');

  const dailyBars = useMemo(() => {
    const r = new Rng(77);
    return Array.from({ length: 14 }).map(() => ({ newUsers: 30 + r.int(0, 70), positive: 10 + r.int(0, 40) }));
  }, []);
  const maxBar = Math.max(...dailyBars.map((d) => d.newUsers));

  const leaderboard = agents.slice().sort((a, b) => b.todayCalls - a.todayCalls);

  const expired = state.users.filter((u) => u.paymentDue?.status === 'expired');
  const atRisk = expired.reduce((s, u) => s + (u.paymentDue?.amount ?? 0), 0);
  const openTickets = state.users.filter((u) => u.queue === 'tickets');
  const breaches = openTickets.filter((u) => u.tickets[0]?.slaBreached).length;
  const slaHealth = openTickets.length ? Math.round(((openTickets.length - breaches) / openTickets.length) * 100) : 100;
  const errorsCount = state.users.filter((u) => u.queue === 'errors').length;

  const installBars = useMemo(() => {
    const r = new Rng(202);
    return Array.from({ length: 7 }).map(() => 30 + r.int(0, 70));
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 52, padding: '0 var(--space-4)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-900)', color: 'var(--color-neutral-100)' }}>
        <button type="button" onClick={() => navigate('/owner')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
          <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>TCC</span>
        </button>
        <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.75 }}>All apps · owner view</div>
        <button type="button" onClick={() => navigate('/owner/geography')} style={{ fontSize: 12, opacity: 0.85, background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }}>Geography →</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-3)', fontSize: 12 }}>
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', opacity: range === r ? 1 : 0.7, borderBottom: range === r ? '2px solid var(--color-accent)' : '2px solid transparent', paddingBottom: 2 }}>{r}</button>
          ))}
          <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12, color: 'var(--color-accent-400)' }} onClick={() => { dispatch({ type: 'LOGOUT' }); navigate('/'); }}>sign out</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
        <Stat label="Total users" value={totalUsers.toLocaleString('en-IN')} sub="Sample dataset" />
        <Stat label="Active · MAU" value={active.toLocaleString('en-IN')} sub={`${totalUsers ? Math.round((active / totalUsers) * 100) : 0}% of base`} />
        <Stat label="Paying users" value={paying.toLocaleString('en-IN')} accent sub={`${totalUsers ? ((paying / totalUsers) * 100).toFixed(1) : 0}% of base`} />
        <Stat label="MRR" value={inrLabel(mrr)} accent2 sub="Across live apps" />
        <Stat label="Today · calls / positive" value={<>{callsToday} <span style={{ color: 'var(--color-accent-700)' }}>/ {positiveToday}</span></>} sub={`${callsToday ? Math.round((positiveToday / callsToday) * 100) : 0}% positive rate`} last />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', borderBottom: '2px solid var(--color-divider)' }}>
        <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Per app</div>
          <table className="table">
            <thead><tr><th>App</th><th>Users</th><th>MAU</th><th>Paying</th><th>MRR</th><th>Dues</th><th>Tickets</th><th>Positive today</th></tr></thead>
            <tbody>
              {perApp.map((p) => (
                <tr key={p.app.id}>
                  <td style={{ fontWeight: 600 }}>{p.app.name}</td>
                  <td>{p.users.toLocaleString('en-IN')}</td>
                  <td>{p.mau.toLocaleString('en-IN')}</td>
                  <td>{p.paying.toLocaleString('en-IN')}</td>
                  <td>{inrLabel(p.mrr)}</td>
                  <td style={{ color: 'var(--color-accent-700)' }}>{inrLabel(p.dues)}</td>
                  <td>{p.tickets}</td>
                  <td>{p.positiveToday}</td>
                </tr>
              ))}
              {APPS.filter((a) => !a.live).map((a) => (
                <tr key={a.id}><td style={{ color: 'var(--color-neutral-700)' }}>{a.name}</td><td colSpan={7} style={{ color: 'var(--color-neutral-700)' }}>In development — connects when the first build ships</td></tr>
              ))}
            </tbody>
          </table>

          <div className="eyebrow" style={{ margin: 'var(--space-6) 0 var(--space-3)' }}>Daily metrics · new users vs positive calls · last 14 days</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, borderBottom: '2px solid var(--color-divider)' }}>
            {dailyBars.map((d, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }}>
                <div style={{ flex: 1, height: `${(d.newUsers / maxBar) * 100}%`, background: 'var(--color-neutral-800)' }} title={`${d.newUsers} new`} />
                <div style={{ flex: 1, height: `${(d.positive / maxBar) * 100}%`, background: 'var(--color-accent)' }} title={`${d.positive} positive`} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', fontSize: 11, color: 'var(--color-neutral-700)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--color-neutral-800)' }} />New users</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: 'var(--color-accent)' }} />Positive calls</span>
          </div>
        </div>

        <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Funnel · new → positive → paid (30d)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <FBar label="Registered (30d)" value={registered30.length} pct={100} color="var(--color-neutral-800)" />
            <FBar label="Reached on call" value={reached30.length} pct={registered30.length ? (reached30.length / registered30.length) * 100 : 0} color="var(--color-neutral-700)" />
            <FBar label="Marked positive" value={positive30.length} pct={registered30.length ? (positive30.length / registered30.length) * 100 : 0} color="var(--color-accent-500)" />
            <FBar label="Subscribed" value={subscribed30.length} pct={registered30.length ? (subscribed30.length / registered30.length) * 100 : 0} color="var(--color-accent-2)" />
          </div>
          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Agent leaderboard · today</div>
          <table className="table" style={{ fontSize: 12 }}>
            <tbody>
              {leaderboard.map((a) => (
                <tr key={a.id}><td style={{ fontWeight: 600 }}>{a.name}</td><td>{a.todayCalls} calls</td><td>{a.todayPositive} pos</td><td style={{ color: 'var(--color-accent-700)', fontWeight: 600 }}>{a.todaySubscribed} paid</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ height: 2, background: 'var(--color-divider)', margin: 'var(--space-4) 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div>
              <div className="eyebrow">Churn · expired subs</div>
              <div style={{ font: '800 24px var(--font-heading)', color: 'var(--color-accent-700)' }}>{expired.length}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{inrLabel(atRisk)} at risk this month</div>
            </div>
            <div>
              <div className="eyebrow">Ticket SLA health</div>
              <div style={{ font: '800 24px var(--font-heading)' }}>{slaHealth}%</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{breaches} breaches open now</div>
            </div>
            <div>
              <div className="eyebrow">Play Store installs · 7d</div>
              <div style={{ font: '800 24px var(--font-heading)' }}>+{installBars.reduce((s, v) => s + v, 0)}</div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 26, marginTop: 4 }}>
                {installBars.map((v, i) => <div key={i} style={{ flex: 1, height: `${(v / 100) * 100}%`, background: i === installBars.length - 1 ? 'var(--color-neutral-800)' : 'var(--color-neutral-600)' }} />)}
              </div>
            </div>
            <div>
              <div className="eyebrow">Payment attempts failed / errors</div>
              <div style={{ font: '800 24px var(--font-heading)' }}>{errorsCount}</div>
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>Queued to split 5</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent, accent2, last }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean; accent2?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: 'var(--space-4)', borderRight: last ? 0 : '1px solid var(--color-divider)' }}>
      <div className="eyebrow">{label}</div>
      <div style={{ font: '800 34px/1.05 var(--font-heading)', letterSpacing: '-.02em', color: accent ? 'var(--color-accent-700)' : accent2 ? 'var(--color-accent-2-700)' : undefined }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{sub}</div>}
    </div>
  );
}

function FBar({ label, value, pct, color }: { label: string; value: number; pct: number; color: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}><span>{label}</span><strong>{value} · {pct.toFixed(0)}%</strong></div>
      <div style={{ height: 20, background: color, width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}
