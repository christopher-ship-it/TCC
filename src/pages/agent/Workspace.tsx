import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, Flag, Inbox, Phone as PhoneIcon, Ticket, UserPlus } from 'lucide-react';
import { AddCustomerDialog } from '../../components/customers/AddCustomerDialog';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { BRAND, outcomeLabel } from '../../brand';

const F = BRAND.fields;
import { CALL_STATUS_LIST, NEGATIVE_OUTCOMES, OUTCOME_LIST, POSITIVE_OUTCOMES, PRIORITIES, QUEUES, type AppId, type CallStatus, type Outcome, type QueueKey } from '../../data/types';
import { outOfReach, queueCounts, tasksForQueue, waitingForYou } from '../../lib/queue';
import { FilterBar, SearchFilter, SelectFilter, useFilters } from '../../ui/filters';
import { textMatch } from '../../lib/filters';
import { CUSTOMER_LANGUAGES } from '../../lib/languages';
import { queueNote } from '../../lib/queueNotes';
import { whyInQueue } from '../../lib/whyInQueue';
import { can, LANGUAGE_SCRIPT } from '../../lib/access';
import { DEFAULT_COUNTRY_CODE, suggestStatus, toCallTelephony } from '../../lib/telephony';
import { adHocCustomer, adHocId, directDialDigits } from '../../lib/directDial';
import { originForNewCustomer } from '../../lib/world';
import { OriginBadge } from '../../components/customer/DataSource';
import { formatDuration, useTelephonyOptional } from '../../telephony';
import { Phone } from '../../components/telephony/Phone';
import { useCallSession } from '../../components/telephony/callSessionContext';
import { EscalateDialog } from '../../components/agent/EscalateDialog';
import { TicketDialog } from '../../components/agent/TicketDialog';
import { OutcomeBadge, PriorityBadge, SentimentBadge, priorityRowStyle } from '../../components/calls/badges';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button as UiButton } from '@/components/ui/button';
import { Badge as UiBadge } from '@/components/ui/badge';
import { Card as UiCard } from '@/components/ui/card';
import { FEATURES } from '../../lib/features';
import { customerTypesFor } from '../../data/products';
import { Button, Callout, Card, Empty, Input, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';
import './agent.css';
import { CustomerName, FillDetailsButton } from '../../components/customers/CustomerDetails';
import { nameUnknown, placeLine } from '../../lib/appSync';

const STATUS_LABEL: Record<CallStatus, string> = {
  'Answered — DG': 'Answered — DG',
  'Answered — DNG': 'Answered — DNG',
  'Answered — Followup': 'Answered — follow-up',
  'Not Reachable': 'Not reachable',
  'No Answer': 'No answer',
};

/** Call a number that isn't in the customer list; the call is logged, recorded and analysed like any other. */
function DialNumber({ appId, disabled }: { appId: AppId; disabled: boolean }) {
  const { state, dispatch, currentAgent } = useStore();
  const session = useCallSession();
  const [, setParams] = useSearchParams();
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tel = useTelephonyOptional();
  if (!tel) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = directDialDigits(raw, DEFAULT_COUNTRY_CODE);
    if (!digits) return setError('That doesn’t look like a phone number.');
    // A demo account's numbers are demo records, kept apart from the real list.
    const origin = originForNewCustomer(currentAgent);
    const user = state.users.find((u) => u.id === adHocId(digits, origin === 'sample')) ?? adHocCustomer(digits, appId, Date.now(), origin);
    if (user.app !== appId) return setError(`That number was already dialled under ${user.app}.`);
    if (!state.users.some((u) => u.id === user.id)) dispatch({ type: 'ADD_CUSTOMER', customer: user });
    const r = session.dial(user);
    if (!r.ok) return setError(r.message);
    setError(null);
    setRaw('');
    setParams({ focus: user.id }, { replace: true });
  }

  return (
    <form className="ws-dial" onSubmit={submit}>
      <Input id="ws-dial" aria-label="Dial a number" inputMode="tel" placeholder="Dial a number" value={raw} disabled={disabled} onChange={(e) => { setRaw(e.target.value); setError(null); }} />
      <Button type="submit" size="sm" disabled={disabled || !raw.trim()}>Call</Button>
      {error && <span role="alert" className="ws-dial__error">{error}</span>}
    </form>
  );
}

export default function Workspace() {
  const { appId } = useParams<{ appId: AppId }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, dispatch, currentAgent, backend } = useStore();
  const toast = useToast();
  const session = useCallSession();
  // With a real database, customers are added by hand (mobile number first), then called.
  const addFirst = backend === 'server';
  const [adding, setAdding] = useState(false);
  const tel = useTelephonyOptional();
  const agent = currentAgent!;
  const app = APPS.find((a) => a.id === appId);
  const myApps = APPS.filter((a) => a.live && can(agent, a.id, 'call'));
  const queues = QUEUES.filter((q) => agent.queues.includes(q.key));
  const counts = appId ? queueCounts(agent, state.users, appId) : ({} as Record<QueueKey, number>);

  const queueParam = params.get('queue') as QueueKey | null;
  const selectedQueue: QueueKey | null = queueParam && agent.queues.includes(queueParam) ? queueParam : (queues.find((q) => counts[q.key] > 0)?.key ?? queues[0]?.key ?? null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const types = appId ? customerTypesFor(appId) : [];
  const queueTasks = useMemo(() => (appId && selectedQueue ? tasksForQueue(agent, state.users, appId, selectedQueue).filter((u) => !skipped.has(u.id)) : []), [agent, state.users, appId, selectedQueue, skipped]);
  const { values: wf, set: setWf, reset: resetWf, active: wfActive } = useFilters(['wq', 'wprio', 'wlang', 'wcity', 'wcalled'] as const);
  const byType = useMemo(() => (typeFilter === 'All' ? queueTasks : queueTasks.filter((u) => u.customerType === typeFilter)), [queueTasks, typeFilter]);
  const list = useMemo(
    () =>
      byType
        .filter((u) => !wf.wprio || (u.priority ?? 'none') === wf.wprio)
        .filter((u) => !wf.wlang || u.language === wf.wlang)
        .filter((u) => !wf.wcity || u.city === wf.wcity)
        .filter((u) => !wf.wcalled || (wf.wcalled === 'never' ? u.callHistory.length === 0 : u.callHistory.length > 0))
        .filter((u) => textMatch(wf.wq, u.name, u.business, u.phone, u.city)),
    [byType, wf],
  );
  const cities = useMemo(() => [...new Set(queueTasks.map((u) => u.city))].sort(), [queueTasks]);
  // Only worked out when this person has nothing to call: why the product's other customers aren't theirs.
  const waiting = useMemo(() => (appId ? waitingForYou(agent, state.users, appId) : 0), [agent, state.users, appId]);
  const unreachable = useMemo(() => (appId && queueTasks.length === 0 ? outOfReach(agent, state.users, appId) : null), [agent, state.users, appId, queueTasks.length]);
  const focusId = params.get('focus');
  // The customer on a live or unlogged call stays on screen even after leaving the queue.
  const pinnedId = session.liveCustomerId ?? session.wrapUp?.customerId ?? null;
  const pinned = pinnedId ? state.users.find((u) => u.id === pinnedId && u.app === appId) : undefined;
  const user = pinned ?? (focusId ? (state.users.find((u) => u.id === focusId && u.app === appId) ?? list[0]) : list[0]);

  const [status, setStatus] = useState<CallStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [comment, setComment] = useState('');
  const [dialog, setDialog] = useState<'escalate' | 'ticket' | null>(null);
  const callLive = !!tel?.snapshot.call;
  const wrapHere = session.wrapUp && user && session.wrapUp.customerId === user.id ? session.wrapUp : null;

  // Arrived from "Add and call" elsewhere: ring the customer once they're on screen.
  const wantCall = params.get('call') === '1';
  useEffect(() => {
    if (!wantCall || !user || user.id !== focusId || callLive || session.wrapUp) return;
    setParams((p) => { p.delete('call'); return p; }, { replace: true });
    const r = session.dial(user);
    if (!r.ok) toast(r.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantCall, user?.id, focusId]);


  // An ended call pre-fills what the line already knows.
  useEffect(() => {
    if (wrapHere) setStatus(suggestStatus(wrapHere.result));
  }, [wrapHere]);

  function reset() {
    setStatus(null);
    setOutcome(null);
    setComment('');
  }
  useEffect(reset, [user?.id]);

  const answered = !!status?.startsWith('Answered');
  const canSave = !!user && !!status && !callLive;

  function save() {
    if (!canSave || !user || !status) return;
    const telephony = wrapHere ? toCallTelephony(wrapHere.result) : undefined;
    const finalOutcome = answered ? (outcome ?? undefined) : undefined;
    dispatch({
      type: 'LOG_CALL',
      userId: user.id,
      status,
      outcome: finalOutcome,
      comment: comment.trim() || (telephony && telephony.durationSec > 0 ? `Talked ${formatDuration(telephony.durationSec)}` : STATUS_LABEL[status]),
      agentId: agent.id,
      telephony,
    });
    if (wrapHere) session.clearWrapUp();
    toast(`Saved — ${user.name}: ${finalOutcome ?? STATUS_LABEL[status]}`);
    reset();
    if (focusId) {
      params.delete('focus');
      setParams(params, { replace: true });
    }
  }

  function skip() {
    if (!user || callLive || wrapHere) return;
    setSkipped((s) => new Set(s).add(user.id));
    if (focusId) {
      params.delete('focus');
      setParams(params, { replace: true });
    }
  }

  const manualLogRef = useRef(FEATURES.manualLog || !tel);
  manualLogRef.current = FEATURES.manualLog || !tel;
  // A call completed in the call card: move on, and don't offer the same customer straight back.
  const wrapIdRef = useRef<string | null>(null);
  wrapIdRef.current = session.wrapUp?.customerId ?? null;
  useEffect(() => {
    const onDone = () => {
      const id = wrapIdRef.current;
      if (id) setSkipped((sk) => new Set(sk).add(id));
      setParams((p) => { p.delete('focus'); return p; }, { replace: true });
    };
    window.addEventListener('tcc:call-completed', onDone);
    return () => window.removeEventListener('tcc:call-completed', onDone);
  }, [setParams]);

  const keyState = useRef({ save, skip, user, status });
  keyState.current = { save, skip, user, status };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog || typeof e.key !== 'string') return; // browser autofill sends keydown events with no key
      const k = keyState.current;
      if (e.key === 'F1') {
        e.preventDefault();
        if (!k.user || !tel) return;
        if (tel.controller.getSnapshot().call) tel.controller.hangup();
        else session.dial(k.user);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          k.save();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!manualLogRef.current) {
        if (e.key.toLowerCase() === 's') k.skip();
        else if (e.key.toLowerCase() === 't' && k.user && can(agent, k.user.app, 'tickets')) setDialog('ticket');
        return;
      }
      const s = CALL_STATUS_LIST.find((x) => x.key === e.key);
      if (s) return setStatus(s.status);
      const o = OUTCOME_LIST.find((x) => x.key === e.key.toLowerCase());
      if (o && k.status?.startsWith('Answered')) return setOutcome(o.outcome);
      if (e.key === 'Enter') {
        e.preventDefault();
        k.save();
      } else if (e.key.toLowerCase() === 's') k.skip();
      else if (e.key.toLowerCase() === 't' && k.user && can(agent, k.user.app, 'tickets')) setDialog('ticket');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, tel, session, agent]);

  if (!app || !appId) return <div className="page"><Empty title="Unknown app" /></div>;
  if (!can(agent, appId, 'call')) {
    return (
      <div className="page">
        <Empty icon={<Inbox size={22} />} title={`You don’t have calling access to ${app.name}`} action={myApps[0] && <Link className="btn btn--primary" to={`/work/${myApps[0].id}`}>Open {myApps[0].name}</Link>}>
          Ask your supervisor if you should.
        </Empty>
      </div>
    );
  }

  const otherWrap = session.wrapUp && (!user || session.wrapUp.customerId !== user.id) ? state.users.find((u) => u.id === session.wrapUp!.customerId) : null;
  const manualLog = FEATURES.manualLog || !tel;
  const recent = user ? user.callHistory.slice(0, 3) : [];
  const nextFollowUp = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const callNext = () => {
    const first = list[0];
    if (first && !callLive && !session.wrapUp) {
      const r = session.dial(first);
      if (r.ok) setParams({ focus: first.id }, { replace: true });
      else toast(r.message);
    }
  };

  return (
    <div className="ws">
      <div className="ws-head">
        <div style={{ minWidth: 0 }}>
          <h1>Call queue</h1>
          <p className="muted">{app.name} · {queueTasks.length} waiting{selectedQueue ? ` in ${QUEUES.find((q) => q.key === selectedQueue)?.label.toLowerCase()}` : ''}{waiting > 0 ? ` · ${waiting} more will arrive as you finish` : ''}</p>
        </div>
        <div className="ws-head__actions">
          {myApps.length > 1 && (
            <select className="ws-select" aria-label="Product" value={appId} disabled={callLive} onChange={(e) => navigate(`/work/${e.target.value}`)}>
              {myApps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {!FEATURES.queueCards && (
            <select
              className="ws-select"
              aria-label="Queue"
              value={selectedQueue ?? ''}
              disabled={callLive}
              onChange={(e) => {
                setParams({ queue: e.target.value }, { replace: true });
                setSkipped(new Set());
              }}
            >
              {queues.map((q) => <option key={q.key} value={q.key}>{q.label} ({counts[q.key] ?? 0})</option>)}
            </select>
          )}
          {addFirst ? (
            <UiButton variant="outline" size="lg" disabled={callLive || !!session.wrapUp} onClick={() => setAdding(true)}><UserPlus /> Add customer</UiButton>
          ) : (
            <DialNumber appId={appId} disabled={callLive || !!session.wrapUp} />
          )}
          {tel && <UiButton size="lg" disabled={callLive || !!session.wrapUp || list.length === 0} onClick={callNext}><PhoneIcon /> Call next customer</UiButton>}
        </div>
      </div>

      {FEATURES.queueCards && (
        <div className="ws-queues" role="tablist" aria-label="Queues">
          {queues.map((q) => {
            const tasks = tasksForQueue(agent, state.users, appId, q.key);
            return (
              <button key={q.key} type="button" role="tab" aria-selected={q.key === selectedQueue} disabled={callLive} className={`queue-card${q.key === selectedQueue ? ' is-active' : ''}${tasks.length === 0 ? ' queue-card--empty' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => { setParams({ queue: q.key }, { replace: true }); setSkipped(new Set()); }}>
                <span className="queue-card__count mono">{tasks.length}</span>
                <span className="queue-card__label">{q.label}</span>
                <span className="queue-card__note">{queueNote(q.key, tasks)}</span>
              </button>
            );
          })}
        </div>
      )}

      {types.length > 0 && (
        <Tabs value={typeFilter} onValueChange={setTypeFilter}>
          <TabsList aria-label="Customer type">
            {['All', ...types].map((t) => (
              <TabsTrigger key={t} value={t} disabled={callLive}>
                {t}
                <span className="muted mono" style={{ fontSize: 12 }}>{t === 'All' ? queueTasks.length : queueTasks.filter((u) => u.customerType === t).length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {otherWrap && (
        <Callout tone="warn">
          Your call with <b>{otherWrap.name}</b> isn’t completed yet. <Link to={`/work/${otherWrap.app}?focus=${otherWrap.id}`}>Complete it now</Link>
        </Callout>
      )}

      <FilterBar active={wfActive} onReset={resetWf} shown={list.length} total={queueTasks.length} noun="customers">
        <SearchFilter value={wf.wq} onChange={(v) => setWf('wq', v)} placeholder="Name, business or mobile" label="Find in this list" />
        <SelectFilter label="Priority" value={wf.wprio} onChange={(v) => setWf('wprio', v)} options={[...PRIORITIES.map((p) => ({ value: p, label: p })), { value: 'none', label: 'No priority' }]} />
        <SelectFilter label="Language" value={wf.wlang} onChange={(v) => setWf('wlang', v)} options={CUSTOMER_LANGUAGES.map((l) => ({ value: l, label: l }))} />
        <SelectFilter label="City" value={wf.wcity} onChange={(v) => setWf('wcity', v)} options={cities.map((c) => ({ value: c, label: c }))} />
        <SelectFilter label="Called" value={wf.wcalled} onChange={(v) => setWf('wcalled', v)} all="Called: any" options={[{ value: 'never', label: 'Never called' }, { value: 'yes', label: 'Called before' }]} />
      </FilterBar>

      {!user ? (
        <UiCard>
          <Empty icon={<Inbox size={24} />} title={byType.length > 0 && wfActive > 0 ? 'No one matches your filters' : unreachable && unreachable.total > 0 ? 'Nothing for you to call here' : 'All caught up'}>
            {byType.length > 0 && wfActive > 0 && <>{byType.length} {byType.length === 1 ? 'customer is' : 'customers are'} in this list, but none match. <button type="button" className="btn btn--link" onClick={resetWf}>Clear filters</button><br /></>}
            Nothing left in {QUEUES.find((q) => q.key === selectedQueue)?.label ?? 'this queue'} for {app.name}{typeFilter !== 'All' ? ` as ${typeFilter}` : ''} in your languages and states.
            {waiting > 0 && <> {waiting} more {waiting === 1 ? 'customer is' : 'customers are'} lined up for you and will show here within a minute.</>}
            {skipped.size > 0 && <> You skipped {skipped.size}. <button type="button" className="btn btn--link" onClick={() => setSkipped(new Set())}>Bring them back</button></>}
            {unreachable && unreachable.total > 0 && (
              <div className="mt-3" style={{ textAlign: 'left' }}>
                <Callout tone="accent">
                  {unreachable.total.toLocaleString('en-IN')} {app.name} customer{unreachable.total === 1 ? ' is' : 's are'} waiting where your account doesn’t reach:
                  <ul style={{ margin: '6px 0 0 18px', listStyle: 'disc' }}>
                    {QUEUES.filter((q) => unreachable.lists[q.key]).map((q) => <li key={q.key}>{unreachable.lists[q.key]!.toLocaleString('en-IN')} in {q.label}, a list you aren’t given</li>)}
                    {unreachable.states > 0 && <li>{unreachable.states.toLocaleString('en-IN')} in states you don’t cover</li>}
                    {unreachable.languages > 0 && <li>{unreachable.languages.toLocaleString('en-IN')} who speak a language you don’t</li>}
                  </ul>
                  <div style={{ marginTop: 6 }}>Ask your admin to add these to your account under People.</div>
                </Callout>
              </div>
            )}
            {addFirst && <div className="mt-3"><UiButton onClick={() => setAdding(true)}><UserPlus /> Add a customer to call</UiButton></div>}
          </Empty>
        </UiCard>
      ) : (
        <div className="ws-body">
          <UiCard className="ws-list">
            <Table>
              <TableHeader>
                <TableRow data-head>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Last call</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.slice(0, 60).map((u) => (
                  <TableRow key={u.id} data-state={u.id === user.id ? 'selected' : undefined} className="cursor-pointer" style={priorityRowStyle(u.priority)} onClick={() => !callLive && !session.wrapUp && setParams({ focus: u.id }, { replace: true })}>
                    <TableCell>
                      <CustomerName user={u} />
                      <div className="mono muted" style={{ fontSize: 12 }}>{u.phone}</div>
                      {u.priority && <div style={{ marginTop: 3 }}><PriorityBadge priority={u.priority} /></div>}
                    </TableCell>
                    <TableCell>{u.customerType ? <UiBadge variant="outline">{u.customerType}</UiBadge> : <span className="muted">—</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{u.city}</TableCell>
                    <TableCell className="text-muted-foreground">{u.callHistory[0]?.atLabel ?? 'Never called'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </UiCard>

          <div className="ws-side">
            <UiCard className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <h2 className="truncate">{nameUnknown(user) ? 'Name not given' : user.name}</h2>
                  <div className="muted">{placeLine(user)}</div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="mono muted" style={{ fontSize: 12 }}>{user.shopCode}</span>
                  <FillDetailsButton user={user} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <UiBadge variant="outline">{LANGUAGE_SCRIPT[user.language]}{user.language !== 'English' ? ` · ${user.language}` : ''}</UiBadge>
                <UiBadge variant="outline">{F ? (user.plan === 'Paid' ? F.paid : F.free) : `${user.plan} plan`}</UiBadge>
                <OriginBadge user={user} />
                {user.hasActiveEscalation && <UiBadge>Escalation pending</UiBadge>}
                <select
                  aria-label="Customer type"
                  className="h-6 rounded-md border border-input bg-card px-1.5 text-xs"
                  value={user.customerType ?? ''}
                  onChange={(e) => e.target.value && dispatch({ type: 'SET_CUSTOMER_TYPE', userId: user.id, customerType: e.target.value })}
                >
                  <option value="">Type…</option>
                  {customerTypesFor(user.app).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {FEATURES.customerFacts && whyInQueue(user) && <div className="mt-3"><Callout tone="warn">{whyInQueue(user)}</Callout></div>}
              {FEATURES.customerFacts && (
                <div className="ws-facts mt-3">
                  {F ? (
                    <>
                      <div className="ws-fact"><span>{F.listings}</span><b className="mono">{user.listings} / {user.buyers}</b></div>
                      <div className="ws-fact"><span>{F.appVersion}</span><b>{user.appVersion}</b></div>
                      <div className="ws-fact"><span>{F.lastOpen}</span><b>{user.lastOpenLabel}</b></div>
                    </>
                  ) : (
                    <>
                      <div className="ws-fact"><span>{user.app === 'realbroks' ? 'Listings' : 'Orders'}</span><b className="mono">{user.listings}</b></div>
                      <div className="ws-fact"><span>Last opened app</span><b>{user.lastOpenLabel}</b></div>
                    </>
                  )}
                  <div className="ws-fact"><span>Conversion score</span><b className="mono">{user.conversionScore} / 100</b></div>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <UiButton variant="outline" size="sm" onClick={skip} disabled={callLive || !!wrapHere}>Skip</UiButton>
                {can(agent, user.app, 'tickets') && <UiButton variant="outline" size="sm" onClick={() => setDialog('ticket')}><Ticket />Raise ticket</UiButton>}
                <UiButton variant="ghost" size="sm" onClick={() => setDialog('escalate')}><Flag />Escalate</UiButton>
                <Link to={`/customers/${user.id}`} className="btn btn--sm btn--ghost">History <ArrowRight size={14} /></Link>
              </div>
              {user.paymentDue && can(agent, user.app, 'payments') && (
                <UiButton className="mt-3" variant="outline" size="sm" onClick={() => { dispatch({ type: 'MARK_PAID', userId: user.id, actorId: agent.id }); toast(`Marked ₹${user.paymentDue!.amount.toLocaleString('en-IN')} as paid`); }}>
                  <CircleDollarSign />Mark ₹{user.paymentDue.amount.toLocaleString('en-IN')} as paid
                </UiButton>
              )}
            </UiCard>

            <Phone user={user} agent={agent} onEscalate={() => setDialog('escalate')} />

            {manualLog && (
              <Card title="Log this call" sub="Calling from your mobile? Log it here.">
                <div className="stack" style={{ gap: 14 }}>
                  <div className="opt-grid">
                    {CALL_STATUS_LIST.map((s) => (
                      <button key={s.status} type="button" className="opt" aria-pressed={status === s.status} onClick={() => setStatus(s.status)}>{STATUS_LABEL[s.status]}</button>
                    ))}
                  </div>
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!answered}>
                    <div className="opt-grid">
                      {OUTCOME_LIST.map((o) => (
                        <button key={o.outcome} type="button" className="opt" aria-pressed={outcome === o.outcome} disabled={!answered} onClick={() => setOutcome(o.outcome)}>{outcomeLabel(o.outcome)}</button>
                      ))}
                    </div>
                  </fieldset>
                  {outcome && POSITIVE_OUTCOMES.includes(outcome) && outcome !== 'Ready to subscribe' && <Callout tone="ok">Joins the weekly follow-up — next call on <b>{nextFollowUp}</b>.</Callout>}
                  {outcome && NEGATIVE_OUTCOMES.includes(outcome) && <Callout tone="danger">Takes {user.name.split(' ')[0]} out of the queues.</Callout>}
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Note" placeholder="Note for whoever calls next" />
                  <Button variant="primary" disabled={!canSave} onClick={save}>Save and next</Button>
                </div>
              </Card>
            )}

            {FEATURES.earlierCalls && (
              <Card title="Earlier calls" sub={`${user.callHistory.length} logged · attempt ${user.attempt}`} pad={false}>
                {recent.length === 0 ? (
                  <Empty title="First call">No one has called {user.name.split(' ')[0]} yet.</Empty>
                ) : (
                  <ul className="plain-list">
                    {recent.map((c) => (
                      <li key={c.id}>
                        <Link to={`/customers/${user.id}/calls/${c.id}`} className="list-link" style={{ alignItems: 'flex-start' }}>
                          <span style={{ minWidth: 0 }}>
                            <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{c.atLabel} · {c.agentName}{c.telephony?.durationSec ? ` · ${formatDuration(c.telephony.durationSec)}` : ''}</span>
                            <span style={{ display: 'block', fontSize: 13.5, marginTop: 2 }}>{c.analysis?.summary || c.comment}</span>
                          </span>
                          <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                            <OutcomeBadge call={c} />
                            <SentimentBadge score={c.analysis?.sentiment} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        </div>
      )}

      {adding && (
        <AddCustomerDialog
          appId={appId}
          callLabel={tel ? 'Add and call' : undefined}
          onClose={() => setAdding(false)}
          onAdded={(c, call) => {
            setAdding(false);
            if (c.app !== appId) return navigate(`/work/${c.app}?focus=${c.id}${call ? '&call=1' : ''}`);
            setParams({ focus: c.id }, { replace: true });
            if (call) {
              const r = session.dial(c);
              if (!r.ok) toast(r.message);
            } else toast(`${c.name} added`);
          }}
        />
      )}
      {dialog === 'escalate' && user && <EscalateDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'ticket' && user && <TicketDialog user={user} onClose={() => setDialog(null)} />}
    </div>
  );
}
