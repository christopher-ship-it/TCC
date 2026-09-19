// Provider-agnostic telephony types. Nothing in src/telephony/core may import
// from outside src/telephony (enforced by isolation.test.ts) so the whole
// folder can be lifted into any other project.

/** Free-form tags attached to a call (customer id, agent id, app…). String values only —
 *  TeleCMI carries them as a JSON string and echoes them back in webhooks. */
export type Meta = Record<string, string>;

export interface Credentials {
  userId: string;
  password: string;
  /** Provider region / SBC host override. */
  region?: string;
  displayName?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'ready' | 'failed';
export type CallDirection = 'outbound' | 'inbound';
export type CallState = 'dialing' | 'ringing' | 'incoming' | 'connected';

/** How a call ended, in provider-neutral terms. Apps map this onto their own status vocabulary. */
export type Disposition =
  | 'connected' // the call was answered and then ended normally
  | 'no-answer' // rang out / remote timeout
  | 'busy'
  | 'unreachable' // switched off, out of coverage, or not a valid number
  | 'rejected' // remote declined (or we rejected an inbound call)
  | 'cancelled' // we hung up before it was answered
  | 'failed'; // technical failure (mic, network, provider error)

export interface CallSession {
  /** Local id, stable for the life of the call. */
  id: string;
  providerCallId: string | null;
  direction: CallDirection;
  /** Remote party, E.164 digits without '+' for outbound. */
  remote: string;
  state: CallState;
  startedAt: number;
  answeredAt: number | null;
  muted: boolean;
  held: boolean;
  remoteHeld: boolean;
  hangupRequested: boolean;
  meta: Meta;
}

export interface CallResult {
  id: string;
  provider: string;
  providerCallId: string | null;
  direction: CallDirection;
  remote: string;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number;
  ringSeconds: number;
  talkSeconds: number;
  disposition: Disposition;
  /** Raw SIP-style status code from the provider when there was one. */
  endCode: number | null;
  meta: Meta;
}

export interface CallSnapshot {
  provider: string;
  connection: ConnectionState;
  connectionError: { code: number; reason: string } | null;
  call: CallSession | null;
  lastResult: CallResult | null;
  error: { code: number; message: string } | null;
}

/** Normalised events every provider adapter must emit. */
export type ProviderEvent =
  | { type: 'ready' }
  | { type: 'connectFailed'; code: number; reason: string }
  | { type: 'disconnected'; reason?: string }
  | { type: 'trying'; callId?: string }
  | { type: 'ringing'; callId?: string }
  | { type: 'incoming'; from: string; callId?: string; team?: string; toNumber?: string }
  | { type: 'answered'; callId?: string }
  | { type: 'ended'; code?: number; localHangup?: boolean }
  | { type: 'hold'; whom: 'self' | 'remote'; on: boolean }
  | { type: 'error'; code: number; message: string }
  | { type: 'mediaFailed'; message: string };

export interface TelephonyProvider {
  readonly name: string;
  /** True when the agent must supply per-agent credentials (a softphone login). */
  readonly requiresCredentials: boolean;
  connect(credentials: Credentials): void;
  disconnect(): void;
  dial(to: string, meta: Meta): void;
  answer(): void;
  reject(): void;
  hangup(): void;
  mute(on: boolean): void;
  hold(on: boolean): void;
  sendDtmf(tone: string): void;
  transfer?(to: string): void;
  getCallId(): string | null;
  subscribe(handler: (event: ProviderEvent) => void): () => void;
}
