import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, CircleDollarSign, Flag, Inbox, Phone as PhoneIcon, Ticket } from 'lucide-react';
import { useStore } from '../../store/StoreContext';
import { APPS } from '../../data/seed';
import { CALL_STATUS_LIST, NEGATIVE_OUTCOMES, OUTCOME_LIST, POSITIVE_OUTCOMES, QUEUES, type AppId, type CallStatus, type Outcome, type QueueKey } from '../../data/types';
import { queueCounts, tasksForQueue } from '../../lib/queue';
import { queueNote } from '../../lib/queueNotes';
import { whyInQueue } from '../../lib/whyInQueue';
import { can, LANGUAGE_SCRIPT } from '../../lib/access';
import { DEFAULT_COUNTRY_CODE, suggestStatus, toCallTelephony } from '../../lib/telephony';
import { adHocCustomer, adHocId, directDialDigits } from '../../lib/directDial';
import { formatDuration, useElapsedSeconds, useTelephonyOptional } from '../../telephony';
import { Phone } from '../../components/telephony/Phone';
import { useCallSession } from '../../components/telephony/callSessionContext';
import { EscalateDialog } from '../../components/agent/EscalateDialog';
import { TicketDialog } from '../../components/agent/TicketDialog';
import { OutcomeBadge, SentimentBadge } from '../../components/calls/badges';
import { Badge, Button, Callout, Card, Empty, Input, Kbd, Textarea } from '../../ui/primitives';
import { useToast } from '../../ui/toastContext';
import './agent.css';

const STATUS_LABEL: Record<CallStatus, string> = {
  'Answered — DG': 'Answered — DG',
  'Answered — DNG': 'Answered — DNG',
  'Answered — Followup': 'Answered — follow-up',
  'Not Reachable': 'Not reachable',
  'No Answer': 'No answer',
};

function CallStrip({ customerName }: { customerName?: string }) {
  const tel = useTelephonyOptional();
  const session = useCallSession();
  const { state } = useStore();
  const call = tel?.snapshot.call;
  const elapsed = useElapsedSeconds(call ? (call.answeredAt ?? call.startedAt) : null);
  const wrap = session.wrapUp;
  if (!call && !wrap) return null;
  const who = state.users.find((u) => u.id === (call?.meta.customerId ?? wrap?.customerId));
  const stage = call ? (call.state === 'connected' ? 2 : call.state === 'ringing' ? 1 : 0) : 3;
  const steps = ['Dialled', 'Ringing', 'Connected', 'Log the outcome'];
  return (
    <div className={`ws-strip ${call ? 'ws-strip--live' : 'ws-strip--wrap'}`} role="status">
      <div className="ws-steps">
        {steps.map((s, i) => (
          <span key={s} className={`ws-step${i < stage ? ' ws-step--done' : i === stage ? ' ws-step--now' : ''}`}>
            {i < stage ? <Check size={14} /> : <span className={`dot ${i === stage ? (call ? 'dot--live' : 'dot--warn') : 'dot--off'}`} />}
            {s}
          </span>
        ))}
      </div>
      <span style={{ width: 1, height: 28, background: 'var(--line)' }} />
      <span style={{ fontWeight: 600 }}>{who?.name ?? customerName}</span>
      {call ? (
        <span className="mono" style={{ fontSize: 20, color: call.state === 'connected' ? 'var(--ok)' : 'var(--ink-2)' }}>{formatDuration(elapsed)}</span>
      ) : (
        wrap && <span className="muted">{wrap.result.talkSeconds > 0 ? `Talked ${formatDuration(wrap.result.talkSeconds)}` : 'Did not connect'} · pick what happened and save</span>
      )}
    </div>
  );
}

/** Call a number that isn't in the customer list; the call is logged, recorded and analysed like any other. */
function DialNumber({ appId, disabled }: { appId: AppId; disabled: boolean }) {
  const { state, dispatch } = useStore();
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
    const user = state.users.find((u) => u.id === adHocId(digits)) ?? adHocCustomer(digits, appId);
    if (user.app !== appId) return setError(`That number was already dialled under ${user.app}.`);
    if (!state.users.some((u) => u.id === user.id)) dispatch({ type: 'ADD_CUSTOMER', customer: user });
    const r = session.dial(user);
    if (!r.ok) return setError(r.message);
    setError(null);
    setRaw('');
    setParams({ focus: user.id }, { replace: true });
  }

  return (
    <form className="row" style={{ gap: 8, padding: '10px 24px', alignItems: 'center', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }} onSubmit={submit}>
      <PhoneIcon size={15} aria-hidden />
      <label htmlFor="ws-dial" className="section-label" style={{ margin: 0 }}>Dial a number</label>
      <Input id="ws-dial" style={{ width: 220 }} inputMode="tel" placeholder="+91 98765 43210" value={raw} disabled={disabled} onChange={(e) => { setRaw(e.target.value); setError(null); }} />
      <Button type="submit" variant="primary" size="sm" disabled={disabled || !raw.trim()}>Call</Button>
      {error && <span role="alert" style={{ color: 'var(--danger, #b3261e)', fontSize: 13 }}>{error}</span>}
    </form>
  );
}

export default function Workspace() {
  const { appId } = useParams<{ appId: AppId }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, dispatch, currentAgent } = useStore();
  const toast = useToast();
  const session = useCallSession();
  const tel = useTelephonyOptional();
  const agent = currentAgent!;
  const app = APPS.find((a) => a.id === appId);
  const myApps = APPS.filter((a) => a.live && can(agent, a.id, 'call'));
  const queues = QUEUES.filter((q) => agent.queues.includes(q.key));
  const counts = appId ? queueCounts(agent, state.users, appId) : ({} as Record<QueueKey, number>);

  const queueParam = params.get('queue') as QueueKey | null;
  const selectedQueue: QueueKey | null = queueParam && agent.queues.includes(queueParam) ? queueParam : (queues.find((q) => counts[q.key] > 0)?.key ?? queues[0]?.key ?? null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const list = useMemo(() => (appId && selectedQueue ? tasksForQueue(agent, state.users, appId, selectedQueue).filter((u) => !skipped.has(u.id)) : []), [agent, state.users, appId, selectedQueue, skipped]);
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

  const keyState = useRef({ save, skip, user, status });
  keyState.current = { save, skip, user, status };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog) return;
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
  const recent = user ? user.callHistory.slice(0, 3) : [];
  const nextFollowUp = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div className="ws">
      <CallStrip customerName={user?.name} />
      <DialNumber appId={appId} disabled={callLive || !!session.wrapUp} />

      {myApps.length > 1 && (
        <div className="tabs" style={{ padding: '0 24px', background: 'var(--surface)' }} role="tablist" aria-label="App">
          {myApps.map((a) => (
            <button key={a.id} type="button" role="tab" className="tab" aria-selected={a.id === appId} disabled={callLive} onClick={() => navigate(`/work/${a.id}`)}>
              {a.name}
            </button>
          ))}
        </div>
      )}

      <div className="ws-queues" role="tablist" aria-label="Queues">
        {queues.map((q) => {
          const tasks = tasksForQueue(agent, state.users, appId, q.key);
          return (
            <button
              key={q.key}
              type="button"
              role="tab"
              aria-selected={q.key === selectedQueue}
              disabled={callLive}
              className={`queue-card${q.key === selectedQueue ? ' is-active' : ''}${tasks.length === 0 ? ' queue-card--empty' : ''}`}
              style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
              onClick={() => {
                setParams({ queue: q.key }, { replace: true });
                setSkipped(new Set());
              }}
            >
              <span className="queue-card__count mono">{tasks.length}</span>
              <span className="queue-card__label">{q.label}</span>
              <span className="queue-card__note">{queueNote(q.key, tasks)}</span>
            </button>
          );
        })}
      </div>

      {otherWrap && (
        <div style={{ padding: '12px 24px 0' }}>
          <Callout tone="warn">
            Your call with <b>{otherWrap.name}</b> isn’t logged yet.{' '}
            <Link to={`/work/${otherWrap.app}?focus=${otherWrap.id}`}>Log it now</Link>
          </Callout>
        </div>
      )}

      {!user ? (
        <div style={{ padding: 24 }}>
          <Card>
            <Empty icon={<Inbox size={24} />} title="All caught up">
              Nothing left in {QUEUES.find((q) => q.key === selectedQueue)?.label ?? 'this queue'} for {app.name} in your languages and states.
              {skipped.size > 0 && <> You skipped {skipped.size}. <button type="button" className="btn btn--link" onClick={() => setSkipped(new Set())}>Bring them back</button></>}
            </Empty>
          </Card>
        </div>
      ) : (
        <div className="ws-body">
          {/* Who */}
          <div className="ws-col">
            <Card>
              <div className="stack" style={{ gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted" style={{ fontSize: 13 }}>{list.length ? `${Math.max(1, list.findIndex((u) => u.id === user.id) + 1)} of ${list.length}` : 'Pinned'} · {QUEUES.find((q) => q.key === user.queue)?.short ?? 'No queue'}</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>{user.shopCode}</span>
                </div>
                <h1 className="ws-name">{user.name}</h1>
                <div style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>{user.business}<br />{user.city}, {user.effectiveState}{user.state ? '' : ' (state not on file)'}</div>
                <div className="row" style={{ gap: 6 }}>
                  <Badge tone="accent"><span className="chip__script">{LANGUAGE_SCRIPT[user.language]}</span>{user.language !== 'English' ? ` · ${user.language}` : ''}</Badge>
                  <Badge tone={user.plan === 'Paid' ? 'ok' : 'neutral'}>{user.plan} plan</Badge>
                  <Badge>{user.stageTag}</Badge>
                  {user.hasActiveEscalation && <Badge tone="warn">Escalation pending</Badge>}
                </div>
              </div>
            </Card>
            {whyInQueue(user) && <Callout tone="warn">{whyInQueue(user)}</Callout>}
            <div className="ws-facts">
              <div className="ws-fact"><span>{user.app === 'realbroks' ? 'Listings' : 'Orders'}</span><b className="mono">{user.listings}</b></div>
              <div className="ws-fact"><span>{user.app === 'realbroks' ? 'Buyers added' : 'Plan'}</span><b className="mono">{user.app === 'realbroks' ? user.buyers : user.planNote ?? user.plan}</b></div>
              <div className="ws-fact"><span>Last opened app</span><b>{user.lastOpenLabel}</b></div>
              <div className="ws-fact"><span>Conversion score</span><b className="mono" style={{ color: user.conversionScore >= 60 ? 'var(--ok)' : user.conversionScore < 35 ? 'var(--warn)' : undefined }}>{user.conversionScore}<span className="muted" style={{ fontSize: 12 }}> / 100</span></b></div>
            </div>
            {user.paymentDue && can(agent, user.app, 'payments') && (
              <Button
                icon={<CircleDollarSign size={16} />}
                onClick={() => {
                  dispatch({ type: 'MARK_PAID', userId: user.id, actorId: agent.id });
                  toast(`Marked ₹${user.paymentDue!.amount.toLocaleString('en-IN')} as paid`);
                }}
              >
                Mark ₹{user.paymentDue.amount.toLocaleString('en-IN')} as paid
              </Button>
            )}
            <Link to={`/customers/${user.id}`} className="btn">Full history and call analytics <ArrowRight size={15} /></Link>
          </div>

          {/* What happened */}
          <div className="ws-col">
            <Card title="Log this call" sub={callLive ? 'You can pick while you talk — saving opens after the call ends.' : wrapHere ? 'The line already filled in what it knows.' : 'Calling from your mobile? Log it here the same way.'}>
              <div className="stack" style={{ gap: 18 }}>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
                  <legend className="section-label" style={{ marginBottom: 8 }}>Did the call connect?</legend>
                  <div className="opt-grid">
                    {CALL_STATUS_LIST.map((s) => (
                      <button key={s.status} type="button" className="opt" aria-pressed={status === s.status} onClick={() => setStatus(s.status)}>
                        <Kbd>{s.key}</Kbd>
                        {STATUS_LABEL[s.status]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack" disabled={!answered}>
                  <legend className="section-label" style={{ marginBottom: 8 }}>What did they say? {!answered && <span className="muted" style={{ fontWeight: 400 }}>— only for answered calls</span>}</legend>
                  <div className="opt-grid">
                    {OUTCOME_LIST.map((o) => (
                      <button
                        key={o.outcome}
                        type="button"
                        className={`opt${POSITIVE_OUTCOMES.includes(o.outcome) ? ' opt--pos' : NEGATIVE_OUTCOMES.includes(o.outcome) ? ' opt--neg' : ''}`}
                        aria-pressed={outcome === o.outcome}
                        disabled={!answered}
                        onClick={() => setOutcome(o.outcome)}
                      >
                        <Kbd>{o.key.toUpperCase()}</Kbd>
                        {o.outcome}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {outcome && POSITIVE_OUTCOMES.includes(outcome) && outcome !== 'Ready to subscribe' && <Callout tone="ok">Joins the weekly follow-up chain — next call on <b>{nextFollowUp}</b>. Only a “no” ends the chain.</Callout>}
                {outcome === 'Ready to subscribe' && <Callout tone="ok">Marks {user.name.split(' ')[0]} as converted and takes them out of every queue.</Callout>}
                {outcome && NEGATIVE_OUTCOMES.includes(outcome) && <Callout tone="danger">Takes {user.name.split(' ')[0]} out of the queues and ends any follow-up chain.</Callout>}
                <div className="field">
                  <label className="field__label" htmlFor="ws-note">Note for whoever calls next</label>
                  <Textarea id="ws-note" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What they actually said, what they need, when to call back." />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <Button variant="primary" size="lg" kbd="⏎" disabled={!canSave} onClick={save}>Save and next</Button>
                  <Button kbd="S" onClick={skip} disabled={callLive || !!wrapHere}>Skip</Button>
                  {can(agent, user.app, 'tickets') && <Button icon={<Ticket size={15} />} kbd="T" onClick={() => setDialog('ticket')}>Raise ticket</Button>}
                  <Button variant="ghost" icon={<Flag size={15} />} onClick={() => setDialog('escalate')}>Escalate</Button>
                </div>
                {status && answered && !outcome && <span className="muted" style={{ fontSize: 13 }}>No outcome picked — the call is saved as answered and stays in the queue.</span>}
              </div>
            </Card>
            <div className="ws-hints" aria-label="Keyboard shortcuts">
              <span><Kbd>F1</Kbd> call / hang up</span>
              <span><Kbd>1</Kbd>–<Kbd>5</Kbd> connected?</span>
              <span><Kbd>Q</Kbd>–<Kbd>I</Kbd> what they said</span>
              <span><Kbd>⏎</Kbd> save</span>
              <span><Kbd>/</Kbd> search customers</span>
            </div>
          </div>

          {/* Call */}
          <div className="ws-col ws-col--phone">
            <Phone user={user} agent={agent} onEscalate={() => setDialog('escalate')} />
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
          </div>
        </div>
      )}

      {dialog === 'escalate' && user && <EscalateDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'ticket' && user && <TicketDialog user={user} onClose={() => setDialog(null)} />}
    </div>
  );
}
