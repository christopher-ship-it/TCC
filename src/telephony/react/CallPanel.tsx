import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { isVirtualInput } from '../core/microphone.ts';
import type { Credentials, Disposition, MediaStats, Meta } from '../core/types.ts';
import { formatDuration, useAudioDevices, useElapsedSeconds, useMicLevel, useSilentSamples, useTelephony } from './hooks.ts';

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

/** One-line live media readout; null while there is nothing worth showing. */
function qualityLine(q: MediaStats): string | null {
  const sent = q.packetsSent;
  const received = q.packetsReceived;
  if (sent === 0) return '⚠ No audio is being sent — check the microphone';
  if (received === 0) return '⚠ No audio is being received — you will not hear them';
  const ms = q.roundTripSec !== undefined ? ` · ${Math.round(q.roundTripSec * 1000)}ms` : '';
  if (q.remoteFractionLost !== undefined && q.remoteFractionLost >= 0.1) return `⚠ Poor uplink — ${Math.round(q.remoteFractionLost * 100)}% of your audio is arriving${ms}`;
  if (q.packetsLost !== undefined && q.packetsReceived !== undefined && q.packetsLost / (q.packetsLost + q.packetsReceived) >= 0.05) return `⚠ Lossy line${ms}`;
  if (sent !== undefined && received !== undefined) return `Media ok${ms}`;
  return null;
}

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
  const [showSettings, setShowSettings] = useState(false);
  const [micTesting, setMicTesting] = useState(false);

  const { devices, selectedDeviceId, selectDevice } = useAudioDevices();
  const { volume, isSilent } = useMicLevel(micTesting, selectedDeviceId);

  const elapsed = useElapsedSeconds(call ? (call.answeredAt ?? call.startedAt) : null);
  const quality = call?.stats ? qualityLine(call.stats) : lastResult?.stats ? qualityLine(lastResult.stats) : null;
  const silentSamples = useSilentSamples(call?.state === 'connected' && !call.muted ? call.stats : null);
  const micLabel = call?.stats?.micLabel;
  // "Bytes sent" grows even when the mic captures pure silence, so it proves nothing about audio — the mic name and its level do.
  const micProblem = call?.stats?.micMuted ? 'The browser reports your microphone as muted — check macOS microphone privacy or a hardware mute' : micLabel && isVirtualInput(micLabel) ? 'Virtual microphone — the other person will hear nothing. Pick your real mic under Mic / Audio.' : silentSamples >= 8 ? 'Mic level is flat — speak up, or pick another input under Mic / Audio' : null;

  useEffect(() => {
    if (!call) setKeypad(false);
    else setMicTesting(false); // Never run test meter during an active call to prevent mic contention
  }, [call]);

  function dial() {
    setMicTesting(false);
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
        <span>{statusText}</span>
        {connection === 'ready' && (
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            style={{ marginLeft: 'auto', background: 'none', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 11, textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 3 }}
            title="Configure microphone input"
          >
            🎙️ {showSettings ? 'Hide mic settings' : 'Mic / Audio'}
          </button>
        )}
        {connection === 'ready' && requiresCredentials && (
          <button type="button" onClick={() => controller.disconnect()} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 11, textDecoration: 'underline' }}>sign out</button>
        )}
      </div>

      {showSettings && (
        <div style={{ padding: 10, background: v('surface', '#f4f4f4'), borderRadius: v('radius', '6px'), border: `1px solid ${v('border', '#c9c9c9')}`, display: 'grid', gap: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong>Microphone Input Device</strong>
            <button
              type="button"
              onClick={() => setMicTesting((t) => !t)}
              style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #ccc', background: micTesting ? '#0369a1' : '#fff', color: micTesting ? '#fff' : '#333', cursor: 'pointer' }}
            >
              {micTesting ? 'Stop Test' : 'Test Mic Level'}
            </button>
          </div>

          <select
            value={selectedDeviceId}
            onChange={(e) => {
              selectDevice(e.target.value);
              if (call) void controller.setMicrophone(e.target.value || null); // takes effect on the live call immediately
            }}
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #ccc' }}
          >
            <option value="">Automatic — real microphone (Recommended)</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}{isVirtualInput(d.label) ? ' — virtual, no sound' : ''}
              </option>
            ))}
          </select>

          {/* Live Mic Meter in Settings */}
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#666' }}>
              <span>Live Mic Level:</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: isSilent && micTesting ? '#b3261e' : '#22a544' }}>
                {micTesting ? (isSilent ? 'Silent (0%)' : `${volume}%`) : 'Click "Test Mic Level" to check'}
              </span>
            </div>
            <div style={{ height: 8, background: '#e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: micTesting ? `${volume}%` : '0%',
                  background: isSilent ? '#b3261e' : '#22a544',
                  transition: 'width 0.08s ease',
                }}
              />
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#666', lineHeight: 1.3 }}>
            💡 <em>Tip:</em> Automatic picks your built-in microphone and skips virtual devices such as BlackHole. You can change it during a call — it switches instantly.
          </div>
        </div>
      )}

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

          {call.state === 'connected' && quality && (
            <div role="status" style={{ fontSize: 11, color: quality.startsWith('⚠') ? v('danger', '#b3261e') : v('muted', '#666') }}>
              {quality}
            </div>
          )}

          {call.state === 'connected' && (
            <div style={{ display: 'grid', gap: 4, background: '#fff', padding: '6px 8px', borderRadius: 4, border: `1px solid ${v('border', '#e0e0e0')}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🎙️</span>
                  <span><strong>Microphone:</strong> {call.muted ? 'Muted' : micLabel ?? 'detecting…'}</span>
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: call.muted ? v('muted', '#888') : micProblem ? v('danger', '#b3261e') : v('ok', '#22a544') }}>
                  {call.muted ? 'Muted' : micProblem ? 'No audio' : call.stats?.audioLevel ? 'Transmitting audio' : 'Connected'}
                </span>
              </div>
              {call.stats?.packetsSent !== undefined && (
                <div style={{ fontSize: 10.5, color: v('muted', '#666'), display: 'flex', justifyContent: 'space-between' }}>
                  <span>Packets sent: {call.stats.packetsSent}</span>
                  {call.stats.audioLevel !== undefined && (
                    <span>Level: {Math.round(call.stats.audioLevel * 100)}%</span>
                  )}
                </div>
              )}
              {micProblem && !call.muted && <div role="alert" style={{ fontSize: 11, fontWeight: 600, color: v('danger', '#b3261e') }}>⚠ {micProblem}</div>}
            </div>
          )}

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
          {!call && quality ? ` · ${quality}` : ''}
        </div>
      )}

      {(dialError || (error && !call)) && (
        <div role="alert" style={{ fontSize: 12, color: v('danger', '#b3261e') }}>{dialError ?? error?.message}</div>
      )}
    </div>
  );
}
