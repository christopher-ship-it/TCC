import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { TECSTELLAR_MARK } from '../assets';
import type { Role } from '../data/types';
import { ROLE_INFO, isActive } from '../lib/access';
import { homeFor } from '../lib/routes';
import { Avatar, Button, Callout, Field, Input } from '../ui/primitives';
import './login.css';

const ROLE_ORDER: Role[] = ['agent', 'supervisor', 'admin'];

export default function LoginPage() {
  const { state, dispatch, ready, backend, currentAgent } = useStore();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (ready && currentAgent && isActive(currentAgent)) return <Navigate to={homeFor(currentAgent.role)} replace />;

  function signIn(u?: string) {
    if (!ready) return;
    const name = (u ?? username).trim().toLowerCase();
    const account = state.agents.find((a) => a.username.toLowerCase() === name);
    if (!account) return setError('No account with that username. Check the spelling, or ask your admin to add you.');
    if ((account.status ?? 'active') === 'suspended') return setError('This account is suspended. Ask your admin to reactivate it.');
    if (account.status === 'invited') return setError('This account has not been set up yet. Use the invite link your admin sent you.');
    dispatch({ type: 'LOGIN', agentId: account.id });
    navigate(homeFor(account.role));
  }

  return (
    <div className="login">
      <aside className="login__brand">
        <div className="row" style={{ gap: 12 }}>
          <img src={TECSTELLAR_MARK} alt="" width={36} height={36} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>Tecstellar</span>
        </div>
        <div className="login__pitch">
          <h1>Command Center</h1>
          <p>Every customer of RealBroks, IronDrobe, Influnet and Vehigo in one place — calls, recordings, follow-ups, payments and the people who handle them.</p>
        </div>
        <div className="login__rule" aria-hidden>
          <span />
          <span />
        </div>
      </aside>

      <main className="login__panel">
        <div className="login__card">
          <div>
            <h2 style={{ fontSize: 22 }}>Sign in</h2>
            <p className="muted" style={{ marginTop: 4 }}>Agents land on today’s queue, supervisors on their team, admins on the overview.</p>
          </div>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            <Field label="Username" htmlFor="tcc-un">
              <Input id="tcc-un" value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }} autoComplete="username" autoFocus placeholder="abhinaya.m" />
            </Field>
            <Field label="Password" htmlFor="tcc-pw">
              <Input id="tcc-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {error && <Callout tone="danger">{error}</Callout>}
            <Button type="submit" variant="primary" size="lg" block disabled={!ready || !username.trim()}>Sign in</Button>
          </form>

          <Callout tone="warn" icon={<ShieldAlert size={16} />}>
            Demo sign-in: passwords are not checked yet. Real accounts arrive with the database and hosting step.
          </Callout>

          <div className="stack" style={{ gap: 10 }}>
            <div className="section-label">Sample accounts</div>
            {!ready ? (
              <span className="muted">Connecting…</span>
            ) : (
              ROLE_ORDER.map((role) => {
                const people = state.agents.filter((a) => a.role === role && isActive(a));
                if (!people.length) return null;
                return (
                  <div key={role} className="login__group">
                    <span className="login__role">{ROLE_INFO[role].label}s</span>
                    <div className="login__people">
                      {people.map((a) => (
                        <button key={a.id} type="button" className="login__person" onClick={() => signIn(a.username)}>
                          <Avatar name={a.name} />
                          <span style={{ minWidth: 0, textAlign: 'left' }}>
                            <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{a.name}{a.trainee ? ' · trainee' : ''}</span>
                            <span className="truncate muted" style={{ display: 'block', fontSize: 12.5 }}>{a.languages.slice(0, 3).join(', ') || 'All apps'}</span>
                          </span>
                          <ArrowRight size={15} className="login__go" />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>{backend === 'firestore' ? 'Live data · connected to Firestore' : 'Sample data in this browser · no database connected yet'}</p>
        </div>
      </main>
    </div>
  );
}
