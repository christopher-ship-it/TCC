import { NavLink, useNavigate } from 'react-router-dom';
import { TECSTELLAR_MARK } from '../assets';
import { useStore } from '../store/StoreContext';

const TABS = [
  { to: '/supervisor', label: 'Team performance', end: true },
  { to: '/supervisor/team', label: 'Team & access', end: false },
  { to: '/supervisor/allocation', label: 'Allocation', end: false },
  { to: '/supervisor/escalations', label: 'Escalations', end: false },
];

export default function SupervisorNav() {
  const { state, currentAgent, dispatch } = useStore();
  const navigate = useNavigate();
  const pending = state.escalations.filter((e) => e.status === 'pending').length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 52, padding: '0 var(--space-4)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
      <button type="button" onClick={() => navigate('/supervisor')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
        <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 22, height: 22, objectFit: 'contain' }} />
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>TCC</span>
      </button>
      <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 12, alignItems: 'center' }}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            style={({ isActive }) => ({
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--color-text)' : 'var(--color-neutral-700)',
              borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
              paddingBottom: 2, textDecoration: 'none',
            })}
          >
            {t.label}
            {t.label === 'Escalations' && pending > 0 && <span style={{ background: 'var(--color-accent)', color: 'var(--color-bg)', padding: '0 5px', fontWeight: 800, marginLeft: 6 }}>{pending}</span>}
          </NavLink>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 12, color: 'var(--color-neutral-700)' }}>
        <strong style={{ color: 'var(--color-text)' }}>{currentAgent?.name}</strong> · Supervisor
        <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => { dispatch({ type: 'LOGOUT' }); navigate('/'); }}>sign out</button>
      </div>
    </div>
  );
}
