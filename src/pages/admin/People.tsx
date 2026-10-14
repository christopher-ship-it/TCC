import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import type { AgentAccount, Role } from '../../data/types';
import { ROLE_INFO, canManage, isActive, LANGUAGE_SCRIPT } from '../../lib/access';
import { Avatar, Badge, Button, Chip, Empty, Input, PageHead } from '../../ui/primitives';
import { PersonEditor } from './PersonEditor';
import './admin.css';

const ABBR: Record<string, string> = { realbroks: 'RB', irondrobe: 'ID', influnet: 'IN', vehigo: 'VG', vanmoh: 'VM' };

export default function People() {
  const { state, currentAgent } = useStore();
  const actor = currentAgent!;
  const [params, setParams] = useSearchParams();
  const [role, setRole] = useState<Role | 'all'>('all');
  const [showSuspended, setShowSuspended] = useState(false);
  const [q, setQ] = useState('');
  const editId = params.get('edit');
  const editing = editId === 'new' ? 'new' : state.agents.find((a) => a.id === editId);

  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const callsToday = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of state.users) for (const c of u.callHistory) if (c.atTs >= startOfToday) m.set(c.agentName, (m.get(c.agentName) ?? 0) + 1);
    return m;
  }, [state.users, startOfToday]);

  const visible = state.agents.filter((a) => (actor.role === 'admin' ? true : a.role === 'agent' || a.id === actor.id));
  const people = visible
    .filter((a) => role === 'all' || a.role === role)
    .filter((a) => showSuspended || isActive(a))
    .filter((a) => !q.trim() || `${a.name} ${a.username} ${a.languages.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => ['admin', 'supervisor', 'agent'].indexOf(a.role) - ['admin', 'supervisor', 'agent'].indexOf(b.role) || a.name.localeCompare(b.name));

  const suspended = visible.filter((a) => !isActive(a)).length;
  const open = (id: string) => setParams({ edit: id });
  const close = () => setParams({}, { replace: true });

  return (
    <div className="page">
      <PageHead
        title="People & access"
        desc="Who can sign in, what each person may do in each app, and which customers they reach. Every change is logged."
        actions={canManage(actor) && <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => open('new')}>Add a person</Button>}
      />
      <div className="row" style={{ gap: 8 }}>
        {(['all', 'agent', 'supervisor', 'admin'] as const)
          .filter((r) => actor.role === 'admin' || r === 'all' || r === 'agent')
          .map((r) => (
            <Chip key={r} pressed={role === r} onClick={() => setRole(r)}>
              {r === 'all' ? 'Everyone' : `${ROLE_INFO[r].label}s`} <span className="mono muted">{r === 'all' ? visible.filter(isActive).length : visible.filter((a) => a.role === r && isActive(a)).length}</span>
            </Chip>
          ))}
        {suspended > 0 && <Chip pressed={showSuspended} onClick={() => setShowSuspended((s) => !s)}>Show suspended ({suspended})</Chip>}
        <Input aria-label="Find a person" placeholder="Name, username or language" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260, marginLeft: 'auto' }} />
      </div>

      {people.length === 0 ? (
        <Empty title="Nobody matches" />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Apps</th>
                <th>Queues</th>
                <th>Speaks</th>
                <th>Status</th>
                <th className="r">Calls today</th>
              </tr>
            </thead>
            <tbody>
              {people.map((a: AgentAccount) => (
                <tr key={a.id} className={`is-clickable${editId === a.id ? ' is-selected' : ''}`} onClick={() => open(a.id)}>
                  <td>
                    <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                      <Avatar name={a.name} />
                      <span>
                        <button type="button" className="btn btn--link" style={{ color: 'var(--ink)', fontWeight: 500 }} onClick={(e) => { e.stopPropagation(); open(a.id); }}>{a.name}</button>
                        <span className="mono muted" style={{ display: 'block', fontSize: 12 }}>{a.username}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    {ROLE_INFO[a.role].label}
                    {a.trainee && <> <Badge tone="accent">Trainee</Badge></>}
                  </td>
                  <td>
                    <span className="people-apps">
                      {(a.role === 'admin' ? APPS.map((x) => x.id) : a.apps).map((id) => <span key={id} className="app-tag" title={APPS.find((x) => x.id === id)?.name}>{ABBR[id]}</span>)}
                    </span>
                  </td>
                  <td className="mono">{a.role === 'admin' ? 'All' : a.queues.length}</td>
                  <td>{a.languages.length > 4 ? `${a.languages.length} languages` : a.languages.map((l) => LANGUAGE_SCRIPT[l]).join(' · ') || '—'}</td>
                  <td>
                    {isActive(a) ? (
                      <Badge tone="ok" dot>{a.id === actor.id ? 'You' : a.lastActiveLabel.startsWith('now') ? 'Online' : 'Active'}</Badge>
                    ) : (
                      <Badge tone="danger" dot>{a.status === 'invited' ? 'Invited' : 'Suspended'}</Badge>
                    )}
                  </td>
                  <td className="r mono">{a.role === 'admin' ? '—' : callsToday.get(a.name) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <PersonEditor key={editId} person={editing === 'new' ? undefined : editing} onClose={close} />}
    </div>
  );
}
