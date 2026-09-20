import type { Credentials, MediaStats, Meta, ProviderEvent, TelephonyProvider } from '../core/types.ts';

export type MockScenario = 'answer' | 'no-answer' | 'busy' | 'unreachable' | 'invalid' | 'reject';

export interface MockOptions {
  /** Timer seam so tests can run deterministically. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** How long the mock line rings before it answers. Default 2500. */
  ringMs?: number;
  /** Delay before login "succeeds". Default 300. */
  connectMs?: number;
  /** Pick a scenario for a dialled number. Default: keyed on the last digit — see scenarioFromLastDigit. */
  scenarioFor?: (to: string) => MockScenario;
  /** Media stats emitted once per answered second (a fake healthy line). Default: none. */
  stats?: MediaStats;
}

/** Last digit → outcome, so a demo list of customers exercises every path:
 *  1 no answer · 2 busy · 3 switched off/unreachable · 4 invalid number · 5 declined · anything else answers. */
export function scenarioFromLastDigit(to: string): MockScenario {
  switch (to.replace(/\D/g, '').slice(-1)) {
    case '1': return 'no-answer';
    case '2': return 'busy';
    case '3': return 'unreachable';
    case '4': return 'invalid';
    case '5': return 'reject';
    default: return 'answer';
  }
}

/** A fake phone line implementing the same contract as a real provider. No network, no credentials. */
export class MockProvider implements TelephonyProvider {
  readonly name = 'mock';
  readonly requiresCredentials = false;
  /** Everything the app asked of the line — handy in tests. */
  readonly sentDtmf: string[] = [];
  readonly dialed: { to: string; meta: Meta }[] = [];

  private readonly handlers = new Set<(e: ProviderEvent) => void>();
  private readonly timers = new Set<() => void>();
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly ringMs: number;
  private readonly connectMs: number;
  private readonly scenarioFor: (to: string) => MockScenario;
  private readonly stats: MediaStats | undefined;
  private registered = false;
  private callId: string | null = null;
  private held = false;
  private seq = 0;
  private statsSeq = 0;
  /** Newest stats sample emitted for the current call (sent again with 'ended'). */
  private lastStats: MediaStats | null = null;

  constructor(opts: MockOptions = {}) {
    this.schedule = opts.schedule ?? ((fn, ms) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    });
    this.ringMs = opts.ringMs ?? 2500;
    this.connectMs = opts.connectMs ?? 300;
    this.scenarioFor = opts.scenarioFor ?? scenarioFromLastDigit;
    this.stats = opts.stats;
  }

  subscribe(handler: (e: ProviderEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  connect(credentials: Credentials): void {
    this.later(() => {
      if (credentials.password === 'bad') {
        this.emit({ type: 'connectFailed', code: 401, reason: 'invalid user' });
      } else {
        this.registered = true;
        this.emit({ type: 'ready' });
      }
    }, this.connectMs);
  }

  disconnect(): void {
    this.cancelTimers();
    this.registered = false;
    this.callId = null;
    this.emit({ type: 'disconnected', reason: 'logout' });
  }

  dial(to: string, meta: Meta): void {
    this.dialed.push({ to, meta });
    if (!this.registered) {
      this.emit({ type: 'error', code: 1002, message: 'Please login to call' });
      return;
    }
    this.callId = `mock-${++this.seq}`;
    this.held = false;
    this.emit({ type: 'trying' });
    const at = (ms: number, e: ProviderEvent) =>
      this.later(() => {
        this.emit(e);
        if (e.type === 'answered') this.startStats(); // media (and its stats) only exist from answer
      }, ms);
    switch (this.scenarioFor(to)) {
      case 'answer':
        at(300, { type: 'ringing' });
        at(this.ringMs, { type: 'answered' });
        break;
      case 'no-answer':
        at(300, { type: 'ringing' });
        at(this.ringMs * 2, { type: 'ended', code: 408 });
        break;
      case 'busy':
        at(800, { type: 'ended', code: 486 });
        break;
      case 'unreachable':
        at(1000, { type: 'ended', code: 480 });
        break;
      case 'invalid':
        at(400, { type: 'ended', code: 484 });
        break;
      case 'reject':
        at(300, { type: 'ringing' });
        at(this.ringMs, { type: 'ended', code: 603 });
        break;
    }
  }

  /** Test/demo helper: simulate an inbound call arriving. */
  simulateIncoming(from: string, team?: string): void {
    this.callId = `mock-in-${++this.seq}`;
    this.emit({ type: 'incoming', from, callId: this.callId, team });
    this.emit({ type: 'ringing' });
  }
  answer(): void {
    this.emit({ type: 'answered' });
    this.startStats();
  }

  reject(): void {
    this.endLocal();
  }

  hangup(): void {
    this.endLocal();
  }

  mute(): void {}

  hold(on: boolean): void {
    this.held = on;
    this.emit({ type: 'hold', whom: 'self', on });
  }

  sendDtmf(tone: string): void {
    this.sentDtmf.push(tone);
  }

  transfer(): void {}

  getCallId(): string | null {
    return this.callId;
  }

  /** Whether the line is currently on hold — exposed for tests. */
  get isHeld(): boolean {
    return this.held;
  }

  /** Test seam: fire one extra stats event with no call live. */
  emitStatsForTest(): void {
    if (this.stats) this.emit({ type: 'stats', stats: this.stats });
  }

  private endLocal(): void {
    this.cancelTimers();
    this.callId = null;
    this.emit({ type: 'ended', localHangup: true, code: 200, stats: this.lastStats ?? this.stats });
  }

  /** While a call is connected, emit the configured stats sample once a second. */
  private startStats(): void {
    const s = this.stats;
    if (!s) return;
    const tick = () => {
      this.statsSeq += 1;
      const grown: MediaStats = {
        ...s,
        packetsSent: s.packetsSent !== undefined ? s.packetsSent * this.statsSeq : undefined,
        packetsReceived: s.packetsReceived !== undefined ? s.packetsReceived * this.statsSeq : undefined,
      };
      this.lastStats = grown;
      this.emit({ type: 'stats', stats: grown });
      this.later(tick, 1000);
    };
    this.later(tick, 500);
  }

  private later(fn: () => void, ms: number): void {
    const cancel = this.schedule(() => {
      this.timers.delete(cancel);
      fn();
    }, ms);
    this.timers.add(cancel);
  }

  private cancelTimers(): void {
    for (const cancel of this.timers) cancel();
    this.timers.clear();
  }

  private emit(event: ProviderEvent): void {
    for (const h of [...this.handlers]) h(event);
  }
}
