// The softphone, drawn like a phone's call screen: who you are calling, the state of the call and a timer,
// and every in-call control on one surface — mute, keypad, hold, audio devices, transfer, escalate, end.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowRightLeft, ChevronLeft, Flag, Grid3x3, Headphones, Mic, MicOff, Pause, Phone as PhoneIcon, PhoneIncoming, PhoneOff, Play, Settings2 } from 'lucide-react';
import { formatDuration, useElapsedSeconds, useTelephonyOptional, type CallResult } from '../../telephony';
import { isVirtualInput } from '../../telephony/core/microphone';
import { useAudioDevices } from '../../telephony/react/hooks';
import type { AgentAccount, CustomerUser } from '../../data/types';
import { TEST_NUMBER, dialBlocked } from '../../lib/telephony';
import { Button, Field, Input, Select } from '../../ui/primitives';
import { useCallSession } from './callSessionContext';

const KEYS: [string, string][] = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];

const DISPOSITION: Record<CallResult['disposition'], string> = {
  connected: 'Call completed',
  'no-answer': 'No answer',
  busy: 'Line busy',
  unreachable: 'Not reachable',
  rejected: 'Declined',
  cancelled: 'Cancelled',
  failed: 'Call failed',
};

const savedUserKey = (agentId: string) => `tcc.softphone.user.${agentId}`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function Key({ label, icon, onClick, pressed, disabled }: { label: string; icon: ReactNode; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className="phone__key" onClick={onClick} aria-pressed={pressed} disabled={disabled}>
      <span className="phone__circle">{icon}</span>
      {label}
    </button>
  );
}

function SignIn({ agent, failed }: { agent: AgentAccount; failed?: string | null }) {
  const tel = useTelephonyOptional()!;
  const [userId, setUserId] = useState(() => {
    try {
      return localStorage.getItem(savedUserKey(agent.id)) ?? agent.telecmiUserId ?? '';
    } catch {
      return agent.telecmiUserId ?? '';
    }
  });
  const [password, setPassword] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !password) return;
    try {
      localStorage.setItem(savedUserKey(agent.id), userId.trim()); // the id only — never the password
    } catch {
      /* private mode */
    }
    tel.controller.connect({ userId: userId.trim(), password });
  }
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="phone__note">Sign in to your phone line once per session to call from the browser.</div>
      {failed && <div className="phone__warn"><AlertTriangle size={15} />Couldn’t connect — {failed}</div>}
      <Field label="Softphone user ID" htmlFor="sp-user">
        <Input id="sp-user" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="5002_33338836" autoComplete="username" />
      </Field>
      <Field label="Password" htmlFor="sp-pass">
        <Input id="sp-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      <Button type="submit" variant="success" size="lg" disabled={!userId.trim() || !password}>Connect line</Button>
    </form>
  );
}

function AudioSettings({ inCall, onBack }: { inCall: boolean; onBack: () => void }) {
  const tel = useTelephonyOptional()!;
  const { devices, selectedDeviceId, selectDevice } = useAudioDevices();
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [output, setOutput] = useState('');
  const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((all) => setOutputs(all.filter((d) => d.kind === 'audiooutput'))).catch(() => undefined);
  }, []);
  async function pickOutput(id: string) {
    setOutput(id);
    const el = document.getElementById('telecmi_audio_tag') as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    await el?.setSinkId?.(id).catch(() => undefined);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Button variant="ghost" size="sm" icon={<ChevronLeft size={15} />} onClick={onBack} style={{ alignSelf: 'flex-start' }}>Back</Button>
      <Field label="Microphone" htmlFor="sp-mic" hint={<span style={{ color: 'var(--navy-text)' }}>Automatic skips virtual devices that carry no sound.</span>}>
        <Select
          id="sp-mic"
          value={selectedDeviceId}
          onChange={(e) => {
            selectDevice(e.target.value);
            if (inCall) void tel.controller.setMicrophone(e.target.value || null);
          }}
        >
          <option value="">Automatic — real microphone</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}{isVirtualInput(d.label) ? ' — virtual, no sound' : ''}</option>
          ))}
        </Select>
      </Field>
      {canPickOutput && outputs.length > 0 && (
        <Field label="Speaker or headset" htmlFor="sp-out">
          <Select id="sp-out" value={output} onChange={(e) => void pickOutput(e.target.value)}>
            <option value="">System default</option>
            {outputs.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Output device'}</option>)}
          </Select>
        </Field>
      )}
    </div>
  );
}

function Transfer({ onBack }: { onBack: () => void }) {
  const tel = useTelephonyOptional()!;
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(tel.controller.transfer(to) ? `Transferring to ${to}…` : 'This line can’t transfer calls.');
      }}
    >
      <Button variant="ghost" size="sm" icon={<ChevronLeft size={15} />} onClick={onBack} style={{ alignSelf: 'flex-start' }}>Back</Button>
      <Field label="Transfer to (number or extension)" htmlFor="sp-tx">
        <Input id="sp-tx" value={to} onChange={(e) => setTo(e.target.value)} inputMode="tel" placeholder="5001" />
      </Field>
      <Button type="submit" variant="primary" disabled={!to.trim()}>Transfer call</Button>
      {msg && <div className="phone__note">{msg}</div>}
    </form>
  );
}

const pct = (v: number | undefined) => `${Math.min(100, Math.round((v ?? 0) * 260))}%`;

/** The phone for one customer. `onEscalate` opens the reroute / escalate dialog. */
export function Phone({ user, agent, onEscalate }: { user: CustomerUser; agent: AgentAccount; onEscalate: () => void }) {
  const tel = useTelephonyOptional();
  const session = useCallSession();
  const [view, setView] = useState<'controls' | 'keypad' | 'audio' | 'transfer'>('controls');
  const [error, setError] = useState<string | null>(null);
  const call = tel?.snapshot.call ?? null;
  const elapsed = useElapsedSeconds(call ? (call.answeredAt ?? call.startedAt) : null);
  const [silentMic, setSilentMic] = useState(0);
  const [silentLine, setSilentLine] = useState(0);

  const stats = call?.state === 'connected' ? call.stats : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- running counts over the stats stream
    setSilentMic((n) => (stats?.audioLevel === undefined || call?.muted ? 0 : stats.audioLevel === 0 ? n + 1 : 0));
    setSilentLine((n) => (stats?.remoteAudioLevel === undefined || call?.held ? 0 : stats.remoteAudioLevel < 0.001 ? n + 1 : 0));
  }, [stats, call?.muted, call?.held]);
  useEffect(() => {
    if (!call) setView('controls');
  }, [call]);

  // No telephony in this build: the agent dials from their own mobile and logs the call here.
  if (!tel) {
    return (
      <div className="phone">
        <div className="phone__id">
          <div className="phone__avatar">{initials(user.name)}</div>
          <div className="phone__name">{user.name}</div>
          <div className="phone__number">{user.phone}</div>
        </div>
        {agent.demo ? (
          <div className="phone__warn"><AlertTriangle size={15} />Demo agents can’t place real calls.</div>
        ) : (
          <>
            <div className="phone__note">Browser calling isn’t switched on in this build. Call from your mobile, then log the outcome here.</div>
            <a className="phone__big phone__big--call" href={`tel:${user.phone.replace(/\s/g, '')}`} aria-label={`Call ${user.name} from this device`}><PhoneIcon size={26} /></a>
          </>
        )}
        <Button variant="ghost" icon={<Flag size={15} />} onClick={onEscalate}>Reroute or escalate</Button>
      </div>
    );
  }

  const { snapshot, requiresCredentials, controller } = tel;
  const otherCall = call && call.meta.customerId !== user.id;
  const redirected = !!TEST_NUMBER && (agent.demo || !user.adHoc);
  const blocked = dialBlocked(user, agent);
  const ended = !call && session.wrapUp?.customerId === user.id ? session.wrapUp.result : null;
  const ringing = call && (call.state === 'dialing' || call.state === 'ringing');
  const micLabel = stats?.micLabel;
  const micProblem = stats?.micMuted
    ? 'Your browser reports the microphone as muted — check system microphone privacy or a hardware switch.'
    : micLabel && isVirtualInput(micLabel)
      ? 'A virtual microphone is selected — the customer hears nothing. Pick your real mic under Audio.'
      : silentMic >= 8
        ? 'Your mic level is flat — speak up, or pick another input under Audio.'
        : null;
  const lineProblem = stats?.speakerPlaying === false ? 'Their audio is arriving but not playing — click anywhere on this page.' : silentLine >= 10 ? 'No sound from their side for 10 seconds.' : null;

  function dial() {
    const r = session.dial(user);
    setError(r.ok ? null : r.message);
  }

  return (
    <div className="phone" aria-label="Phone">
      <div className="phone__top">
        <span className="row" style={{ gap: 6 }}>
          <span className={`dot ${snapshot.connection === 'ready' ? 'dot--ok' : snapshot.connection === 'connecting' ? 'dot--warn' : 'dot--off'}`} />
          {snapshot.connection === 'ready' ? (snapshot.provider === 'mock' ? 'Demo line' : 'Line connected') : snapshot.connection === 'connecting' ? 'Connecting…' : 'Line offline'}
        </span>
        {call?.state === 'connected' && <span className="phone__rec">Recording</span>}
        {snapshot.connection === 'ready' && !call && (
          <span className="row" style={{ gap: 2 }}>
            <Button variant="ghost" size="sm" iconOnly aria-label="Audio settings" icon={<Settings2 size={15} />} onClick={() => setView(view === 'audio' ? 'controls' : 'audio')} />
            {requiresCredentials && <Button variant="ghost" size="sm" onClick={() => controller.disconnect()}>Sign out</Button>}
          </span>
        )}
      </div>

      {snapshot.connection !== 'ready' && requiresCredentials && snapshot.connection !== 'connecting' ? (
        <SignIn agent={agent} failed={snapshot.connection === 'failed' ? (snapshot.connectionError?.reason ?? 'unknown error') : null} />
      ) : view === 'audio' ? (
        <AudioSettings inCall={!!call} onBack={() => setView('controls')} />
      ) : view === 'transfer' && call ? (
        <Transfer onBack={() => setView('controls')} />
      ) : (
        <>
          <div className="phone__id">
            <div className={`phone__avatar${ringing ? ' phone__avatar--ringing' : ''}`}>{initials(otherCall ? '?' : user.name)}</div>
            <div className="phone__name">{otherCall ? 'Another call is live' : user.name}</div>
            <div className="phone__number">{redirected ? `Test line · ${TEST_NUMBER}` : user.phone}</div>
            {call && !otherCall ? (
              call.state === 'connected' ? (
                <>
                  <div className="phone__timer" aria-live="off">{formatDuration(elapsed)}</div>
                  <div className="phone__state">{call.held ? 'On hold' : call.remoteHeld ? 'They put you on hold' : call.muted ? 'Muted — they can’t hear you' : 'Connected'}</div>
                </>
              ) : call.state === 'incoming' ? (
                <div className="phone__state"><PhoneIncoming size={15} />Incoming call</div>
              ) : (
                <div className="phone__state" aria-live="polite">{call.state === 'dialing' ? 'Calling…' : 'Ringing…'} <span className="mono">{formatDuration(elapsed)}</span></div>
              )
            ) : ended ? (
              <div className="phone__state">{DISPOSITION[ended.disposition]}{ended.talkSeconds > 0 ? ` · ${formatDuration(ended.talkSeconds)}` : ''}</div>
            ) : (
              <div className="phone__state">{user.business}</div>
            )}
          </div>

          {redirected && !call && <div className="phone__note">Test mode — this call rings {TEST_NUMBER}, not {user.name}.</div>}
          {blocked && <div className="phone__warn"><AlertTriangle size={15} />{agent.demo ? 'Demo agents can only ring the test number, and none is set (VITE_TELEPHONY_TEST_NUMBER).' : 'Live dialling is off: customer numbers are still sample data. Set VITE_TELEPHONY_TEST_NUMBER to ring your own phone.'}</div>}
          {call?.state === 'connected' && !otherCall && (
            <>
              <div className="phone__levels" aria-label="Audio levels">
                <Mic size={13} /><div className="phone__bar"><span style={{ width: call.muted ? '0%' : pct(stats?.audioLevel) }} /></div><span>You</span>
                <Headphones size={13} /><div className="phone__bar"><span style={{ width: pct(stats?.remoteAudioLevel) }} /></div><span>Them</span>
              </div>
              {(micProblem || lineProblem) && <div className="phone__warn" role="alert"><AlertTriangle size={15} style={{ flex: 'none' }} />{micProblem ?? lineProblem}</div>}
            </>
          )}

          {call && !otherCall && call.state === 'connected' && view === 'keypad' ? (
            <div className="phone__dial" role="group" aria-label="Keypad">
              {KEYS.map(([k, sub]) => (
                <button key={k} type="button" className="phone__digit" onClick={() => controller.sendDtmf(k)} aria-label={`Send ${k}`}>
                  {k}
                  {sub && <small>{sub}</small>}
                </button>
              ))}
              <span />
              <Button variant="ghost" size="sm" onClick={() => setView('controls')}>Hide keypad</Button>
            </div>
          ) : call && !otherCall && call.state === 'connected' ? (
            <div className="phone__grid">
              <Key label={call.muted ? 'Unmute' : 'Mute'} icon={call.muted ? <MicOff size={22} /> : <Mic size={22} />} pressed={call.muted} onClick={() => controller.toggleMute()} />
              <Key label="Keypad" icon={<Grid3x3 size={22} />} onClick={() => setView('keypad')} />
              <Key label={call.held ? 'Resume' : 'Hold'} icon={call.held ? <Play size={22} /> : <Pause size={22} />} pressed={call.held} onClick={() => controller.toggleHold()} />
              <Key label="Audio" icon={<Headphones size={22} />} onClick={() => setView('audio')} />
              <Key label="Transfer" icon={<ArrowRightLeft size={22} />} onClick={() => setView('transfer')} />
              <Key label="Escalate" icon={<Flag size={22} />} onClick={onEscalate} />
            </div>
          ) : null}

          <div className="phone__actions">
            {call && !otherCall ? (
              call.state === 'incoming' ? (
                <>
                  <button type="button" className="phone__big phone__big--end" aria-label="Decline" onClick={() => controller.hangup()}><PhoneOff size={26} /></button>
                  <button type="button" className="phone__big phone__big--call" aria-label="Answer" onClick={() => controller.answer()}><PhoneIcon size={26} /></button>
                </>
              ) : (
                <button type="button" className="phone__big phone__big--end" aria-label={call.state === 'connected' ? 'End call' : 'Cancel call'} disabled={call.hangupRequested} onClick={() => controller.hangup()}><PhoneOff size={26} /></button>
              )
            ) : (
              <button type="button" className="phone__big phone__big--call" aria-label={`Call ${user.name}`} title="Call · F1" disabled={!!call || blocked || snapshot.connection !== 'ready' || !!session.wrapUp} onClick={dial}>
                <PhoneIcon size={26} />
              </button>
            )}
          </div>
          {!call && !ended && !session.wrapUp && snapshot.connection === 'ready' && <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--navy-text)' }}>Press <kbd className="kbd" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.3)' }}>F1</kbd> to call</div>}
          {session.wrapUp && session.wrapUp.customerId !== user.id && !call && <div className="phone__note">Log your last call before starting another.</div>}
          {(error || (snapshot.error && !call)) && <div className="phone__warn" role="alert"><AlertTriangle size={15} />{error ?? snapshot.error?.message}</div>}
          {!call && !ended && <Button variant="ghost" size="sm" icon={<Flag size={14} />} onClick={onEscalate} style={{ alignSelf: 'center' }}>Reroute or escalate</Button>}
        </>
      )}
    </div>
  );
}
