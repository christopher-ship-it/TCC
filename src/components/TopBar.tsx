import type React from 'react';
import { useNavigate } from 'react-router-dom';
import { TECSTELLAR_MARK } from '../assets';
import { useStore } from '../store/StoreContext';

export default function TopBar({ dark, right, subtitle }: { dark?: boolean; right?: React.ReactNode; subtitle?: React.ReactNode }) {
  const { dispatch } = useStore();
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 52, padding: '0 var(--space-4)',
        borderBottom: '2px solid var(--color-divider)',
        background: dark ? 'var(--color-neutral-900)' : 'var(--color-neutral-100)',
        color: dark ? 'var(--color-neutral-100)' : 'inherit',
      }}
    >
      <button
        type="button"
        onClick={() => navigate('/')}
        style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}
      >
        <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 22, height: 22, objectFit: 'contain' }} />
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>TCC</span>
      </button>
      {subtitle && <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', opacity: dark ? 0.75 : 1, color: dark ? undefined : 'var(--color-neutral-700)' }}>{subtitle}</div>}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontSize: 12 }}>
        {right}
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'LOGOUT' });
            navigate('/');
          }}
          className="btn-ghost btn"
          style={{ padding: 0, fontSize: 12, color: dark ? 'var(--color-accent-400)' : 'var(--color-accent)' }}
        >
          sign out
        </button>
      </div>
    </div>
  );
}
