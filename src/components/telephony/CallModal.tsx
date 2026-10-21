// The call, as a panel docked beside the page (the page stays usable and readable). Two stages: on the line (large
// controls, and the notes for this customer's product) → after the call: always a short form the agent completes
// (what the call told us, what it didn't, a date to call again, one click to raise a ticket). The recording is read in
// the background and fills the form in as it arrives; the agent never has to wait for it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Grid3x3, Loader2, Mic, MicOff, Pause, Phone as PhoneIcon, PhoneOff, Play, Sparkles, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration, useElapsedSeconds, useTelephony } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../ui/toastContext';
import { customerTypesFor } from '../../data/products';
import { CALL_STATUS_LIST, LEAD_SOURCES, NEGATIVE_OUTCOMES, OUTCOME_LIST, POSITIVE_OUTCOMES, type CallAnalysis, type CallStatus, type CustomerUser, type Outcome } from '../../data/types';
import { suggestStatus, toCallTelephony } from '../../lib/telephony';
import { hasRealRecording } from '../../lib/attachRecording';
import { analyzeCall, AnalysisUnavailable } from '../../lib/transcription';
import { outcomeLabel } from '../../brand';
import { AUTO_FOLLOWUP_DAYS, dayFromInput, inputFromDay, startOfDay } from '../../lib/followUps';
import { useCallSession } from './callSessionContext';
import { notesCall, notesForProduct, type Note } from '../../lib/notes';
import { APPS } from '../../data/seed';

const Title = ({ children }: { children: ReactNode }) => <h2 className="text-xl font-semibold leading-tight">{children}</h2>;
const Sub = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const STATUS_LABEL: Record<CallStatus, string> = {
  'Answered — DG': 'Answered — DG',
  'Answered — DNG': 'Answered — DNG',
  'Answered — Followup': 'Answered',
  'Not Reachable': 'Not reachable',
  'No Answer': 'No answer',
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function Round({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="flex cursor-pointer flex-col items-center gap-2 text-sm text-muted-foreground">
      <span className={cn('flex size-16 items-center justify-center rounded-full border border-border bg-secondary text-foreground transition-colors hover:bg-border', active && 'border-foreground bg-foreground text-background hover:bg-foreground')}>{children}</span>
      {label}
    </button>
  );
}

/** Live call: who, how long, and big controls. */
function LiveCall({ user }: { user: CustomerUser }) {
  const { controller, snapshot } = useTelephony();
  const call = snapshot.call!;
  const elapsed = useElapsedSeconds(call.answeredAt ?? call.startedAt);
  const [keypad, setKeypad] = useState(false);
  const connected = call.state === 'connected';
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-secondary text-xl font-semibold">{initials(user.name)}</div>
      <div>
        <Title>{user.name}</Title>
        <Sub className="mt-1">{user.phone}{user.customerType ? ` · ${user.customerType}` : ''}</Sub>
      </div>
      <div className="text-3xl font-medium tabular-nums" aria-live="off">{formatDuration(elapsed)}</div>
      <div className="text-sm text-muted-foreground" aria-live="polite">
        {!connected ? (call.state === 'dialing' ? 'Calling…' : 'Ringing…') : call.held ? 'On hold' : call.muted ? 'Muted — they can’t hear you' : 'Connected · recording'}
      </div>

      {connected && keypad ? (
        <div className="grid grid-cols-3 gap-3" role="group" aria-label="Keypad">
          {KEYS.map((k) => (
            <button key={k} type="button" aria-label={`Send ${k}`} onClick={() => controller.sendDtmf(k)} className="size-16 cursor-pointer rounded-full border border-border bg-secondary text-2xl tabular-nums hover:bg-border">{k}</button>
          ))}
        </div>
      ) : connected ? (
        <div className="flex gap-6">
          <Round label={call.muted ? 'Unmute' : 'Mute'} active={call.muted} onClick={() => controller.toggleMute()}>{call.muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}</Round>
          <Round label="Keypad" onClick={() => setKeypad(true)}><Grid3x3 className="size-6" /></Round>
          <Round label={call.held ? 'Resume' : 'Hold'} active={call.held} onClick={() => controller.toggleHold()}>{call.held ? <Play className="size-6" /> : <Pause className="size-6" />}</Round>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        {connected && keypad && <Button variant="outline" size="lg" onClick={() => setKeypad(false)}>Hide keypad</Button>}
        <button type="button" aria-label={connected ? 'End call' : 'Cancel call'} disabled={call.hangupRequested} onClick={() => controller.hangup()} className="flex size-16 cursor-pointer items-center justify-center rounded-full bg-destructive text-white hover:bg-destructive/90 disabled:opacity-50">
          <PhoneOff className="size-7" />
        </button>
      </div>
    </div>
  );
}

type Phase = 'review' | 'done';

/** The call is over: wait for the analysis, then let the agent confirm and complete. */
function WrapUp({ user }: { user: CustomerUser }) {
  const { controller, snapshot } = useTelephony();
  const session = useCallSession();
  const { dispatch, currentAgent } = useStore();
  const toast = useToast();
  const wrap = session.wrapUp!;
  const result = wrap.result;
  const connected = result.disposition === 'connected' && result.talkSeconds > 0;
  // The demo line records nothing, so there is nothing to wait for.
  const analyse = connected && snapshot.provider !== 'mock';

  const [phase, setPhase] = useState<Phase>('review');
  const [reading, setReading] = useState(analyse);
  const [analysis, setAnalysis] = useState<CallAnalysis | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<CallStatus>(suggestStatus(result));
  const [type, setType] = useState<string>(user.customerType ?? '');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [ticket, setTicket] = useState<boolean | null>(null);
  const [source, setSource] = useState<string>(user.source ?? '');
  const [followDate, setFollowDate] = useState('');
  const filled = useRef(false);

  // Find the recording (TeleCMI finalises it a little after hangup), then analyse it. Give up after ~2 minutes.
  const resultRef = useRef(result);
  resultRef.current = result;
  useEffect(() => {
    if (!analyse) return;
    let cancelled = false;
    const started = Date.now();
    (async () => {
      while (!cancelled && Date.now() - started < 120_000) {
        const r = resultRef.current;
        if (hasRealRecording(r.recordingFile)) {
          try {
            const a = await analyzeCall({ telephony: toCallTelephony(r) } as never, user);
            if (!cancelled) setAnalysis(a);
          } catch (e) {
            if (!cancelled && !(e instanceof AnalysisUnavailable)) setNote((n) => n);
          }
          break;
        }
        if (r.providerCallId || r.remote) {
          const file = await controller.findRecording({ remote: r.remote ?? '', startedAt: r.startedAt, talkSeconds: r.talkSeconds, direction: r.direction }).catch(() => undefined);
          if (file) {
            session.attachRecording(file);
            continue;
          }
        }
        await new Promise((res) => setTimeout(res, 6000));
      }
      if (!cancelled) setReading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per call
  }, [result.id]);

  // What the analysis found fills the form once; the agent can change any of it.
  useEffect(() => {
    if (!analysis || filled.current) return;
    filled.current = true;
    // Fills only what the agent has not already chosen.
    const o = OUTCOME_LIST.find((x) => x.outcome === analysis.outcome)?.outcome;
    if (o) setOutcome((cur) => cur || o);
    if (!user.customerType && analysis.customerType && customerTypesFor(user.app).includes(analysis.customerType)) setType((cur) => cur || analysis.customerType!);
  }, [analysis, user.customerType, user.app]);

  const answered = status.startsWith('Answered');
  const types = customerTypesFor(user.app);
  const suggestTicket = outcome === 'Technical issue' || outcome === 'Payment issue' || !!analysis?.actionItems.some((a) => /ticket|escalat|issue|problem|bug|refund/i.test(a));
  const ticketOn = ticket ?? suggestTicket;
  const team = outcome === 'Payment issue' ? 'Billing' : 'Product';
  // Who they are and how they found us matter on a call that connected; an unanswered call can be saved without them.
  const missing = answered ? [!type ? 'customer type' : null, !source ? 'how they heard about the app' : null].filter(Boolean) as string[] : [];
  const followTs = dayFromInput(followDate);
  const today = inputFromDay(Date.now());
  const inDays = (n: number) => inputFromDay(startOfDay(Date.now()) + n * 86_400_000 + 3_600_000);

  function complete() {
    const agent = currentAgent!;
    const telephony = toCallTelephony(resultRef.current);
    dispatch({
      type: 'LOG_CALL',
      userId: user.id,
      status,
      outcome: answered && outcome ? outcome : undefined,
      comment: note.trim() || analysis?.summary || (telephony.durationSec > 0 ? `Talked ${formatDuration(telephony.durationSec)}` : STATUS_LABEL[status]),
      agentId: agent.id,
      telephony,
      analysis: analysis ?? undefined,
      source: answered ? source || undefined : undefined,
      followUpTs: followTs,
    });
    if (type && type !== user.customerType) dispatch({ type: 'SET_CUSTOMER_TYPE', userId: user.id, customerType: type });
    if (ticketOn) dispatch({ type: 'RAISE_TICKET', userId: user.id, subject: `[${team}] ${analysis?.summary?.slice(0, 120) || note.trim() || 'Raised from a call'}` });
    toast(`Call completed — ${user.name}`);
    setPhase('done');
    setTimeout(() => session.completeWrapUp(), 1100);
  }

  if (phase === 'done') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-foreground text-background"><Check className="size-7" /></span>
        <Title>Call completed</Title>
        <Sub>Moving to the next customer…</Sub>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Title>{user.name}</Title>
        <Sub>{connected ? `Talked ${formatDuration(result.talkSeconds)}` : 'Did not connect'}{user.business ? ` · ${user.business}` : ''}</Sub>
      </div>

      {reading && !analysis && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>Reading the call in the background — the summary and answers below fill in by themselves. You can complete this now.</span>
        </div>
      )}
      {analysis && (
        <div className="rounded-lg border border-border bg-muted p-3.5 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="size-3.5" />Call summary</div>
          <p className="leading-relaxed">{analysis.summary}</p>
          {analysis.recommendation && <p className="mt-2 text-muted-foreground">Next step: {analysis.recommendation}</p>}
        </div>
      )}
      {connected && !analysis && !reading && <p className="text-sm text-muted-foreground">The analysis isn’t available for this call, so fill in what they said below.</p>}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Did the call connect?</div>
        <div className="flex flex-wrap gap-2">
          {CALL_STATUS_LIST.filter((s) => s.status === 'Answered — Followup' || s.status === 'Not Reachable' || s.status === 'No Answer').map((s) => (
            <Button key={s.status} size="sm" variant={status === s.status ? 'default' : 'outline'} onClick={() => setStatus(s.status)}>{STATUS_LABEL[s.status]}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">Who is this?{!user.customerType && !type && <Badge variant="outline">{answered ? 'Required' : 'Not needed for this call'}</Badge>}</div>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <Button key={t} size="sm" variant={type === t ? 'default' : 'outline'} onClick={() => setType(t)}>{t}</Button>
          ))}
        </div>
      </div>

      {answered && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">How did they hear about the app?{!source && <Badge variant="outline">Required</Badge>}</div>
          <div className="flex flex-wrap gap-2">
            {LEAD_SOURCES.map((s) => (
              <Button key={s} size="sm" variant={source === s ? 'default' : 'outline'} onClick={() => setSource(s)}>{s}</Button>
            ))}
          </div>
        </div>
      )}

      {answered && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">What did they say?{!outcome && <Badge variant="outline">Not captured</Badge>}</div>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_LIST.map((o) => (
              <Button key={o.outcome} size="sm" variant={outcome === o.outcome ? 'default' : 'outline'} onClick={() => setOutcome(o.outcome)}>{outcomeLabel(o.outcome)}</Button>
            ))}
          </div>
          {outcome && POSITIVE_OUTCOMES.includes(outcome) && outcome !== 'Ready to subscribe' && <p className="text-[13px] text-muted-foreground">Goes into the weekly follow-up list. Only a “no” ends it.</p>}
          {outcome === 'Ready to subscribe' && <p className="text-[13px] text-muted-foreground">Marked as converted and taken out of every queue.</p>}
          {outcome && NEGATIVE_OUTCOMES.includes(outcome) && <p className="text-[13px] text-muted-foreground">Taken out of the queues and the follow-up list.</p>}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Call them again on <span className="font-normal text-muted-foreground">(optional)</span></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={followDate === today ? 'default' : 'outline'} onClick={() => setFollowDate(today)}>Today</Button>
          <Button size="sm" variant={followDate === inDays(1) ? 'default' : 'outline'} onClick={() => setFollowDate(inDays(1))}>Tomorrow</Button>
          <Button size="sm" variant={followDate === inDays(7) ? 'default' : 'outline'} onClick={() => setFollowDate(inDays(7))}>In a week</Button>
          <input type="date" min={today} value={followDate} onChange={(e) => setFollowDate(e.target.value && e.target.value >= today ? e.target.value : '')} aria-label="Follow-up date" className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {followDate && <Button size="sm" variant="ghost" onClick={() => setFollowDate('')}>Clear</Button>}
        </div>
        {!answered && !followDate && !user.callHistory.some((c) => c.status.startsWith('Answered')) && (
          <p className="text-[13px] text-muted-foreground">No date chosen: they’ll be called again every day for {AUTO_FOLLOWUP_DAYS} days, until they answer.</p>
        )}
        {!answered && followDate && <p className="text-[13px] text-muted-foreground">They’ll wait out of the queue until then.</p>}
      </div>

      <button type="button" onClick={() => setTicket(!ticketOn)} aria-pressed={ticketOn} className={cn('flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left text-sm', ticketOn ? 'border-foreground bg-muted' : 'border-border')}>
        <Ticket className="size-4 shrink-0" />
        <span className="flex-1">
          <b className="font-medium">{ticketOn ? `Ticket goes to the ${team} team` : 'No ticket needed'}</b>
          <span className="block text-[13px] text-muted-foreground">{suggestTicket && ticket === null ? 'Suggested from the call. Click to change.' : 'Click to ' + (ticketOn ? 'remove it.' : 'raise one.')}</span>
        </span>
        <span className={cn('size-5 rounded border', ticketOn ? 'border-foreground bg-foreground text-background' : 'border-input')}>{ticketOn && <Check className="size-4" />}</span>
      </button>

      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for whoever calls next (optional)" rows={2} className="w-full resize-none rounded-md border border-input bg-card p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground">{missing.length ? `Still needed: ${missing.join(', ')}` : answered && !outcome ? 'What they said can be left blank — the call is read after you close this.' : ''}</span>
        <Button size="lg" disabled={missing.length > 0} onClick={complete}><PhoneIcon className="size-4" />Complete call</Button>
      </div>
    </div>
  );
}

/** The notes for the product of the customer on the line: what to ask and say. Own notes and the team's. */
function CallNotes({ app }: { app: CustomerUser['app'] }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    let off = false;
    notesCall<{ notes: Note[] }>('GET', '/api/notes').then((r) => !off && setNotes(r.notes)).catch(() => !off && setNotes([]));
    return () => {
      off = true;
    };
  }, []);
  const mine = useMemo(() => notesForProduct(notes ?? [], app), [notes, app]);
  const product = APPS.find((a) => a.id === app)?.name ?? 'this product';
  if (!mine.length) return null;
  return (
    <section className="mt-5 border-t border-border pt-4" aria-label={`Notes for ${product}`}>
      <div className="mb-2 text-sm font-medium">Notes for {product}</div>
      <div className="flex flex-col gap-2">
        {mine.map((n) => (
          <div key={n.id} className="rounded-lg border border-border bg-muted p-3 text-sm">
            {n.title && <b className="block font-medium">{n.title}</b>}
            <p className="whitespace-pre-wrap leading-relaxed">{n.body}</p>
            {n.audience === 'agents' && <span className="mt-1 block text-xs text-muted-foreground">From {n.ownerName}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Mounted once for the agent's whole session. Docks beside the page when a call is on the line or waiting to be completed. */
export function CallModal() {
  const { snapshot } = useTelephony();
  const session = useCallSession();
  const { state } = useStore();
  const call = snapshot.call;
  const live = call && call.state !== 'incoming';
  const customerId = call?.meta.customerId ?? session.wrapUp?.customerId;
  const user = useMemo(() => state.users.find((u) => u.id === customerId), [state.users, customerId]);
  const open = !!user && (!!live || (!call && !!session.wrapUp));
  // The page makes room for the dock (shell.css).
  useEffect(() => {
    document.body.classList.toggle('call-docked', open);
    return () => document.body.classList.remove('call-docked');
  }, [open]);
  if (!open || !user) return null;
  return (
    <aside className="call-dock" aria-label="Call">
      {live ? (
        <>
          <LiveCall user={user} />
          <CallNotes app={user.app} />
        </>
      ) : session.wrapUp ? (
        <WrapUp key={session.wrapUp.result.id} user={user} />
      ) : null}
    </aside>
  );
}
