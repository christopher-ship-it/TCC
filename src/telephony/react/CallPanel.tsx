import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { Credentials, Disposition, Meta } from '../core/types.ts';
import { formatDuration, useElapsedSeconds, useTelephony } from './hooks.ts';

// Themeable with CSS custom properties so it fits any host app without importing its CSS:
//   --telephony-accent / -danger / -ok / -text / -muted / -border / -surface / -radius / -font
const v = (name: string, fallback: string) => `var(--telephony-${name}, ${fallback})`;

const btn = (kind: 'primary' | 'danger' | 'plain', active = false): CSSProperties => ({
  padding: '10px 12px',
  font: `600 13px ${v('font', 'system-ui, sans-serif')}`,
  cursor: 'pointer',
  border: `1px solid ${kind === 'danger' ? v('danger', '#b3261e') : v('border', '#c9c9c9')}`,
  borderRadius: v('radius', '6px'),
  background: kind === 'primary' || kind === 'danger' ? (kind === 'danger' ? v('danger', '#b3261e') : v('accent', '#1e8fc6')) : active ? v('text', '#222') : v('surface', '#f4f4f4'),
  color: kind === 'plain' && !active ? v('text', '#222') : '#fff',
});

const DISPOSITION_LABEL: Record<Disposition, string> = {
  connected: 'Call completed',
  'no-answer': 'No answer',
  busy: 'Line busy',
  unreachable: 'Not reachable',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  failed: 'Call failed',
};

const STATE_LABEL = { dialing: 'Calling…', ringing: 'Ringing…', incoming: 'Incoming call', connected: 'On call' } as const;
const DIAL_ERROR = { 'invalid-number': "That doesn't look like a valid phone number.", 'not-ready': 'Softphone is not connected yet.', 'call-in-progress': 'A call is already in progress.' } as const;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export interface CallPanelProps {
  /** Number to call, as the app stores it (any common format). */
  number: string;
  /** Who is being called — shown while the call is live. */
  label?: string;
  /** Tags attached to the call and echoed back in webhooks (customer id, agent id…). */
  meta?: Meta;
  /** Text after the dial button, e.g. "F1". */
  shortcutHint?: string;
  defaultUserId?: string;
  onCredentialsSubmit?: (c: Credentials) => void;
  className?: string;
  style?: CSSProperties;
}

function CredentialsForm({ defaultUserId, onSubmit }: { defaultUserId?: string; onSubmit: (c: Credentials) => void }) {
  const [userId, setUserId] = useState(defaultUserId ?? '');
  const [password, setPassword] = useState('');
  const field: CSSProperties = { padding: 8, border: `1px solid ${v('border', '#c9c9c9')}`, borderRadius: v('radius', '6px'), font: `13px ${v('font', 'system-ui, sans-serif')}` };
  function submit(e: FormEvent) {
    e.preventDefault();
    if (userId.trim() && password) onSubmit({ userId: userId.trim(), password });
  }
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 6 }}>
      <input style={field} placeholder="Softphone user ID (e.g. 101_33338836)" value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" aria-label="Softphone user ID" />
      <input style={field} type="password" placeholder="Softphone password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Softphone password" />
      <button type="submit" style={btn('primary')} disabled={!userId.trim() || !password}>Connect softphone</button>
    </form>
  );
}

export function CallPanel({ number, label, meta, shortcutHint, defaultUserId, onCredentialsSubmit, className, style }: CallPanelProps) {
  const { controller, snapshot, requiresCredentials } = useTelephony();
  const { call, connection, lastResult, error, connectionError } = snapshot;
  const [dialError, setDialError] = useState<string | null>(null);
  const [keypad, setKeypad] = useState(false);
  const elapsed = useElapsedSeconds(call ? (call.answeredAt ?? call.startedAt) : null);

  useEffect(() => {
    if (!call) setKeypad(false);
  }, [call]);

  function dial() {
    const r = controller.dial(number, meta);
    setDialError(r.ok ? null : DIAL_ERROR[r.reason]);
  }

  const dot = connection === 'ready' ? v('ok', '#22a544') : connection === 'connecting' ? '#d99a00' : v('muted', '#888');
  const statusText =
    connection === 'ready' ? 'Softphone ready' : connection === 'connecting' ? 'Connecting softphone…' : connection === 'failed' ? `Couldn't connect${connectionError ? ` — ${connectionError.reason}` : ''}` : 'Softphone offline';

  return (
    <div className={className} style={{ display: 'grid', gap: 8, font: `13px ${v('font', 'system-ui, sans-serif')}`, color: v('text', '#222'), ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: v('muted', '#666') }} aria-live="polite">
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
        {statusText}
        {connection === 'ready' && requiresCredentials && (
          <button type="button" onClick={() => controller.disconnect()} style={{ marginLeft: 'auto', background: 'none', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 11, textDecoration: 'underline' }}>sign out</button>
        )}
      </div>

      {connection !== 'ready' && requiresCredentials && connection !== 'connecting' && (
        <CredentialsForm
          defaultUserId={defaultUserId}
          onSubmit={(c) => {
            onCredentialsSubmit?.(c);
            controller.connect(c);
          }}
        />
      )}

      {connection === 'ready' && !call && (
        <button type="button" style={btn('primary')} onClick={dial}>
          Call {number}{shortcutHint ? ` · ${shortcutHint}` : ''}
        </button>
      )}

      {call && (
        <div style={{ display: 'grid', gap: 8, padding: 10, border: `1px solid ${v('border', '#c9c9c9')}`, borderRadius: v('radius', '6px'), background: v('surface', '#f4f4f4') }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <strong aria-live="polite">{call.held ? 'On hold' : STATE_LABEL[call.state]}</strong>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 15 }}>{call.state === 'incoming' ? '' : formatDuration(elapsed)}</span>
          </div>
          <div style={{ fontSize: 12, color: v('muted', '#666') }}>{label ? `${label} · ` : ''}{call.direction === 'outbound' ? `+${call.remote}` : call.remote}{call.remoteHeld ? ' · they put you on hold' : ''}</div>

          {call.state === 'incoming' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button type="button" style={btn('primary')} onClick={() => controller.answer()}>Answer</button>
              <button type="button" style={btn('danger')} onClick={() => controller.hangup()}>Decline</button>
            </div>
          )}

          {call.state !== 'incoming' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              <button type="button" style={btn('plain', call.muted)} disabled={call.state !== 'connected'} aria-pressed={call.muted} onClick={() => controller.toggleMute()}>{call.muted ? 'Unmute' : 'Mute'}</button>
              <button type="button" style={btn('plain', call.held)} disabled={call.state !== 'connected'} aria-pressed={call.held} onClick={() => controller.toggleHold()}>{call.held ? 'Resume' : 'Hold'}</button>
              <button type="button" style={btn('plain', keypad)} disabled={call.state !== 'connected'} aria-pressed={keypad} onClick={() => setKeypad((k) => !k)}>Keypad</button>
              <button type="button" style={btn('danger')} disabled={call.hangupRequested} onClick={() => controller.hangup()}>{call.state === 'connected' ? 'End' : 'Cancel'}</button>
            </div>
          )}

          {keypad && call.state === 'connected' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {KEYS.map((k) => (
                <button key={k} type="button" style={btn('plain')} onClick={() => controller.sendDtmf(k)} aria-label={`Send ${k}`}>{k}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {!call && lastResult && (
        <div style={{ fontSize: 12, color: v('muted', '#666') }}>
          Last call: <strong style={{ color: v('text', '#222') }}>{DISPOSITION_LABEL[lastResult.disposition]}</strong>
          {lastResult.talkSeconds > 0 ? ` · ${formatDuration(lastResult.talkSeconds)}` : ''}
        </div>
      )}

      {(dialError || (error && !call)) && (
        <div role="alert" style={{ fontSize: 12, color: v('danger', '#b3261e') }}>{dialError ?? error?.message}</div>
      )}
    </div>
  );
}
