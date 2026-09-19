import type { Credentials, Meta, ProviderEvent, TelephonyProvider } from '../../core/types.ts';

/** Regional signalling hosts from TeleCMI's Browser SDK docs. */
export const TELECMI_REGIONS = {
  india: 'sbcind.telecmi.com',
  asia: 'sbcsg.telecmi.com',
  europe: 'sbcuk.telecmi.com',
  america: 'sbcus.telecmi.com',
} as const;

export interface TeleCmiConfig {
  /** URL of piopiy.min.js (from the `piopiyjs` package's dist/). Passed in rather than imported so this
   *  file stays bundler-agnostic. The SDK's lib/ entry needs `lodash`, which the package doesn't declare,
   *  so the self-contained dist bundle is the reliable way to load it. */
  scriptUrl: string;
  /** SBC host. Default India. */
  region?: string;
  debug?: boolean;
  /** Seconds an outbound call rings before the SDK gives up. Default 60. */
  ringTimeSec?: number;
}

// The parts of the piopiyjs surface we use (the package ships no TypeScript types).
interface PiopiySdk {
  on(event: string, cb: (data: Record<string, unknown>) => void): void;
  login(userId: string, password: string, region: string): void;
  logout(): void;
  call(to: string, options?: { extra_param: string }): void;
  answer(): void;
  reject(): void;
  terminate(): void;
  hold(): void;
  unHold(): void;
  mute(): void;
  unMute(): void;
  sendDtmf(tone: string): void;
  transfer(to: string, cb?: (r: unknown) => void): void;
  getCallId(): string | false;
  isLogedIn(): boolean;
}
type PiopiyCtor = new (opts: { name?: string; debug?: boolean; autoplay?: boolean; ringTime?: number }) => PiopiySdk;

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function loadSdk(scriptUrl: string): Promise<PiopiyCtor> {
  const g = globalThis as { PIOPIY?: unknown; document?: Document };
  const pick = (): PiopiyCtor | null => {
    const v = g.PIOPIY as { default?: unknown } | undefined;
    const ctor = (v && typeof v === 'object' && 'default' in v ? v.default : v) as unknown;
    return typeof ctor === 'function' ? (ctor as PiopiyCtor) : null;
  };
  const existing = pick();
  if (existing) return Promise.resolve(existing);
  const doc = g.document;
  if (!doc) return Promise.reject(new Error('TeleCMI softphone needs a browser'));
  return new Promise((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = scriptUrl;
    el.async = true;
    el.onload = () => {
      const ctor = pick();
      if (ctor) resolve(ctor);
      else reject(new Error('piopiy.min.js loaded but exposed no PIOPIY constructor'));
    };
    el.onerror = () => reject(new Error(`Could not load the TeleCMI SDK from ${scriptUrl}`));
    doc.head.appendChild(el);
  });
}

/**
 * TeleCMI (piopiyjs) adapter. The SDK keeps module-level singletons (one UA,
 * one audio tag), so exactly one instance is ever created and reused across
 * connect()/disconnect() cycles.
 *
 * NOT YET VERIFIED AGAINST A LIVE ACCOUNT (the plan was expired when this was
 * written): event payload shapes below come from the SDK source + docs.
 */
export class TeleCmiProvider implements TelephonyProvider {
  readonly name = 'telecmi';
  readonly requiresCredentials = true;

  private readonly config: TeleCmiConfig;
  private readonly handlers = new Set<(e: ProviderEvent) => void>();
  private sdk: PiopiySdk | null = null;
  private loading: Promise<PiopiySdk> | null = null;
  private desiredConnected = false;

  constructor(config: TeleCmiConfig) {
    this.config = config;
  }

  subscribe(handler: (e: ProviderEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  connect(credentials: Credentials): void {
    this.desiredConnected = true;
    this.ensureSdk(credentials.displayName)
      .then((sdk) => {
        if (!this.desiredConnected) return; // disconnect() won the race
        // Always pass the region: the SDK builds the SIP URI from it and would produce "user@undefined" otherwise.
        sdk.login(credentials.userId, credentials.password, credentials.region ?? this.config.region ?? TELECMI_REGIONS.india);
      })
      .catch((e: unknown) => this.emit({ type: 'connectFailed', code: 500, reason: e instanceof Error ? e.message : 'Could not start the softphone' }));
  }

  disconnect(): void {
    this.desiredConnected = false;
    const sdk = this.sdk;
    if (sdk?.isLogedIn()) sdk.logout(); // logout() on a non-registered UA emits an error event, so guard it
    else this.emit({ type: 'disconnected', reason: 'logout' });
  }

  dial(to: string, meta: Meta): void {
    // The SDK only accepts tags as one JSON *string* under `extra_param`.
    this.need().call(to, Object.keys(meta).length ? { extra_param: JSON.stringify(meta) } : undefined);
  }

  answer(): void {
    this.need().answer();
  }

  reject(): void {
    this.need().reject();
  }

  hangup(): void {
    this.need().terminate();
  }

  mute(on: boolean): void {
    const sdk = this.need();
    if (on) sdk.mute();
    else sdk.unMute();
  }

  hold(on: boolean): void {
    const sdk = this.need();
    if (on) sdk.hold();
    else sdk.unHold();
  }

  sendDtmf(tone: string): void {
    this.need().sendDtmf(tone);
  }

  transfer(to: string): void {
    this.need().transfer(to, (r) => {
      const err = (r as { error?: string } | null)?.error;
      if (err) this.emit({ type: 'error', code: 1003, message: `Transfer failed: ${err}` });
    });
  }

  getCallId(): string | null {
    try {
      return this.sdk?.getCallId() || null;
    } catch {
      return null;
    }
  }

  private need(): PiopiySdk {
    if (!this.sdk) throw new Error('Softphone is not connected');
    return this.sdk;
  }

  private ensureSdk(displayName?: string): Promise<PiopiySdk> {
    if (this.sdk) return Promise.resolve(this.sdk);
    this.loading ??= loadSdk(this.config.scriptUrl).then((Ctor) => {
      const sdk = new Ctor({ name: displayName, debug: this.config.debug ?? false, autoplay: true, ringTime: this.config.ringTimeSec ?? 60 });
      this.wire(sdk);
      this.sdk = sdk;
      return sdk;
    });
    this.loading.catch(() => {
      this.loading = null; // allow a retry after a failed script load
    });
    return this.loading;
  }

  /** Translate the SDK's event vocabulary into ProviderEvents. */
  private wire(sdk: PiopiySdk): void {
    const on = (name: string, fn: (d: Record<string, unknown>) => ProviderEvent | null) =>
      sdk.on(name, (d) => {
        const e = fn(d ?? {});
        if (e) this.emit(e);
      });

    on('login', () => ({ type: 'ready' }));
    // 401 invalid user/password · 405 too many connections · 407 invalid IP (IP whitelisting) / token failure
    on('loginFailed', (d) => ({ type: 'connectFailed', code: num(d.code) ?? 401, reason: str(d.status) ?? 'login failed' }));
    on('logout', () => ({ type: 'disconnected', reason: 'logout' }));
    on('disconnected', () => ({ type: 'disconnected', reason: 'network' }));
    on('sbc_logout', () => ({ type: 'disconnected', reason: 'Signed in on another device' }));

    on('trying', () => ({ type: 'trying' }));
    on('ringing', () => ({ type: 'ringing' }));
    on('answered', () => ({ type: 'answered' }));
    on('inComingCall', (d) => ({ type: 'incoming', from: str(d.from) ?? 'unknown', callId: str(d.call_id), team: str(d.team_name), toNumber: str(d.to_number) }));
    // `hangup` = we ended/cancelled it; `ended` = the far side did (or it failed, with a SIP-style code).
    on('hangup', (d) => ({ type: 'ended', code: num(d.code), localHangup: true }));
    on('ended', (d) => ({ type: 'ended', code: num(d.code) }));
    on('hold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: true }));
    on('unhold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: false }));
    on('error', (d) => ({ type: 'error', code: num(d.code) ?? 1001, message: str(d.status) ?? 'Softphone error' }));
    on('mediaFailed', (d) => ({ type: 'mediaFailed', message: typeof d.status === 'string' ? d.status : 'Microphone unavailable — allow microphone access and retry' }));
  }

  private emit(event: ProviderEvent): void {
    for (const h of [...this.handlers]) h(event);
  }
}
