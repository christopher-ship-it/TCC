import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CircleDollarSign, Headset, Lock, PhoneOff, ThumbsDown, ThumbsUp, Ticket, Trash2 } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { APPS } from '../data/seed';
import { QUEUES } from '../data/types';
import { APP_LOGOS } from '../assets';
import { BRAND, outcomeLabel } from '../brand';

const F = BRAND.fields;
import { can, LANGUAGE_SCRIPT } from '../lib/access';
import { customerJourney, durationLabel, isConnected, journeyVerdict } from '../lib/metrics';
import { talkShare } from '../lib/analysis/speakers';
import { whyInQueue } from '../lib/whyInQueue';
import { AUTO_FOLLOWUP_DAYS, chainDay } from '../lib/followUps';
import { daysAgoLabel, fmtDayTime } from '../lib/dates';
import { formatDuration } from '../telephony';
import { LeadBadge, OutcomeBadge, SentimentBadge } from '../components/calls/badges';
import { analysisState } from '../lib/callStatus';
import { TicketDialog } from '../components/agent/TicketDialog';
import { ColumnChart, Legend, LineChart } from '../ui/charts';
import { Badge, Button, Callout, Card, Empty, Field, PageHead, Select, Stat, Textarea } from '../ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '../ui/toastContext';
import './customer.css';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch, currentAgent } = useStore();
  const navigate = useNavigate();
  const toast = useToast();
  const agent = currentAgent!;
  const user = state.users.find((u) => u.id === id);
  const [ticket, setTicket] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const journey = useMemo(() => (user ? customerJourney(user) : []), [user]);

  if (!user) return <div className="page"><Empty title="Customer not found" action={<Link to="/" className="btn">Go home</Link>} /></div>;
  if (agent.role !== 'admin' && !agent.apps.includes(user.app)) {
    return <div className="page"><Empty icon={<Lock size={22} />} title="Not in your apps">This customer belongs to an app you don’t have access to.</Empty></div>;
  }

  const app = APPS.find((a) => a.id === user.app)!;
  const hear = can(agent, user.app, 'recordings');
  const verdict = journeyVerdict(user);
  const owner = state.agents.find((a) => a.id === user.ownerAgentId);
  const connectedCalls = user.callHistory.filter(isConnected);
  const talk = user.callHistory.reduce((n, c) => n + (c.telephony?.durationSec ?? 0), 0);
  const scored = journey.filter((p) => p.sentiment !== null);
  const avg = scored.length ? Math.round(scored.reduce((n, p) => n + (p.sentiment ?? 0), 0) / scored.length) : null;
  const trend = scored.length >= 2 ? (scored[scored.length - 1].sentiment ?? 0) - (scored[0].sentiment ?? 0) : null;
  const answered = journey.filter((p) => p.talkSec > 0);
  const canCall = agent.role === 'agent' && can(agent, user.app, 'call');
  const manage = agent.role !== 'agent';
  const gone = user.deleted;
  const reassignable = state.agents.filter((a) => a.role === 'agent' && a.apps.includes(user.app) && (a.status ?? 'active') === 'active');

  return (
    <div className="page">
      <PageHead
        eyebrow={<button type="button" className="btn btn--link" onClick={() => navigate(-1)}>← Back</button>}
        title={
          <span className="row" style={{ gap: 12 }}>
            {user.name}
            <Badge tone={verdict.tone}>{verdict.label}</Badge>
            <LeadBadge lead={user.lead} />
          </span>
        }
        desc={user.manual ? [user.phone, user.business, user.city].filter((x) => x && x !== '—').join(' · ') : `${user.business} · ${user.city}, ${user.effectiveState} · ${user.phone}`}
        actions={
          <>
            {canCall && !gone && <Button variant="primary" icon={<Headset size={16} />} onClick={() => navigate(`/work/${user.app}?${user.queue ? `queue=${user.queue}&` : ''}focus=${user.id}`)}>Call {user.name.split(' ')[0]}</Button>}
            {!gone && <Button icon={<Trash2 size={15} />} onClick={() => setRemoving(true)}>Delete</Button>}
            {can(agent, user.app, 'tickets') && !gone && <Button icon={<Ticket size={15} />} onClick={() => setTicket(true)}>Raise ticket</Button>}
            {user.paymentDue && !gone && can(agent, user.app, 'payments') && (
              <Button icon={<CircleDollarSign size={15} />} onClick={() => { dispatch({ type: 'MARK_PAID', userId: user.id, actorId: agent.id }); toast('Marked as paid'); }}>
                Mark ₹{user.paymentDue.amount.toLocaleString('en-IN')} paid
              </Button>
            )}
          </>
        }
      />

      {gone && (
        <Callout tone="danger">
          <b>Deleted by {gone.byName}</b> on {gone.atLabel}. Reason: {gone.reason}
          <br />They no longer appear in customers, search or queues. Their calls are kept. Adding this number again brings them back.
        </Callout>
      )}

      <div className="row" style={{ gap: 8 }}>
        <img src={APP_LOGOS[app.id]} alt={app.name} style={{ height: 18, width: 96, objectFit: 'contain', objectPosition: 'left center' }} />
        <Badge tone="accent"><span className="chip__script">{LANGUAGE_SCRIPT[user.language]}</span>{user.language !== 'English' ? ` · ${user.language}` : ''}</Badge>
        {!user.manual && <Badge tone={user.plan === 'Paid' ? 'ok' : 'neutral'}>{F ? (user.plan === 'Paid' ? F.paid : F.free) : `${user.plan} plan`}</Badge>}
        {user.queue && <Badge>In {QUEUES.find((q) => q.key === user.queue)?.label}</Badge>}
        <span className="mono muted" style={{ fontSize: 12.5 }}>{user.shopCode}</span>
      </div>

      {!user.manual && whyInQueue(user) && <Callout tone="warn">{whyInQueue(user)}</Callout>}
      {user.note && <Callout tone="accent">{user.note}</Callout>}

      <div className="stats">
        <Stat label="Calls" value={user.callHistory.length} note={`${connectedCalls.length} connected`} />
        <Stat label="Talk time" value={durationLabel(talk)} note={connectedCalls.length ? `${formatDuration(Math.round(talk / Math.max(1, connectedCalls.length)))} average` : 'Not reached yet'} />
        <Stat label="Average sentiment" value={avg ?? '—'} tone={avg === null ? undefined : avg >= 60 ? 'ok' : avg <= 40 ? 'danger' : undefined} note={trend === null ? `${scored.length} analysed call${scored.length === 1 ? '' : 's'}` : `${trend >= 0 ? '+' : ''}${trend} since first analysed call`} />
        {user.manual ? (
          <Stat label="Last call" value={user.callHistory[0]?.atLabel.split(' · ')[0] ?? '—'} note={user.callHistory[0] ? (user.callHistory[0].outcome ? outcomeLabel(user.callHistory[0].outcome) : user.callHistory[0].status) : `Added ${user.registeredAtLabel}`} />
        ) : (
          <Stat label="Conversion score" value={user.conversionScore} note="Out of 100, from app activity" />
        )}
      </div>

      <div className="grid-2">
        <Card title="Sentiment across calls" sub="How receptive the customer was on each analysed call (0–100)">
          {scored.length === 0 ? (
            <Empty title="No analysed calls yet">Each recorded call is analysed after it ends; the trend appears here.</Empty>
          ) : (
            <LineChart
              ariaLabel={`Sentiment across ${scored.length} calls`}
              bands={[{ from: 60, to: 100, label: 'Positive' }]}
              points={scored.map((p) => ({
                label: p.call.atLabel.split(' · ')[0],
                value: p.sentiment,
                tip: (
                  <>
                    <div style={{ fontWeight: 600 }}>{p.call.atLabel} · {p.sentiment}</div>
                    <div>{p.call.outcome ? outcomeLabel(p.call.outcome) : p.call.status} · {p.call.agentName}</div>
                  </>
                ),
              }))}
            />
          )}
        </Card>
        <Card title="Who talked, call by call" sub="Minutes on each answered call, split between agent and customer" actions={<Legend items={[{ label: 'Agent', color: 'var(--series-1)' }, { label: 'Customer', color: 'var(--series-2)' }]} />}>
          {answered.length === 0 ? (
            <Empty title="No answered calls yet" />
          ) : (
            <ColumnChart
              ariaLabel="Talk time per call"
              unit="m"
              series={[{ label: 'Agent', color: 'var(--series-1)' }, { label: 'Customer', color: 'var(--series-2)' }]}
              data={answered.map((p) => {
                const share = p.agentShare ?? 0.5;
                const mins = p.talkSec / 60;
                const a = Math.round(mins * share * 10) / 10;
                const c = Math.round((mins - a) * 10) / 10;
                return {
                  label: p.call.atLabel.split(' · ')[0],
                  values: [a, c],
                  tip: (
                    <>
                      <div style={{ fontWeight: 600 }}>{p.call.atLabel} · {formatDuration(p.talkSec)}</div>
                      {p.agentShare === null ? <div>Split unknown — not analysed</div> : <div>Agent {Math.round(share * 100)}% · Customer {100 - Math.round(share * 100)}%</div>}
                    </>
                  ),
                };
              })}
            />
          )}
        </Card>
      </div>

      <div className="cust-layout">
        <Card title="Call journey" sub="Newest first" pad={false}>
          {user.callHistory.length === 0 ? (
            <Empty icon={<PhoneOff size={22} />} title="No calls yet" />
          ) : (
            <ol className="journey">
              {user.callHistory.map((c) => {
                const st = analysisState(c);
                const share = c.analysis ? talkShare(c.telephony?.levels, c.analysis.transcript) : null;
                return (
                  <li key={c.id} className={`journey__item${isConnected(c) ? '' : ' journey__item--missed'}`}>
                    <span className="journey__dot" aria-hidden />
                    <div className="journey__body">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="muted" style={{ fontSize: 13 }}>{c.atLabel} · {c.agentName}{c.telephony?.durationSec ? ` · ${formatDuration(c.telephony.durationSec)}` : ''}</span>
                        <span className="row" style={{ gap: 6 }}>
                          <LeadBadge lead={c.lead} prefix="Marked" />
                          <SentimentBadge score={c.analysis?.sentiment} />
                          <OutcomeBadge call={c} />
                        </span>
                      </div>
                      {hear && c.analysis?.summary ? <p>{c.analysis.summary}</p> : c.comment ? <p className="journey__note">“{c.comment}”</p> : null}
                      {hear && c.analysis && (c.analysis.objections[0] || c.analysis.recommendation) && (
                        <div className="journey__meta">
                          {c.analysis.objections[0] && <span><b>Objection:</b> {c.analysis.objections[0]}</span>}
                          {c.analysis.recommendation && <span><b>Next step:</b> {c.analysis.recommendation}</span>}
                        </div>
                      )}
                      {share && share.agent + share.customer > 0 && hear && (
                        <span className="muted" style={{ fontSize: 12.5 }}>Customer spoke {Math.round((share.customer / (share.agent + share.customer)) * 100)}% of the time{share.measured ? '' : ' (estimated)'}</span>
                      )}
                      {(isConnected(c) || st) && (
                        <div className="row" style={{ gap: 8 }}>
                          {st && <Badge tone={st.tone}>{st.label}</Badge>}
                          <Link to={`/customers/${user.id}/calls/${c.id}`} className="btn btn--sm">{hear ? 'Recording, transcript & analysis' : 'Call details'} <ArrowRight size={14} /></Link>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="stack" style={{ gap: 16 }}>
          <Card title="Profile">
            {user.manual ? (
              <>
                <div className="kv"><span>Product</span><span>{app.name}</span></div>
                <div className="kv"><span>Mobile</span><span className="mono">{user.phone}</span></div>
                <div className="kv"><span>Type</span><span>{user.customerType ?? '—'}</span></div>
                <div className="kv"><span>Language</span><span>{user.language}</span></div>
                <div className="kv"><span>Heard about the app via</span><span>{user.source ?? '—'}</span></div>
                {user.city !== '—' && <div className="kv"><span>City</span><span>{user.city}</span></div>}
                <div className="kv"><span>Added</span><span>{user.registeredAtLabel}</span></div>
              </>
            ) : F ? (
              <>
                <div className="kv"><span>{F.app}</span><span>{app.name}</span></div>
                <div className="kv"><span>{F.registered}</span><span>{user.registeredAtLabel} · {user.registeredDaysAgo}d ago</span></div>
                <div className="kv"><span>{F.plan}</span><span>{user.business}{user.planNote ? ` · ${user.planNote}` : ''}</span></div>
                <div className="kv"><span>{F.listings}</span><span className="mono">{user.listings} of {user.buyers}</span></div>
                <div className="kv"><span>{F.lastOpen}</span><span>{user.lastOpenLabel}</span></div>
                <div className="kv"><span>{F.appVersion}</span><span>{user.appVersion}</span></div>
                {user.mrr ? <div className="kv"><span>{F.mrr}</span><span className="mono">₹{user.mrr.toLocaleString('en-IN')} / mo</span></div> : null}
              </>
            ) : (
              <>
                <div className="kv"><span>App</span><span>{app.name}</span></div>
                <div className="kv"><span>Registered</span><span>{user.registeredAtLabel} · {user.registeredDaysAgo}d ago</span></div>
                <div className="kv"><span>Plan</span><span>{user.plan}{user.planNote ? ` · ${user.planNote}` : ''}</span></div>
                <div className="kv"><span>{user.app === 'realbroks' ? 'Listings' : 'Orders'}</span><span className="mono">{user.listings}</span></div>
                {user.app === 'realbroks' && <div className="kv"><span>Buyers added</span><span className="mono">{user.buyers}</span></div>}
                {user.app === 'irondrobe' && user.sync && <div className="kv"><span>End customers</span><span className="mono">{user.buyers}</span></div>}
                <div className="kv"><span>Last opened app</span><span>{user.lastOpenLabel}</span></div>
                <div className="kv"><span>App version</span><span>{user.appVersion}</span></div>
                {user.mrr ? <div className="kv"><span>Pays</span><span className="mono">₹{user.mrr.toLocaleString('en-IN')} / mo</span></div> : null}
              </>
            )}
            {user.sync && (
              <>
                <div className="kv"><span>Setup reached</span><span>{user.sync.stageLabel ?? '—'}{user.sync.onboardingCompleted ? ' · done' : ''}</span></div>
                {user.sync.lastActiveTs ? <div className="kv"><span>Last active</span><span>{daysAgoLabel(user.sync.lastActiveTs, Date.now())}</span></div> : null}
                {user.sync.lastError ? <div className="kv"><span>Last error</span><span>{user.sync.lastError.message}</span></div> : null}
                {user.sync.platform ? <div className="kv"><span>Phone</span><span>{user.sync.platform === 'ios' ? 'iPhone' : user.sync.platform === 'android' ? 'Android' : user.sync.platform}</span></div> : null}
                {user.sync.email ? <div className="kv"><span>Email</span><span>{user.sync.email}</span></div> : null}
                {user.sync.accountStatus !== 'active' ? <div className="kv"><span>Account</span><span>{user.sync.accountStatus === 'deleted' ? 'Deleted in the app' : 'Blocked in the app'}</span></div> : null}
                <div className="kv"><span>From {app.name}</span><span className="muted">updated {fmtDayTime(user.sync.syncedAt)}</span></div>
              </>
            )}
          </Card>
          {!gone && (
            <Card title="Positive or negative" sub="Your own call on this customer, separate from what they said">
              <div className="row" style={{ gap: 8 }} role="group" aria-label="Positive or negative">
                {(['positive', 'negative'] as const).map((l) => (
                  <Button
                    key={l}
                    size="sm"
                    variant={user.lead === l ? 'primary' : 'secondary'}
                    aria-pressed={user.lead === l}
                    icon={l === 'positive' ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}
                    onClick={() => {
                      const next = user.lead === l ? null : l;
                      dispatch({ type: 'SET_LEAD', userId: user.id, lead: next });
                      toast(next ? `Marked ${next}` : 'Mark cleared');
                    }}
                  >
                    {l === 'positive' ? 'Positive' : 'Negative'}
                  </Button>
                ))}
              </div>
            </Card>
          )}
          <Card title="Owner">
            <div className="stack" style={{ gap: 10 }}>
              <span>{owner ? <><b>{owner.name}</b> <span className="muted">· {owner.languages.join(', ')}</span></> : <span className="muted">No owner — the queue decides who calls next.</span>}</span>
              {manage && (
                <Select
                  aria-label="Change owner"
                  value={user.ownerAgentId ?? ''}
                  onChange={(e) => {
                    dispatch({ type: 'REASSIGN_OWNER', userId: user.id, agentId: e.target.value, actorId: agent.id });
                    toast('Owner changed');
                  }}
                >
                  <option value="" disabled>Give to…</option>
                  {reassignable.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.languages.join(', ')}</option>)}
                </Select>
              )}
            </div>
          </Card>
          {user.paymentDue && (
            <Card title="Payment">
              <div className="kv"><span>Amount</span><span className="mono">₹{user.paymentDue.amount.toLocaleString('en-IN')}</span></div>
              <div className="kv"><span>Due</span><span>{user.paymentDue.dueLabel}</span></div>
              <div className="kv"><span>Status</span><Badge tone={user.paymentDue.status === 'upcoming' ? 'neutral' : 'warn'}>{user.paymentDue.status}</Badge></div>
            </Card>
          )}
          {user.callback && !gone && (
            <Card title="Next call">
              <div className="kv"><span>Call on</span><span>{new Date(user.callback.dueTs).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
              <div className="kv"><span>Set by</span><span>{user.callback.auto ? 'Automatic follow-up' : 'An agent'}</span></div>
              {user.autoFollowUp && <div className="kv"><span>Automatic calls</span><span>Day {chainDay(user.autoFollowUp)} of {AUTO_FOLLOWUP_DAYS}, until they answer</span></div>}
            </Card>
          )}
          {user.followUp && (
            <Card title="Follow-up chain">
              <div className="kv"><span>Week</span><span className="mono">{user.followUp.weekNumber}</span></div>
              <div className="kv"><span>Next call</span><span>{user.followUp.nextDueLabel}</span></div>
              <div className="kv"><span>Marked positive</span><span>{user.followUp.markedPositiveLabel}</span></div>
            </Card>
          )}
          <Card title="Tickets" sub={user.tickets.length ? undefined : 'None open'}>
            {user.tickets.length === 0 ? <span className="muted">No tickets.</span> : user.tickets.map((t) => (
              <div key={t.id} className="kv"><span style={{ color: 'var(--ink)' }}>{t.subject}</span><span>{t.slaBreached ? <Badge tone="danger">Past SLA</Badge> : t.raisedAtLabel}</span></div>
            ))}
          </Card>
        </div>
      </div>
      {ticket && <TicketDialog user={user} onClose={() => setTicket(false)} />}
      <Dialog open={removing} onOpenChange={(o) => { if (!o) { setRemoving(false); setReason(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {user.name}?</DialogTitle>
            <DialogDescription>They disappear from customers, search and queues. Say why — for example “test customer” or “duplicate”. The reason is shown on their page and kept in the super admin’s log.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="del-reason">
            <Textarea id="del-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Test customer" />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setRemoving(false); setReason(''); }}>Cancel</Button>
            <Button variant="primary" disabled={!reason.trim()} onClick={() => { dispatch({ type: 'DELETE_CUSTOMER', userId: user.id, actorId: agent.id, reason }); setRemoving(false); setReason(''); toast('Customer deleted'); }}>Delete customer</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
