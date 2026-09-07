import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import TopBar from '../../components/TopBar';
import { APP_LOGOS } from '../../assets';
import { QUEUES } from '../../data/types';
import { queueCounts, totalOpenTasks, nextTask } from '../../lib/queue';
import { APPS } from '../../data/seed';

export default function Launcher() {
  const { state, currentAgent } = useStore();
  const navigate = useNavigate();
  if (!currentAgent) return null;

  const liveApps = currentAgent.apps.filter((id) => APPS.find((a) => a.id === id)?.live);
  const totalAcrossApps = liveApps.reduce((sum, appId) => sum + totalOpenTasks(currentAgent, state.users, appId), 0);

  const yesterdayCalls = 40 + (currentAgent.id.length * 7) % 30;
  const yesterdayPositive = Math.round(yesterdayCalls * 0.28);
  const yesterdaySubs = Math.max(1, Math.round(yesterdayPositive * 0.16));
  const overdueCount = state.users.filter((u) => u.ownerAgentId === currentAgent.id && u.followUp?.state === 'overdue').length;

  function serveNext() {
    for (const appId of liveApps) {
      const t = nextTask(currentAgent!, state.users, appId);
      if (t) {
        navigate(`/work/${appId}?focus=${t.user.id}`);
        return;
      }
    }
    if (liveApps[0]) navigate(`/work/${liveApps[0]}`);
  }

  return (
    <div>
      <TopBar
        subtitle={null}
        right={
          <span>
            {new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · <strong style={{ color: 'var(--color-text)' }}>{currentAgent.name}</strong> · {currentAgent.role === 'agent' ? (currentAgent.trainee ? 'Agent · trainee' : 'Agent') : currentAgent.role}
          </span>
        }
      />
      <div style={{ padding: 'var(--space-6) var(--space-4)', maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Pick an app to work</h3>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>{totalAcrossApps} tasks assigned to you across {liveApps.length} live app{liveApps.length === 1 ? '' : 's'}</div>
          <button className="btn btn-primary" type="button" style={{ marginLeft: 'auto' }} onClick={serveNext}>Serve my next task ▸</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
          {APPS.filter((app) => !app.live || currentAgent.apps.includes(app.id)).map((app) => {
            if (!app.live) {
              return (
                <div key={app.id} style={{ border: '1px solid var(--color-divider)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', opacity: 0.65 }}>
                  <div style={{ flex: 1 }}>
                    <img src={APP_LOGOS[app.id]} alt={app.name} style={{ height: 22, width: 'auto', objectFit: 'contain', marginBottom: 2 }} />
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{app.tagline} · no live users yet</div>
                  </div>
                  <span className="tag tag-neutral">Not live</span>
                </div>
              );
            }
            const counts = queueCounts(currentAgent, state.users, app.id);
            const total = totalOpenTasks(currentAgent, state.users, app.id);
            return (
              <div key={app.id} style={{ border: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-divider)' }}>
                  <div style={{ flex: 1 }}>
                    <img src={APP_LOGOS[app.id]} alt={app.name} style={{ height: 30, width: 'auto', objectFit: 'contain', marginBottom: 4 }} />
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>{app.tagline} · live</div>
                  </div>
                  <div style={{ background: 'var(--color-accent)', color: 'var(--color-bg)', font: '800 18px var(--font-heading)', padding: '4px 10px' }}>{total}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {QUEUES.map((q) => (
                    <div key={q.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px var(--space-4)', fontSize: 13, borderBottom: q.key === 'inactive' ? 0 : '1px solid var(--color-divider)', color: q.key === 'inactive' ? 'var(--color-neutral-700)' : undefined }}>
                      <span>{q.label}</span>
                      <strong style={counts[q.key] > 0 && (q.key === 'tickets' || q.key === 'payments') ? { color: 'var(--color-accent-700)' } : undefined}>
                        {counts[q.key]}
                        {q.key === 'tickets' && counts[q.key] > 0 ? ` · ${state.users.filter((u) => u.app === app.id && u.queue === 'tickets' && u.tickets[0]?.slaBreached).length} SLA breach` : ''}
                        {q.key === 'payments' && counts[q.key] > 0 ? ` · ${state.users.filter((u) => u.app === app.id && u.queue === 'payments' && u.paymentDue?.status === 'expired').length} expired` : ''}
                      </strong>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 'var(--space-3) var(--space-4)', borderTop: '2px solid var(--color-divider)' }}>
                  <button className="btn btn-primary btn-block" type="button" style={{ margin: 0 }} onClick={() => navigate(`/work/${app.id}`)}>Enter {app.name}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '2px solid var(--color-divider)', display: 'flex', gap: 'var(--space-8)', fontSize: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Your yesterday</div>
            <div style={{ font: '800 16px var(--font-heading)' }}>{yesterdayCalls} calls · {yesterdayPositive} positive · {yesterdaySubs} subscribed</div>
          </div>
          <div>
            <div className="eyebrow">Overdue on you</div>
            <div style={{ font: '800 16px var(--font-heading)', color: 'var(--color-accent-700)' }}>{overdueCount} follow-ups overdue</div>
          </div>
        </div>
      </div>
    </div>
  );
}
