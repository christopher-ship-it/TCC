import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../../store/StoreContext';
import { APP_LOGOS } from '../../assets';
import { TECSTELLAR_MARK } from '../../assets';
import { CALL_STATUS_LIST, OUTCOME_LIST, POSITIVE_OUTCOMES, QUEUES, type AppId, type CallStatus, type Outcome, type QueueKey } from '../../data/types';
import { tasksForQueue, queueCounts } from '../../lib/queue';
import { APPS } from '../../data/seed';
import MidCallModal from '../../components/agent/MidCallModal';
import { TccCallPanel } from '../../components/agent/AgentTelephony';
import { formatDuration, useTelephonyOptional, type CallResult } from '../../telephony';
import { callMeta, suggestStatus, toCallTelephony } from '../../lib/telephony';

export default function Workspace() {
  const { appId } = useParams<{ appId: AppId }>();
  const [searchParams] = useSearchParams();
  const { state, dispatch, currentAgent } = useStore();
  const navigate = useNavigate();

  const app = APPS.find((a) => a.id === appId);
  const assignedQueues = useMemo(() => (currentAgent ? QUEUES.filter((q) => currentAgent.queues.includes(q.key)) : []), [currentAgent]);

  const [selectedQueue, setSelectedQueue] = useState<QueueKey | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState(false);
  const [overrideDate, setOverrideDate] = useState(false);
  const [doneToday, setDoneToday] = useState(0);
  const [positiveToday, setPositiveToday] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [midCallOpen, setMidCallOpen] = useState(false);
  const [sessionStart] = useState(Date.now());
  const [, forceTick] = useState(0);
  const totalAtQueueStart = useRef<Record<string, number>>({});
  // Softphone (null when telephony isn't configured → plain tel: link below).
  const telephony = useTelephonyOptional();
  const controller = telephony?.controller;
  const callActive = !!telephony?.snapshot.call;
  const [lastCall, setLastCall] = useState<CallResult | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const toggleCallRef = useRef<() => void>(() => {});

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const counts = currentAgent ? queueCounts(currentAgent, state.users, (appId as AppId) ?? null) : ({} as Record<QueueKey, number>);

  useEffect(() => {
    if (!currentAgent || selectedQueue) return;
    const focusId = searchParams.get('focus');
    if (focusId) {
      const owner = state.users.find((u) => u.id === focusId);
      if (owner?.queue && assignedQueues.some((q) => q.key === owner.queue)) {
        setSelectedQueue(owner.queue);
        return;
      }
    }
    const firstWithWork = assignedQueues.find((q) => counts[q.key] > 0);
    setSelectedQueue(firstWithWork?.key ?? assignedQueues[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAgent, assignedQueues.length]);

  const list = useMemo(() => {
    if (!currentAgent || !appId || !selectedQueue) return [];
    return tasksForQueue(currentAgent, state.users, appId as AppId, selectedQueue).filter((u) => !skipped.has(u.id));
  }, [currentAgent, state.users, appId, selectedQueue, skipped]);

  useEffect(() => {
    if (selectedQueue && !(selectedQueue in totalAtQueueStart.current)) {
      totalAtQueueStart.current[selectedQueue] = list.length;
    }
  }, [selectedQueue, list.length]);

  const focusId = searchParams.get('focus');
  const currentUser = (focusId && list.find((u) => u.id === focusId)) || list[0];

  // When a softphone call ends, remember it (saved with the log entry) and pre-fill the cases the line already knows.
  useEffect(() => {
    if (!controller) return;
    return controller.onCallEnded((r) => {
      if (r.meta.customerId && r.meta.customerId !== currentUserIdRef.current) return;
      setLastCall(r);
      const suggested = suggestStatus(r);
      if (suggested) setStatus((s) => s ?? suggested);
    });
  }, [controller]);

  function resetForm() {
    setLastCall(null);
    controller?.clearResult();
    setStatus(null);
    setOutcome(null);
    setComment('');
    setCommentError(false);
    setOverrideDate(false);
  }

  function save() {
    if (!currentUser || !currentAgent || !status || callActive) return;
    if (!comment.trim()) {
      setCommentError(true);
      return;
    }
    const finalOutcome = status.startsWith('Answered') && outcome ? outcome : undefined;
    const telephonyInfo = lastCall && lastCall.meta.customerId === currentUser.id ? toCallTelephony(lastCall) : undefined;
    dispatch({ type: 'LOG_CALL', userId: currentUser.id, status, outcome: finalOutcome, comment, agentId: currentAgent.id, telephony: telephonyInfo });
    setDoneToday((d) => d + 1);
    if (finalOutcome && POSITIVE_OUTCOMES.includes(finalOutcome)) setPositiveToday((p) => p + 1);
    resetForm();
  }

  function skip() {
    if (!currentUser || callActive) return;
    setSkipped((s) => new Set(s).add(currentUser.id));
    resetForm();
  }

  function raiseTicket() {
    if (!currentUser) return;
    const subject = window.prompt('Ticket subject — what issue is the user reporting?', 'Needs help from support');
    if (subject) dispatch({ type: 'RAISE_TICKET', userId: currentUser.id, subject });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'F1' && controller) { e.preventDefault(); toggleCallRef.current(); return; }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        return;
      }
      const statusEntry = CALL_STATUS_LIST.find((s) => s.key === e.key);
      if (statusEntry) { setStatus(statusEntry.status); return; }
      const outcomeEntry = OUTCOME_LIST.find((o) => o.key === e.key.toLowerCase());
      if (outcomeEntry) { setOutcome(outcomeEntry.outcome); return; }
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key.toLowerCase() === 's') skip();
      if (e.key.toLowerCase() === 't') raiseTicket();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, status, outcome, comment, callActive]);

  currentUserIdRef.current = currentUser?.id ?? null;
  toggleCallRef.current = () => {
    if (!controller || !currentUser || !currentAgent) return;
    if (controller.getSnapshot().call) controller.hangup();
    else controller.dial(currentUser.phone, callMeta(currentUser, currentAgent));
  };

  if (!currentAgent || !app || !appId) return null;

  const totalStart = selectedQueue ? (totalAtQueueStart.current[selectedQueue] ?? list.length) : list.length;
  const donePosition = Math.max(1, totalStart - list.length + 1);
  const sessionMinutes = Math.round((Date.now() - sessionStart) / 60000);

  const nextFollowUpLabel = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  })();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', height: 52, padding: '0 var(--space-4)', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
        <button type="button" onClick={() => navigate('/launcher')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 0, cursor: 'pointer', color: 'inherit' }}>
          <img src={TECSTELLAR_MARK} alt="Tecstellar" style={{ width: 22, height: 22, objectFit: 'contain' }} />
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16, letterSpacing: '-.02em' }}>TCC</span>
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--color-divider)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <img src={APP_LOGOS[app.id]} alt={app.name} style={{ height: 20, width: 'auto', objectFit: 'contain' }} />
          {currentAgent.apps.filter((a) => APPS.find((x) => x.id === a)?.live).length > 1 && (
            <select className="input" style={{ minHeight: 26, fontSize: 11, padding: '2px 6px' }} value={appId} onChange={(e) => navigate(`/work/${e.target.value}`)}>
              {currentAgent.apps.filter((a) => APPS.find((x) => x.id === a)?.live).map((a) => <option key={a} value={a}>{APPS.find((x) => x.id === a)?.name}</option>)}
            </select>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontSize: 11, color: 'var(--color-neutral-700)' }}>
          <span>QUEUE {donePosition} / {totalStart}</span><span>·</span><span>SESSION {sessionMinutes}m</span><span>·</span>
          <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{currentAgent.name} · {currentAgent.role === 'agent' ? 'Agent' : currentAgent.role}</span>
          <button type="button" className="btn-ghost btn" style={{ padding: 0, fontSize: 12 }} onClick={() => { dispatch({ type: 'LOGOUT' }); navigate('/'); }}>sign out</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--color-divider)', overflowX: 'auto' }}>
        {assignedQueues.map((q) => (
          <button
            key={q.key}
            type="button"
            disabled={callActive}
            onClick={() => { setSelectedQueue(q.key); resetForm(); }}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600, border: '1px solid var(--color-divider)',
              background: selectedQueue === q.key ? 'var(--color-accent)' : 'var(--color-neutral-100)',
              color: selectedQueue === q.key ? 'var(--color-bg)' : 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {q.order} · {q.short} <strong style={{ marginLeft: 4 }}>{counts[q.key] ?? 0}</strong>
          </button>
        ))}
        {assignedQueues.length < QUEUES.length && (
          <span style={{ fontSize: 11, color: 'var(--color-neutral-700)', alignSelf: 'center', marginLeft: 'var(--space-2)' }}>
            {QUEUES.length - assignedQueues.length} queue{QUEUES.length - assignedQueues.length === 1 ? '' : 's'} not assigned to you — hidden.
          </span>
        )}
      </div>

      {!currentUser ? (
        <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
          <h3>All caught up</h3>
          <p className="text-muted">No open tasks in {QUEUES.find((q) => q.key === selectedQueue)?.label ?? 'this queue'} for {app.name} that you're allocated to reach.</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: '2px solid var(--color-divider)', background: 'var(--color-bg)' }}>
            <div style={{ flex: 1, padding: 'var(--space-3) var(--space-4)' }}>
              <div className="eyebrow">Serving now · Split {QUEUES.find((q) => q.key === selectedQueue)?.order} of 6</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 20, marginTop: 2 }}>{QUEUES.find((q) => q.key === selectedQueue)?.label}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 var(--space-4)' }}>
              {Array.from({ length: Math.min(18, Math.max(totalStart, 1)) }).map((_, i) => (
                <div key={i} style={{ width: 9, height: 26, background: i < donePosition - 1 ? 'var(--color-accent)' : i === donePosition - 1 ? 'var(--color-neutral-800)' : 'var(--color-neutral-300)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: '0 var(--space-4)', borderLeft: '1px solid var(--color-divider)' }}>
              <div style={{ textAlign: 'left' }}>
                <div className="eyebrow">Done today</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18 }}>{doneToday}</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div className="eyebrow">Positive</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 18, color: 'var(--color-accent-700)' }}>{positiveToday}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '372px 1fr 296px', alignItems: 'stretch' }}>
            <div style={{ borderRight: '2px solid var(--color-divider)', padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
              <div className="eyebrow" style={{ color: 'var(--color-accent-700)', fontWeight: 600 }}>Step 1 — reach the user</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, marginTop: 'var(--space-3)', letterSpacing: '-.01em' }}>{currentUser.name}</div>
              <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginBottom: 'var(--space-3)' }}>{currentUser.business} · {currentUser.city}, {currentUser.state ? currentUser.effectiveState.slice(0, 2).toUpperCase() : `${currentUser.effectiveState} (no state on file)`}</div>
              <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 26, letterSpacing: '-.01em', padding: 'var(--space-2) 0', borderTop: '2px solid var(--color-divider)', borderBottom: '1px solid var(--color-divider)' }}>{currentUser.phone}</div>
              {telephony ? (
                <div style={{ marginTop: 'var(--space-2)' }}><TccCallPanel user={currentUser} agent={currentAgent} /></div>
              ) : (
                <a className="btn btn-primary btn-block" href={`tel:${currentUser.phone.replace(/\s/g, '')}`} style={{ textDecoration: 'none' }}>Click to dial · F1</a>
              )}
              <button className="btn btn-secondary btn-block" type="button" style={{ justifyContent: 'flex-start' }} onClick={() => setMidCallOpen(true)}>I dialled from my mobile / reroute / escalate</button>
              <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-divider)' }}>
                <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Attempt {currentUser.attempt} · no cap</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 12 }}>
                  {currentUser.callHistory.slice(0, 3).map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--color-divider)' }}>
                      <span>{c.atLabel}</span><span style={{ color: 'var(--color-neutral-700)' }}>{c.status}{c.outcome ? ` · ${c.outcome}` : ''}{c.telephony?.durationSec ? ` · ${formatDuration(c.telephony.durationSec)}` : ''} · {c.agentName}</span>
                    </div>
                  ))}
                  {currentUser.callHistory.length === 0 && <div style={{ color: 'var(--color-neutral-700)' }}>No previous attempts.</div>}
                </div>
                <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2)', background: 'var(--color-accent-100)', borderLeft: '2px solid var(--color-accent)', fontSize: 12, lineHeight: 1.5 }}>
                  Keep calling — no-answers are never capped and the record stays in your queue. Mark <strong>Not Reachable</strong> only if the line is dead.
                </div>
              </div>
            </div>

            <div style={{ padding: 'var(--space-4)', borderRight: '2px solid var(--color-divider)' }}>
              <div className="eyebrow" style={{ color: 'var(--color-accent-700)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Step 2 — did the call connect?</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 0, border: '1px solid var(--color-divider)' }}>
                {CALL_STATUS_LIST.map((s, i) => (
                  <button key={s.status} type="button" onClick={() => setStatus(s.status)} style={{ padding: 10, font: '600 12px var(--font-body)', background: status === s.status ? 'var(--color-accent)' : 'var(--color-neutral-100)', color: status === s.status ? 'var(--color-bg)' : 'var(--color-text)', border: 0, borderRight: i < 4 ? '1px solid var(--color-divider)' : 0, cursor: 'pointer', textAlign: 'left' }}>
                    <span style={{ opacity: 0.7, fontSize: 10, display: 'block' }}>{s.key}</span>{s.status.replace('Answered — ', 'Answered\n')}
                  </button>
                ))}
              </div>

              <div className="eyebrow" style={{ color: 'var(--color-accent-700)', fontWeight: 600, margin: 'var(--space-4) 0 var(--space-2)' }}>Step 3 — outcome {status && !status.startsWith('Answered') && <span style={{ textTransform: 'none', color: 'var(--color-neutral-700)' }}>(not applicable — call didn't connect)</span>}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 'var(--space-2)', opacity: status && !status.startsWith('Answered') ? 0.4 : 1, pointerEvents: status && !status.startsWith('Answered') ? 'none' : 'auto' }}>
                {OUTCOME_LIST.map((o) => (
                  <button key={o.outcome} type="button" onClick={() => setOutcome(o.outcome)} style={{ padding: '10px 12px', font: '600 13px var(--font-body)', background: outcome === o.outcome ? 'var(--color-accent)' : 'var(--color-neutral-100)', color: outcome === o.outcome ? 'var(--color-bg)' : 'var(--color-text)', border: '1px solid var(--color-divider)', cursor: 'pointer', textAlign: 'left' }}>
                    {o.outcome} {o.note && <span style={{ opacity: 0.7, fontWeight: 400 }}>— {o.note}</span>}
                  </button>
                ))}
              </div>

              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label htmlFor="ws-note">Comments — what did they actually say?</label>
                <textarea className="input" id="ws-note" style={{ minHeight: 74, borderColor: commentError ? '#a3271b' : undefined }} value={comment} onChange={(e) => { setComment(e.target.value); setCommentError(false); }} />
              </div>

              {outcome && POSITIVE_OUTCOMES.includes(outcome) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-surface)', borderLeft: '2px solid var(--color-accent)' }}>
                  <div>
                    <div className="eyebrow">Next follow-up (auto)</div>
                    <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 16 }}>{nextFollowUpLabel} · +7 days</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', lineHeight: 1.45, borderLeft: '1px solid var(--color-divider)', paddingLeft: 'var(--space-4)' }}>
                    Enters the <strong style={{ color: 'var(--color-text)' }}>Positive follow-up</strong> loop weekly until they subscribe. Only a negative outcome ends the chain.
                  </div>
                  <label className="radio" style={{ marginLeft: 'auto', fontSize: 12 }}><input type="checkbox" checked={overrideDate} onChange={(e) => setOverrideDate(e.target.checked)} /><span className="dot" /> Override date</label>
                </div>
              )}
              {outcome === 'Ready to subscribe' && (
                <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-accent-2-100)', borderLeft: '2px solid var(--color-accent-2)', fontSize: 12 }}>
                  <strong>Ready to subscribe</strong> marks this user Converted and moves them out of every queue.
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '2px solid var(--color-divider)', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="button" disabled={!status || callActive} onClick={save}>Save &amp; serve next · ⏎</button>
                <button className="btn btn-secondary" type="button" disabled={callActive} onClick={skip}>Skip · S</button>
                <button className="btn btn-secondary" type="button" onClick={raiseTicket}>Raise ticket · T</button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-700)' }}>1–5 sets status · Q–I sets outcome · nothing saves without a comment</span>
              </div>
            </div>

            <div style={{ padding: 'var(--space-4)', background: 'var(--color-neutral-100)' }}>
              <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, color: 'var(--color-accent-700)' }}>{currentUser.shopCode}</div>
              <div style={{ height: 1, background: 'var(--color-divider)', margin: 'var(--space-2) 0 var(--space-3)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 12 }}>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>Registered</span><span style={{ fontWeight: 600 }}>{currentUser.registeredAtLabel} · {currentUser.registeredDaysAgo}d ago</span></div>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>Plan</span><span style={{ fontWeight: 600 }}>{currentUser.plan}{currentUser.planNote ? ` · ${currentUser.planNote}` : ''}</span></div>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>Listings/Orders</span><span style={{ fontWeight: 600 }}>{currentUser.listings}</span></div>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>Buyers added</span><span style={{ fontWeight: 600 }}>{currentUser.buyers}</span></div>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>Last app open</span><span style={{ fontWeight: 600 }}>{currentUser.lastOpenLabel}</span></div>
                <div className="kv"><span style={{ color: 'var(--color-neutral-700)' }}>App version</span><span style={{ fontWeight: 600 }}>{currentUser.appVersion}</span></div>
              </div>
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', background: 'var(--color-accent-100)' }}>
                <div className="eyebrow">Conversion score</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, color: 'var(--color-accent-700)' }}>{currentUser.conversionScore} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-neutral-700)' }}>/ 100</span></div>
              </div>
              <div className="eyebrow" style={{ margin: 'var(--space-4) 0 var(--space-2)' }}>Full call history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', fontSize: 12, borderLeft: '2px solid var(--color-divider)', paddingLeft: 'var(--space-3)', maxHeight: 260, overflow: 'auto' }}>
                {currentUser.callHistory.length === 0 && <div style={{ color: 'var(--color-neutral-700)' }}>No calls logged yet.</div>}
                {currentUser.callHistory.map((c) => (
                  <div key={c.id}>
                    <div style={{ fontWeight: 600 }}>{c.status}{c.outcome ? ` · ${c.outcome}` : ''}</div>
                    <div style={{ color: 'var(--color-neutral-700)' }}>{c.atLabel} · {c.agentName}{c.telephony ? ` · ${c.telephony.durationSec ? `${formatDuration(c.telephony.durationSec)} on call` : 'call did not connect'}` : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {midCallOpen && currentUser && <MidCallModal user={currentUser} onClose={() => setMidCallOpen(false)} />}
    </div>
  );
}
