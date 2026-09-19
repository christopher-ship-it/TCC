import { normalizePhone } from './phone-number.ts';
import { initialSnapshot, reduce, type Action } from './reducer.ts';
import type { CallResult, CallSnapshot, Credentials, Meta, ProviderEvent, TelephonyProvider } from './types.ts';

export interface ControllerOptions {
  provider: TelephonyProvider;
  /** Country code assumed for national numbers. Default '91'. */
  defaultCountryCode?: string;
  now?: () => number;
  newId?: () => string;
  /** If the provider hasn't confirmed a requested hangup within this time, end the call locally. */
  hangupGraceMs?: number;
}

export type DialResult = { ok: true; id: string } | { ok: false; reason: 'invalid-number' | 'not-ready' | 'call-in-progress' };

let idCounter = 0;
const defaultId = () => `call-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/**
 * Framework-free owner of a provider + call state. React (or anything else)
 * reads it through subscribe()/getSnapshot() — the pair is what
 * useSyncExternalStore expects, and the snapshot reference only changes when
 * the state does.
 */
export class PhoneController {
  private state: CallSnapshot;
  private readonly provider: TelephonyProvider;
  private readonly countryCode: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly hangupGraceMs: number;
  private readonly listeners = new Set<() => void>();
  private readonly endedListeners = new Set<(result: CallResult) => void>();
  private detach: (() => void) | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ControllerOptions) {
    this.provider = opts.provider;
    this.countryCode = opts.defaultCountryCode ?? '91';
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.hangupGraceMs = opts.hangupGraceMs ?? 3000;
    this.state = initialSnapshot(opts.provider.name);
  }

  get requiresCredentials(): boolean {
    return this.provider.requiresCredentials;
  }

  getSnapshot = (): CallSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Fires once per finished call, with the result (duration, disposition, tags). */
  onCallEnded = (listener: (result: CallResult) => void): (() => void) => {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  };

  /** Begin listening to the provider. Idempotent; pair with stop(). (Separate from the
   *  constructor so React StrictMode's throw-away instances never leak a subscription.) */
  start(): void {
    if (this.detach) return;
    this.detach = this.provider.subscribe((event) => this.onProviderEvent(event));
  }

  /** Hang up anything in progress, sign out, stop listening. */
  stop(): void {
    if (this.state.call) this.provider.hangup();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (this.state.connection !== 'disconnected') this.provider.disconnect();
    this.detach?.();
    this.detach = null;
  }

  connect(credentials: Credentials): void {
    this.dispatch({ type: 'connecting' });
    try {
      this.provider.connect(credentials);
    } catch (e) {
      this.dispatch({ type: 'event', now: this.now(), event: { type: 'connectFailed', code: 500, reason: e instanceof Error ? e.message : 'connect failed' } });
    }
  }

  disconnect(): void {
    this.provider.disconnect();
  }

  dial(to: string, meta: Meta = {}): DialResult {
    if (this.state.call) return { ok: false, reason: 'call-in-progress' };
    if (this.state.connection !== 'ready') return { ok: false, reason: 'not-ready' };
    const remote = normalizePhone(to, { defaultCountryCode: this.countryCode });
    if (!remote) return { ok: false, reason: 'invalid-number' };
    const id = this.newId();
    this.dispatch({ type: 'dial', id, remote, meta, now: this.now() });
    try {
      this.provider.dial(remote, meta);
    } catch (e) {
      this.emitError(e);
    }
    return { ok: true, id };
  }

  answer(): void {
    if (this.state.call?.state === 'incoming') this.provider.answer();
  }

  hangup(): void {
    const call = this.state.call;
    if (!call) return;
    this.dispatch({ type: 'hangupRequested' });
    try {
      if (call.state === 'incoming') this.provider.reject();
      else this.provider.hangup();
    } catch (e) {
      this.emitError(e);
    }
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.dispatch({ type: 'forceEnd', now: this.now() }), this.hangupGraceMs);
  }

  toggleMute(): void {
    const call = this.state.call;
    if (call?.state !== 'connected') return;
    const muted = !call.muted;
    this.provider.mute(muted);
    this.dispatch({ type: 'setMuted', muted });
  }

  toggleHold(): void {
    const call = this.state.call;
    if (call?.state !== 'connected') return;
    this.provider.hold(!call.held); // state flips when the provider confirms via a 'hold' event
  }

  sendDtmf(tone: string): void {
    if (this.state.call?.state !== 'connected' || !/^[0-9*#]$/.test(tone)) return;
    this.provider.sendDtmf(tone);
  }

  transfer(to: string): boolean {
    if (this.state.call?.state !== 'connected' || !this.provider.transfer) return false;
    const target = normalizePhone(to, { defaultCountryCode: this.countryCode }) ?? (/^\d{2,6}$/.test(to.trim()) ? to.trim() : null); // allow short extensions
    if (!target) return false;
    this.provider.transfer(target);
    return true;
  }

  clearError(): void {
    this.dispatch({ type: 'clearError' });
  }

  clearResult(): void {
    this.dispatch({ type: 'clearResult' });
  }

  private onProviderEvent(event: ProviderEvent): void {
    // Providers only sometimes know the call id at event time; ask for it while a call is live.
    if ((event.type === 'trying' || event.type === 'ringing' || event.type === 'answered') && !event.callId) {
      const callId = this.provider.getCallId();
      if (callId) event = { ...event, callId };
    }
    this.dispatch({ type: 'event', event, now: this.now() });
  }

  private emitError(e: unknown): void {
    this.dispatch({ type: 'event', now: this.now(), event: { type: 'error', code: 500, message: e instanceof Error ? e.message : 'provider error' } });
  }

  private dispatch(action: Action): void {
    const prev = this.state;
    const next = reduce(prev, action);
    if (next === prev) return;
    this.state = next;
    if (next.lastResult && next.lastResult !== prev.lastResult) {
      if (this.graceTimer) clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
    for (const l of [...this.listeners]) l();
    if (next.lastResult && next.lastResult !== prev.lastResult) {
      for (const l of [...this.endedListeners]) {
        try {
          l(next.lastResult);
        } catch (e) {
          console.error('[telephony] onCallEnded listener threw', e);
        }
      }
    }
  }
}
