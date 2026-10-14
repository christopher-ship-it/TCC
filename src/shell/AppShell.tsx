import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, ClipboardList, Database, Flag, Headset, History, Home, LogOut, Map, Phone, RotateCcw, Search, Shuffle, Users, UsersRound } from 'lucide-react';
import { TECSTELLAR_MARK } from '../assets';
import { APPS } from '../data/seed';
import type { AppId, Role } from '../data/types';
import { useStore } from '../store/StoreContext';
import { ROLE_INFO, canAnywhere } from '../lib/access';
import { formatDuration, useElapsedSeconds, useTelephonyOptional } from '../telephony';
import { useCallSession } from '../components/telephony/callSessionContext';
import { Avatar } from '../ui/primitives';
import { ScopeContext, type ScopeValue } from './scope';
import './shell.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: number;
}

function navFor(role: Role, pendingEscalations: number, firstApp: AppId | undefined, canExportOrAudit: boolean): { title?: string; items: NavItem[] }[] {
  const s = 17;
  if (role === 'agent') {
    return [
      {
        items: [
          { to: '/home', label: 'Today', icon: <Home size={s} /> },
          { to: firstApp ? `/work/${firstApp}` : '/home', label: 'Call queue', icon: <Headset size={s} /> },
          { to: '/calls', label: 'My calls', icon: <History size={s} /> },
        ],
      },
    ];
  }
  const team: NavItem[] = [
    { to: '/team', label: 'Team performance', icon: <BarChart3 size={s} /> },
    { to: '/calls', label: 'Calls & recordings', icon: <Phone size={s} /> },
    { to: '/escalations', label: 'Escalations', icon: <Flag size={s} />, badge: pendingEscalations || undefined },
    { to: '/allocation', label: 'Allocation', icon: <Shuffle size={s} /> },
  ];
  const people: NavItem[] = [{ to: '/people', label: 'People & access', icon: <UsersRound size={s} /> }];
  if (canExportOrAudit) people.push({ to: '/audit', label: 'Change log', icon: <ClipboardList size={s} /> });
  if (role === 'admin') people.push({ to: '/customers-import', label: 'Customers', icon: <Database size={s} /> });
  if (role === 'supervisor') return [{ title: 'Team', items: team }, { title: 'Admin', items: people }];
  return [
    { title: 'Business', items: [{ to: '/overview', label: 'Overview', icon: <Home size={s} /> }, { to: '/geography', label: 'Geography', icon: <Map size={s} /> }] },
    { title: 'Operations', items: team },
    { title: 'Admin', items: people },
  ];
}

function CustomerSearch({ apps }: { apps: AppId[] }) {
  const { state } = useStore();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if ((e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const digits = t.replace(/\D/g, '');
    return state.users
      .filter((u) => apps.includes(u.app))
      .filter((u) => u.name.toLowerCase().includes(t) || u.business.toLowerCase().includes(t) || u.shopCode.toLowerCase().includes(t) || (digits.length >= 4 && u.phone.replace(/\D/g, '').includes(digits)))
      .slice(0, 8);
  }, [q, state.users, apps]);

  function go(id: string) {
    setQ('');
    setOpen(false);
    input.current?.blur();
    navigate(`/customers/${id}`);
  }

  return (
    <div className="shell-search">
      <Search size={15} aria-hidden />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          if (e.key === 'Enter' && results[active]) go(results[active].id);
          if (e.key === 'Escape') input.current?.blur();
        }}
        placeholder="Search customers by name, phone or shop code"
        aria-label="Search customers"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="shell-search-results"
      />
      <kbd className="kbd shell-search__kbd">/</kbd>
      {open && q.trim().length >= 2 && (
        <ul id="shell-search-results" role="listbox" className="shell-search__menu">
          {results.length === 0 && <li className="shell-search__empty">No customer matches “{q}”.</li>}
          {results.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={() => go(u.id)} className={i === active ? 'is-active' : undefined}>
                <span style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{u.name}</span>
                  <span className="truncate muted" style={{ display: 'block', fontSize: 12.5 }}>{u.business} · {u.city}</span>
                </span>
                <span className="mono muted" style={{ fontSize: 12 }}>{u.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "On a call 02:41" / "Log your call" — visible from every page so a call is never lost. */
function CallPill() {
  const tel = useTelephonyOptional();
  const session = useCallSession();
  const { state } = useStore();
  const call = tel?.snapshot.call;
  const elapsed = useElapsedSeconds(call ? (call.answeredAt ?? call.startedAt) : null);
  const navigate = useNavigate();
  const customerId = call?.meta.customerId ?? session.wrapUp?.customerId;
  if (!customerId) return null;
  const user = state.users.find((u) => u.id === customerId);
  const to = user ? `/work/${user.app}?focus=${user.id}` : '/home';
  return (
    <button type="button" className={`shell-pill${call ? ' shell-pill--live' : ''}`} onClick={() => navigate(to)}>
      <span className={`dot ${call ? 'dot--live' : 'dot--warn'}`} />
      {call ? (
        <>
          {call.state === 'connected' ? 'On a call' : 'Calling'} · <span className="mono">{formatDuration(elapsed)}</span>
        </>
      ) : (
        <>Log your call with {user?.name.split(' ')[0] ?? 'the customer'}</>
      )}
    </button>
  );
}

export default function AppShell() {
  const { state, currentAgent, dispatch, backend } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const visibleApps = useMemo<AppId[]>(() => {
    if (!currentAgent) return [];
    const ids = currentAgent.role === 'admin' ? APPS.map((a) => a.id) : currentAgent.apps;
    return APPS.filter((a) => ids.includes(a.id)).map((a) => a.id);
  }, [currentAgent]);
  const [app, setApp] = useState<AppId | 'all'>('all');
  const scope = useMemo<ScopeValue>(() => ({ app, setApp, visibleApps, apps: app === 'all' ? visibleApps : [app] }), [app, visibleApps]);

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!currentAgent) return null;
  const pending = state.escalations.filter((e) => e.status === 'pending' && visibleApps.includes(e.app)).length;
  const firstLiveApp = visibleApps.find((id) => APPS.find((a) => a.id === id)?.live);
  const nav = navFor(currentAgent.role, pending, firstLiveApp, canAnywhere(currentAgent, 'export') || currentAgent.role !== 'agent');
  const showScope = currentAgent.role !== 'agent' && visibleApps.length > 1 && !location.pathname.startsWith('/people') && !location.pathname.startsWith('/audit') && !location.pathname.startsWith('/customers');

  return (
    <ScopeContext.Provider value={scope}>
      <div className="shell">
        <header className="shell-header">
          <div className="shell-header__row">
            <button type="button" className="shell-brand" onClick={() => navigate('/')} aria-label="Command Center home">
              <img src={TECSTELLAR_MARK} alt="" />
              <span>Command Center</span>
            </button>
            {showScope && (
              <label className="shell-scope">
                <span className="sr-only">Show numbers for</span>
                <select value={app} onChange={(e) => setApp(e.target.value as AppId | 'all')}>
                  <option value="all">All apps</option>
                  {visibleApps.map((id) => (
                    <option key={id} value={id}>{APPS.find((a) => a.id === id)?.name}{APPS.find((a) => a.id === id)?.live ? '' : ' (not live)'}</option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </label>
            )}
            <CustomerSearch apps={visibleApps} />
            <div className="shell-header__right">
              <CallPill />
              <div className="shell-user">
                <button type="button" className="shell-user__btn" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
                  <Avatar name={currentAgent.name} />
                  <span className="shell-user__name">
                    <span>{currentAgent.name}</span>
                    <small>{ROLE_INFO[currentAgent.role].label}{currentAgent.trainee ? ' · trainee' : ''}</small>
                  </span>
                  <ChevronDown size={14} />
                </button>
                {menuOpen && (
                  <div className="shell-user__menu" role="menu">
                    <div className="shell-user__meta">
                      <b>{currentAgent.name}</b>
                      <span className="mono">{currentAgent.username}</span>
                    </div>
                    {backend === 'local' && currentAgent.role === 'admin' && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (!window.confirm('Replace every customer, call and change in this browser with fresh sample data?')) return;
                          dispatch({ type: 'RESET' });
                          navigate('/');
                        }}
                      >
                        <RotateCcw size={15} /> Reset sample data
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        dispatch({ type: 'LOGOUT' });
                        navigate('/');
                      }}
                    >
                      <LogOut size={15} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="shell-rule" aria-hidden>
            <span />
            <span />
          </div>
        </header>
        <div className="shell-body">
          <nav className="shell-nav" aria-label="Main">
            {nav.map((group, gi) => (
              <div key={gi} className="shell-nav__group">
                {group.title && <div className="shell-nav__title">{group.title}</div>}
                {group.items.map((item) => (
                  <NavLink key={item.label} to={item.to} end={item.end} className={({ isActive }) => `shell-nav__item${isActive || (item.to.startsWith('/work') && location.pathname.startsWith('/work')) ? ' active' : ''}`}>
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge ? <span className="shell-nav__badge">{item.badge}</span> : null}
                  </NavLink>
                ))}
              </div>
            ))}
            {currentAgent.role === 'agent' && (
              <div className="shell-nav__group shell-nav__reach">
                <div className="shell-nav__title">You reach</div>
                <div className="shell-nav__note">
                  <Users size={14} /> {currentAgent.languages.join(', ') || 'No languages yet'}
                </div>
              </div>
            )}
          </nav>
          <main className="shell-main" id="main">
            <Outlet />
          </main>
        </div>
      </div>
    </ScopeContext.Provider>
  );
}
