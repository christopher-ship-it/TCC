import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/StoreContext';
import { TECSTELLAR_MARK, TECSTELLAR_WORDMARK } from '../assets';
import type { AgentAccount } from '../data/types';

function landingFor(role: AgentAccount['role']) {
  if (role === 'agent') return '/launcher';
  if (role === 'supervisor') return '/supervisor';
  return '/owner';
}

export default function LoginPage() {
  const { state, dispatch, ready, backend } = useStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('abhinaya.m');
  const [password, setPassword] = useState('••••••••••');
  const [error, setError] = useState<string | null>(null);

  function signIn(u?: string) {
    if (!ready) return;
    const uname = (u ?? username).trim().toLowerCase();
    const account = state.agents.find((a) => a.username.toLowerCase() === uname);
    if (!account) {
      setError(state.agents.length ? 'No account with that username. Try one of the accounts below.' : 'No accounts found yet.');
      return;
    }
    dispatch({ type: 'LOGIN', agentId: account.id });
    navigate(landingFor(account.role));
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="elev-lg" style={{ width: 880, maxWidth: '100%', background: 'var(--color-bg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', minHeight: 460 }}>
          <div style={{ background: 'var(--brand-gradient)', color: 'var(--color-bg)', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 52, height: 52, objectFit: 'contain', marginBottom: 'var(--space-4)' }} />
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 40, lineHeight: 0.95, letterSpacing: '-.03em' }}>
              Tecstellar<br />Command<br />Center
            </div>
            <div>
              <div style={{ height: 2, background: 'var(--color-bg)', opacity: 0.5, marginBottom: 'var(--space-3)' }} />
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>One console for every app we ship. Users, payments, tickets and follow-ups — no more app-by-app dashboards.</div>
              <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, marginTop: 'var(--space-4)', opacity: 0.8 }}>tcc.tecstellar.com</div>
            </div>
          </div>
          <div style={{ padding: 'var(--space-8) var(--space-6)', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: 'var(--color-neutral-100)' }}>
            <img src={TECSTELLAR_WORDMARK} alt="Tecstellar" style={{ width: 190, height: 'auto', marginBottom: 'var(--space-6)' }} />
            <div className="eyebrow">Sign in</div>
            <h3 style={{ margin: 'var(--space-2) 0 var(--space-6)' }}>Agent, supervisor or admin</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signIn();
              }}
            >
              <div className="field" style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="tcc-un">Username</label>
                <input className="input" id="tcc-un" type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 'var(--space-3)' }}>
                <label htmlFor="tcc-pw">Password</label>
                <input className="input" id="tcc-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <div style={{ color: '#a3271b', fontSize: 12, marginBottom: 'var(--space-3)' }}>{error}</div>}
              <button className="btn btn-primary btn-block" type="submit">Sign in</button>
            </form>
            <div style={{ height: 1, background: 'var(--color-divider)', margin: 'var(--space-6) 0 var(--space-3)' }} />
            <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Quick sign-in · sample accounts</div>
            {!ready ? (
              <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>Connecting to TCC…</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {state.agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="tag tag-outline"
                    style={{ cursor: 'pointer', background: 'none', border: '1px solid var(--color-accent)' }}
                    onClick={() => {
                      setUsername(a.username);
                      signIn(a.username);
                    }}
                  >
                    {a.name} · {a.role}
                  </button>
                ))}
                {state.agents.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>No accounts yet — create one from Supervisor → Team &amp; access.</div>}
              </div>
            )}
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', lineHeight: 1.6, marginTop: 'var(--space-4)' }}>
              Agents land on their queue. Supervisors land on team performance. Admins land on the all-app dashboard.
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-600)', marginTop: 'var(--space-2)' }}>
              {backend === 'firestore' ? 'Live · connected to Firestore' : 'Local demo data · no Firebase project configured'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
