import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Lock, ShieldAlert } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { APP_LOGOS, BRAND_MARK } from '../assets';
import { BRAND, WHITE_LABEL } from '../brand';
import { ALL_PRODUCTS, APPS } from '../data/seed';
import type { AgentAccount, AppDef, AppId, Role } from '../data/types';
import { ROLE_INFO, isActive, listJoin } from '../lib/access';
import { homeFor } from '../lib/routes';
import { mayEnter, noAccessMessage } from '../lib/product';
import { Avatar, Button, Callout, Field, Input } from '../ui/primitives';
import './login.css';

const ROLE_ORDER: Role[] = ['agent', 'supervisor', 'admin'];

/** First visit to a deployment with an empty database: whoever sets it up becomes its first admin. */
function SetupForm() {
  const { setup } = useStore();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!setup) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    const r = await setup!.run({ name: name.trim(), username: username.trim().toLowerCase(), password, code: code.trim() || undefined });
    setBusy(false);
    if (!r.ok) setError(r.message);
  }

  return (
    <>
      <div>
        <h2 style={{ fontSize: 22 }}>Set up Command Center</h2>
        <p className="muted" style={{ marginTop: 4 }}>Create the admin account. You’ll then add your agents and give each one a password.</p>
      </div>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="Your name" htmlFor="su-name">
          <Input id="su-name" value={name} onChange={(e) => { setName(e.target.value); setError(null); }} autoFocus placeholder="Priya Raman" />
        </Field>
        <Field label="Username" htmlFor="su-user" hint="What you type to sign in. Lowercase letters, numbers, dots.">
          <Input id="su-user" value={username} onChange={(e) => { setUsername(e.target.value.toLowerCase()); setError(null); }} autoComplete="username" placeholder="admin" />
        </Field>
        <Field label="Password" htmlFor="su-pw" hint="At least 6 characters.">
          <Input id="su-pw" type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} autoComplete="new-password" />
        </Field>
        <Field label="Password again" htmlFor="su-pw2">
          <Input id="su-pw2" type="password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null); }} autoComplete="new-password" />
        </Field>
        {setup.codeRequired && (
          <Field label="Setup code" htmlFor="su-code" hint="The code you were given with this address.">
            <Input id="su-code" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} autoComplete="off" />
          </Field>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" size="lg" block disabled={busy || !name.trim() || !username.trim() || !password || !confirm || (setup.codeRequired && !code.trim())}>{busy ? 'Creating…' : 'Create admin account'}</Button>
      </form>
    </>
  );
}

/** A build with more than one product signs in to one product at a time (src/lib/product.ts). */
const PICKING = APPS.length > 1;
const runs = (a: AppDef) => a.live && APPS.some((x) => x.id === a.id);
const nameOf = (id: AppId) => ALL_PRODUCTS.find((a) => a.id === id)?.name ?? id;

/** Every product as a card. One this deployment doesn't run yet, or (signed in) one the account doesn't have, is shown but locked. */
function ProductCards({ account, onPick }: { account?: AgentAccount | null; onPick: (id: AppId) => void }) {
  return (
    <div className="login__products" role="list">
      {ALL_PRODUCTS.map((a) => {
        const soon = !runs(a);
        const locked = !soon && account ? !mayEnter(account, a.id) : false;
        return (
          <button key={a.id} type="button" role="listitem" className="login__product" disabled={soon} aria-disabled={soon || locked} data-locked={locked || undefined} onClick={() => onPick(a.id)}>
            <img src={APP_LOGOS[a.id]} alt={a.name} className="login__product-logo" />
            <span className="login__product-tag">{a.tagline}</span>
            <span className="login__product-foot">
              {soon ? <span className="login__product-state">Coming soon</span> : locked ? <span className="login__product-state"><Lock size={12} /> No access</span> : <span className="login__product-go">Sign in <ArrowRight size={14} /></span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function LoginPage() {
  const { state, dispatch, ready, backend, currentAgent, signInWithPassword, sendPasswordReset, accessProblem, setup, product, chooseProduct } = useStore();
  const live = backend !== 'local';
  const byEmail = backend === 'firestore';
  const blurb = WHITE_LABEL ? BRAND.loginBlurb : BRAND.loginBlurb.replace('RealBroks, IronDrobe, Influnet and Vehigo', listJoin(APPS.map((a) => a.name)));
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The card clicked on this page, before signing in to it. */
  const [picked, setPicked] = useState<AppId | null>(null);

  const signedIn = ready && currentAgent && isActive(currentAgent);
  if (signedIn && (product || !PICKING)) return <Navigate to={currentAgent.superAdmin ? '/system' : homeFor(currentAgent.role)} replace />;

  async function signInLive() {
    if (!signInWithPassword || busy) return;
    setBusy(true);
    setInfo(null);
    if (picked) chooseProduct(picked);
    const r = await signInWithPassword(username, password, picked ?? undefined);
    setBusy(false);
    if (!r.ok) {
      chooseProduct(null);
      setError(r.message);
    }
  }

  async function forgot() {
    if (!sendPasswordReset) return;
    if (!username.trim()) return setError('Type your email first, then choose “Forgot password”.');
    const r = await sendPasswordReset(username);
    if (!r.ok) return setError(r.message);
    setError(null);
    setInfo('If that email has a login, a link to choose a new password is on its way.');
  }

  function signIn(u?: string) {
    if (!ready) return;
    const name = (u ?? username).trim().toLowerCase();
    const account = state.agents.find((a) => a.username.toLowerCase() === name);
    if (!account) return setError('No account with that username. Check the spelling, or ask your admin to add you.');
    if ((account.status ?? 'active') === 'suspended') return setError('This account is suspended. Ask your admin to reactivate it.');
    if (account.status === 'invited') return setError('This account has not been set up yet. Use the invite link your admin sent you.');
    if (picked && !mayEnter(account, picked)) return setError(noAccessMessage(nameOf(picked)));
    if (picked) chooseProduct(picked);
    dispatch({ type: 'LOGIN', agentId: account.id });
    navigate(homeFor(account.role));
  }

  /** Signed in, but not into a product yet (or no longer allowed into the last one): pick one, without a password. */
  function enter(id: AppId) {
    if (!currentAgent) return;
    if (!mayEnter(currentAgent, id)) return setError(noAccessMessage(nameOf(id)));
    chooseProduct(id);
  }

  const pickedApp = picked ? ALL_PRODUCTS.find((a) => a.id === picked) : undefined;
  const showCards = PICKING && !picked;
  const samplePeople = (role: Role) => state.agents.filter((a) => a.role === role && isActive(a) && (!picked || mayEnter(a, picked)));

  return (
    <div className="login">
      <aside className="login__brand">
        <div className="row" style={{ gap: 12 }}>
          <img className="login__mark" src={BRAND_MARK} alt="" width={36} height={36} />
          <span style={{ fontSize: 17, fontWeight: 600 }}>{BRAND.name}</span>
        </div>
        <div className="login__pitch">
          <h1>{BRAND.loginHeadline}</h1>
          <p>{blurb}</p>
        </div>
        <div className="login__rule" aria-hidden>
          <span />
          <span />
        </div>
      </aside>

      <main className="login__panel">
        <div className="login__card">
          {setup?.needed && !setup.allowed ? (
            <div>
              <h2 style={{ fontSize: 22 }}>Not set up yet</h2>
              <p className="muted" style={{ marginTop: 4 }}>This Command Center has no accounts yet. Tecstellar will send you your sign-in.</p>
            </div>
          ) : setup?.needed ? <SetupForm /> : signedIn ? <>
          <div>
            <h2 style={{ fontSize: 22 }}>Choose a product</h2>
            <p className="muted" style={{ marginTop: 4 }}>Signed in as {currentAgent.name}. Pick the product you’re working on.</p>
          </div>
          <ProductCards account={currentAgent} onPick={enter} />
          {error && <Callout tone="danger">{error}</Callout>}
          <button type="button" className="btn btn--link" style={{ alignSelf: 'center' }} onClick={() => { setError(null); dispatch({ type: 'LOGOUT' }); }}>Sign in as someone else</button>
          </> : showCards ? <>
          <div>
            <h2 style={{ fontSize: 22 }}>Sign in</h2>
            <p className="muted" style={{ marginTop: 4 }}>Choose the product you work on. You can sign in to the ones your account has.</p>
          </div>
          <ProductCards onPick={(id) => { setPicked(id); setError(null); }} />
          {backend !== 'server' && <p className="muted" style={{ fontSize: 12.5 }}>{backend === 'firestore' ? 'Live data · connected to Firestore' : 'Sample data in this browser · no database connected yet'}</p>}
          </> : <>
          {pickedApp && (
            <button type="button" className="btn btn--link login__back" onClick={() => { setPicked(null); setError(null); }}>
              <ArrowLeft size={14} /> All products
            </button>
          )}
          <div>
            {pickedApp && <img src={APP_LOGOS[pickedApp.id]} alt={pickedApp.name} className="login__picked-logo" />}
            <h2 style={{ fontSize: 22, marginTop: pickedApp ? 14 : 0 }}>{pickedApp ? `Sign in to ${pickedApp.name}` : 'Sign in'}</h2>
            <p className="muted" style={{ marginTop: 4 }}>Agents land on today’s queue, supervisors on their team, admins on the overview.</p>
          </div>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (live) void signInLive();
              else signIn();
            }}
          >
            <Field label={byEmail ? 'Email' : backend === 'server' ? 'Username or email' : 'Username'} htmlFor="tcc-un">
              <Input id="tcc-un" type={byEmail ? 'email' : 'text'} value={username} onChange={(e) => { setUsername(e.target.value); setError(null); }} autoComplete="username" autoFocus placeholder={byEmail ? BRAND.emailPlaceholder : BRAND.usernamePlaceholder} />
            </Field>
            <Field label="Password" htmlFor="tcc-pw">
              <Input id="tcc-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            {(error ?? accessProblem) && <Callout tone="danger">{error ?? accessProblem}</Callout>}
            {info && <Callout tone="ok">{info}</Callout>}
            <Button type="submit" variant="primary" size="lg" block disabled={!ready || busy || !username.trim() || (live && !password)}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            {byEmail && <button type="button" className="btn btn--link" style={{ alignSelf: 'center' }} onClick={() => void forgot()}>Forgot password?</button>}
            {backend === 'server' && <span className="muted" style={{ fontSize: 13, textAlign: 'center' }}>Forgot your password? Ask your admin to set a new one.</span>}
          </form>

          {!live && (
            <Callout tone="warn" icon={<ShieldAlert size={16} />}>
              Demo sign-in: no database is connected, so passwords are not checked and the data stays in this browser.
            </Callout>
          )}

          {!live && <div className="stack" style={{ gap: 10 }}>
            <div className="section-label">Sample accounts{pickedApp ? ` with ${pickedApp.name}` : ''}</div>
            {!ready ? (
              <span className="muted">Connecting…</span>
            ) : (
              ROLE_ORDER.map((role) => {
                const people = samplePeople(role);
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
          </div>}
          {backend !== 'server' && <p className="muted" style={{ fontSize: 12.5 }}>{backend === 'firestore' ? 'Live data · connected to Firestore' : 'Sample data in this browser · no database connected yet'}</p>}
          </>}
        </div>
      </main>
    </div>
  );
}
