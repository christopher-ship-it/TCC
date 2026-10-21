// The call, as one big card over a blurred page. Three stages, one after the other, so the agent never has to find
// anything: on the line (large controls) → processing (recording + analysis) → review (what the call told us, fill
// what it didn't, one click to raise a ticket) → complete, then the next customer.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Grid3x3, Loader2, Mic, MicOff, Pause, Phone as PhoneIcon, PhoneOff, Play, Sparkles, Ticket } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDuration, useElapsedSeconds, useTelephony } from '../../telephony';
import { useStore } from '../../store/StoreContext';
import { useToast } from '../../ui/toastContext';
import { customerTypesFor } from '../../data/products';
import { CALL_STATUS_LIST, NEGATIVE_OUTCOMES, OUTCOME_LIST, POSITIVE_OUTCOMES, type CallAnalysis, type CallStatus, type CustomerUser, type Outcome } from '../../data/types';
import { suggestStatus, toCallTelephony } from '../../lib/telephony';
import { hasRealRecording } from '../../lib/attachRecording';
import { analyzeCall, AnalysisUnavailable } from '../../lib/transcription';
import { outcomeLabel } from '../../brand';
import { useCallSession } from './callSessionContext';

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
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      <div className="flex size-20 items-center justify-center rounded-full bg-secondary text-2xl font-semibold">{initials(user.name)}</div>
      <div>
        <DialogTitle className="text-2xl">{user.name}</DialogTitle>
        <DialogDescription className="mt-1">{user.phone}{user.customerType ? ` · ${user.customerType}` : ''}</DialogDescription>
      </div>
      <div className="text-4xl font-medium tabular-nums" aria-live="off">{formatDuration(elapsed)}</div>
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

type Phase = 'processing' | 'review' | 'done';

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

  const [phase, setPhase] = useState<Phase>(analyse ? 'processing' : 'review');
  const [analysis, setAnalysis] = useState<CallAnalysis | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<CallStatus>(suggestStatus(result));
  const [type, setType] = useState<string>(user.customerType ?? '');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [ticket, setTicket] = useState<boolean | null>(null);
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
      if (!cancelled) setPhase('review');
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
    const o = OUTCOME_LIST.find((x) => x.outcome === analysis.outcome)?.outcome;
    if (o) setOutcome(o);
    if (!user.customerType && analysis.customerType && customerTypesFor(user.app).includes(analysis.customerType)) setType(analysis.customerType);
  }, [analysis, user.customerType, user.app]);

  const answered = status.startsWith('Answered');
  const types = customerTypesFor(user.app);
  const suggestTicket = outcome === 'Technical issue' || outcome === 'Payment issue' || !!analysis?.actionItems.some((a) => /ticket|escalat|issue|problem|bug|refund/i.test(a));
  const ticketOn = ticket ?? suggestTicket;
  const team = outcome === 'Payment issue' ? 'Billing' : 'Product';

  // Close the card now: the call is saved as it stands and the recording is found and read in the background. When the
  // reading finishes, the call is classified from what was said (answered, broker or not, what they want).
  function saveInBackground() {
    const agent = currentAgent!;
    const telephony = toCallTelephony(resultRef.current);
    dispatch({
      type: 'LOG_CALL',
      userId: user.id,
      status,
      comment: note.trim() || (telephony.durationSec > 0 ? `Talked ${formatDuration(telephony.durationSec)}` : STATUS_LABEL[status]),
      agentId: agent.id,
      telephony,
    });
    toast('Saved — the call is still being read in the background');
    session.completeWrapUp();
  }

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
        <DialogTitle>Call completed</DialogTitle>
        <DialogDescription>Moving to the next customer…</DialogDescription>
      </div>
    );
  }

  if (phase === 'processing') {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <DialogTitle>Reading the call</DialogTitle>
        <DialogDescription>{hasRealRecording(result.recordingFile) ? 'Analysing the conversation…' : 'Getting the recording…'} This takes under a minute. You can close this and carry on — it finishes by itself.</DialogDescription>
        <div className="flex flex-col items-center gap-1">
          <Button size="sm" onClick={saveInBackground}>Close — keep reading in the background</Button>
          <Button variant="ghost" size="sm" onClick={() => setPhase('review')}>Skip and fill in myself</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <DialogTitle>{user.name}</DialogTitle>
        <DialogDescription>{connected ? `Talked ${formatDuration(result.talkSeconds)}` : 'Did not connect'}{user.business ? ` · ${user.business}` : ''}</DialogDescription>
      </div>

      {analysis && (
        <div className="rounded-lg border border-border bg-muted p-3.5 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="size-3.5" />Call summary</div>
          <p className="leading-relaxed">{analysis.summary}</p>
          {analysis.recommendation && <p className="mt-2 text-muted-foreground">Next step: {analysis.recommendation}</p>}
        </div>
      )}
      {connected && !analysis && <p className="text-sm text-muted-foreground">The analysis isn’t available for this call, so fill in what they said below.</p>}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Did the call connect?</div>
        <div className="flex flex-wrap gap-2">
          {CALL_STATUS_LIST.filter((s) => s.status === 'Answered — Followup' || s.status === 'Not Reachable' || s.status === 'No Answer').map((s) => (
            <Button key={s.status} size="sm" variant={status === s.status ? 'default' : 'outline'} onClick={() => setStatus(s.status)}>{STATUS_LABEL[s.status]}</Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">Who is this?{!user.customerType && !type && <Badge variant="outline">Not clear from the call — optional</Badge>}</div>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <Button key={t} size="sm" variant={type === t ? 'default' : 'outline'} onClick={() => setType(t)}>{t}</Button>
          ))}
        </div>
      </div>

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
      {!answered && <p className="text-[13px] text-muted-foreground">They’ll stay in the queue for another try.</p>}

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
        <span className="text-[13px] text-muted-foreground">{answered && !outcome ? 'What they said can be left blank — the call is read after you close this.' : ''}</span>
        <Button size="lg" onClick={complete}><PhoneIcon className="size-4" />Complete call</Button>
      </div>
    </div>
  );
}

/** Mounted once for the agent's whole session. Opens by itself when a call is on the line or waiting to be completed. */
export function CallModal() {
  const { snapshot } = useTelephony();
  const session = useCallSession();
  const { state } = useStore();
  const call = snapshot.call;
  const live = call && call.state !== 'incoming';
  const customerId = call?.meta.customerId ?? session.wrapUp?.customerId;
  const user = useMemo(() => state.users.find((u) => u.id === customerId), [state.users, customerId]);
  const open = !!user && (!!live || (!call && !!session.wrapUp));
  return (
    <Dialog open={open}>
      <DialogContent
        overlayClassName="bg-black/30 backdrop-blur-sm"
        className="max-h-[92vh] max-w-xl overflow-y-auto p-8"
        showClose={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {user && (live ? <LiveCall user={user} /> : session.wrapUp ? <WrapUp key={session.wrapUp.result.id} user={user} /> : null)}
      </DialogContent>
    </Dialog>
  );
}
