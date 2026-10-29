import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, CalendarClock, ChevronDown, ClipboardList, Contact, Database, KeyRound, Flag, Headset, History, Home, LogOut, Map, NotebookPen, Phone, Repeat, RotateCcw, Search, Shuffle, Users, UsersRound } from 'lucide-react';
import { BRAND_MARK } from '../assets';
import { APPS } from '../data/seed';
import type { AppId, Role } from '../data/types';
import { useStore } from '../store/StoreContext';
import { ROLE_INFO, canAnywhere } from '../lib/access';
import { formatDuration, useElapsedSeconds, useTelephonyOptional } from '../telephony';
import { useCallSession } from '../components/telephony/callSessionContext';
import { LineStatus } from '../components/telephony/LineStatus';
import { Avatar } from '../ui/primitives';
import { useToast } from '../ui/toastContext';
import { BRAND } from '../brand';
import { FEATURES } from '../lib/features';
import { isFollowUpOf, scheduledFollowUps, startOfDay } from '../lib/followUps';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScopeContext, type ScopeValue } from './scope';
import { ChangePasswordDialog, InboxBanner, InboxBell } from '../components/inbox/Inbox';
import './shell.css';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: number;
}

function navFor(role: Role, pendingEscalations: number, firstApp: AppId | undefined, canExportOrAudit: boolean, addFirst: boolean, showLog = true, dueFollowUps = 0): { title?: string; items: NavItem[] }[] {
  const s = 17;
  const followUps: NavItem = { to: '/follow-ups', label: 'Follow-ups', icon: <CalendarClock size={s} />, badge: dueFollowUps || undefined };
  const notes: NavItem = { to: '/notes', label: 'Notes', icon: <NotebookPen size={s} /> };
  const customers: NavItem = { to: '/customers', label: 'Customers', icon: <Contact size={s} />, end: true };
  if (role === 'agent') {
    return [
      {
        items: [
          ...(FEATURES.todayPage ? [{ to: '/home', label: 'Today', icon: <Home size={s} /> }] : []),
          { to: firstApp ? `/work/${firstApp}` : '/home', label: 'Call queue', icon: <Headset size={s} /> },
          followUps,
          ...(addFirst ? [customers] : []),
          { to: '/calls', label: 'My calls', icon: <History size={s} /> },
          ...(addFirst ? [notes] : []),
        ],
      },
    ];
  }
  const X = FEATURES.adminExtras;
  const team: NavItem[] = [
    ...(X ? [{ to: '/team/performance', label: 'Team performance', icon: <BarChart3 size={s} /> }] : []),
    ...(addFirst ? [customers] : []),
    followUps,
    { to: '/calls', label: 'Calls & recordings', icon: <Phone size={s} /> },
    ...(addFirst ? [notes] : []),
    { to: '/escalations', label: 'Escalations', icon: <Flag size={s} />, badge: pendingEscalations || undefined },
    ...(X ? [{ to: '/allocation', label: 'Allocation', icon: <Shuffle size={s} /> }] : []),
  ];
  const people: NavItem[] = [{ to: '/people', label: 'Agents', icon: <UsersRound size={s} /> }];
  if (role === 'admin' && !addFirst) people.push({ to: '/customers-import', label: 'Import data', icon: <Database size={s} /> });
  if (canExportOrAudit && showLog) people.push({ to: '/audit', label: 'Change log', icon: <ClipboardList size={s} /> });
  const overview: NavItem = { to: role === 'admin' ? '/overview' : '/team', label: 'Overview', icon: <Home size={s} /> };
  return [
    { items: [overview, ...team] },
    { title: 'Manage', items: [...people, ...(X && role === 'admin' ? [{ to: '/geography', label: 'Geography', icon: <Map size={s} /> }] : [])] },
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
      .filter((u) => apps.includes(u.app) && !u.deleted)
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
        placeholder="Quick search…"
        aria-label="Search customers"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="shell-search-results"
      />
      <kbd className="kbd shell-search__kbd">⌘K</kbd>
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

/** Shared-database builds: whether this browser's changes have reached the server. Quiet when all is saved. */
function SyncStatus() {
  const { sync } = useStore();
  if (!sync || (!sync.error && sync.pending === 0)) return null;
  return (
    <span className={`shell-pill${sync.error ? ' shell-pill--warn' : ''}`} title={sync.error ?? undefined} role="status">
      <span className={`dot ${sync.error ? 'dot--warn' : ''}`} />
      {sync.error ? 'Not saved — retrying' : 'Saving…'}
    </span>
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
          {call.state === 'connected' ? 'On a call' : call.state === 'incoming' ? 'Incoming call' : 'Calling'} · <span className="mono">{formatDuration(elapsed)}</span>
        </>
      ) : (
        <>Log your call with {user?.name.split(' ')[0] ?? 'the customer'}</>
      )}
    </button>
  );
}

export default function AppShell() {
  const { state, currentAgent, dispatch, backend, requestPasswordChange, visibility, product, chooseProduct } = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [changingPw, setChangingPw] = useState(false);

  const visibleApps = useMemo<AppId[]>(() => {
    if (!currentAgent) return [];
    const ids = currentAgent.role === 'admin' ? APPS.map((a) => a.id) : currentAgent.apps;
    return APPS.filter((a) => ids.includes(a.id)).map((a) => a.id);
  }, [currentAgent]);
  // Admins can still look across products from the header; they start in the one they signed in to.
  const [app, setApp] = useState<AppId | 'all'>(() => (product && APPS.length > 1 ? product : 'all'));
  const scope = useMemo<ScopeValue>(() => ({ app, setApp, visibleApps, apps: app === 'all' ? visibleApps : [app] }), [app, visibleApps]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Follow-ups due today or overdue: an agent's own (as on the Follow-ups page under "Mine"), everyone's for the rest.
  const dueFollowUps = useMemo(() => {
    if (!currentAgent) return 0;
    const end = startOfDay(Date.now()) + 86_400_000;
    const me = currentAgent;
    return scheduledFollowUps(state.users.filter((u) => visibleApps.includes(u.app))).filter(
      (f) => f.dueTs < end && (me.role !== 'agent' || isFollowUpOf(f.user, me)),
    ).length;
  }, [state.users, visibleApps, currentAgent]);

  if (!currentAgent) return null;
  const pending = state.escalations.filter((e) => e.status === 'pending' && visibleApps.includes(e.app)).length;
  const firstLiveApp = visibleApps.find((id) => APPS.find((a) => a.id === id)?.live);
  const nav = navFor(currentAgent.role, pending, firstLiveApp, canAnywhere(currentAgent, 'export') || currentAgent.role !== 'agent', backend === 'server', currentAgent.superAdmin || visibility?.changeLog !== false, dueFollowUps);
  if (currentAgent.superAdmin) nav.unshift({ title: 'Super admin', items: [{ to: '/system', label: 'System', icon: <Activity size={17} /> }] });
  const showScope = currentAgent.role !== 'agent' && visibleApps.length > 1 && !location.pathname.startsWith('/people') && !location.pathname.startsWith('/audit') && !location.pathname.startsWith('/customers');

  return (
    <ScopeContext.Provider value={scope}>
      <div className="shell">
        <aside className="shell-side">
          <button type="button" className="shell-brand" onClick={() => navigate('/')} aria-label="Command Center home">
            <img src={BRAND_MARK} alt="" />
            <span>
              <b>{BRAND.key === 'tecstellar' ? 'Tecstellar' : BRAND.title}</b>
              <small>{APPS.length > 1 && product ? `${APPS.find((a) => a.id === product)?.name} · Calling desk` : 'Calling desk'}</small>
            </span>
          </button>
          <CustomerSearch apps={visibleApps} />
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
        </aside>
        <div className="shell-col">
          <header className="shell-top">
            {showScope && (
              <label className="shell-scope">
                <span className="sr-only">Show numbers for</span>
                <select value={app} onChange={(e) => setApp(e.target.value as AppId | 'all')}>
                  <option value="all">All products</option>
                  {visibleApps.map((id) => (
                    <option key={id} value={id}>{APPS.find((a) => a.id === id)?.name}{APPS.find((a) => a.id === id)?.live ? '' : ' (not live)'}</option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </label>
            )}
            <div className="shell-top__right">
              <SyncStatus />
              {backend === 'server' && <InboxBell />}
              <CallPill />
              <LineStatus />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="shell-user__btn">
                    <Avatar name={currentAgent.name} />
                    <span className="shell-user__name">
                      <span>{currentAgent.name}</span>
                      <small>{ROLE_INFO[currentAgent.role].label}{currentAgent.trainee ? ' · trainee' : ''}</small>
                    </span>
                    <ChevronDown size={14} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{currentAgent.username}</DropdownMenuLabel>
                  {backend === 'local' && currentAgent.role === 'admin' && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (!window.confirm('Replace every customer, call and change in this browser with fresh sample data?')) return;
                        dispatch({ type: 'RESET' });
                        navigate('/');
                      }}
                    >
                      <RotateCcw /> Reset sample data
                    </DropdownMenuItem>
                  )}
                  {backend === 'server' && (
                    <DropdownMenuItem
                      onSelect={() => {
                        if (currentAgent.superAdmin) return setChangingPw(true);
                        void requestPasswordChange?.().then((r) => toast(r.ok ? 'Request sent. The super admin will set it up or send you a card to choose it.' : r.message));
                      }}
                    >
                      <KeyRound /> {currentAgent.superAdmin ? 'Change password' : 'Request password change'}
                    </DropdownMenuItem>
                  )}
                  {APPS.length > 1 && (
                    <DropdownMenuItem
                      onSelect={() => {
                        chooseProduct(null);
                        navigate('/');
                      }}
                    >
                      <Repeat /> Switch product
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      dispatch({ type: 'LOGOUT' });
                      navigate('/');
                    }}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <InboxBanner />
          <main className="shell-main" id="main">
            <Outlet />
          </main>
          {changingPw && <ChangePasswordDialog onClose={() => setChangingPw(false)} />}
        </div>
      </div>
    </ScopeContext.Provider>
  );
}
