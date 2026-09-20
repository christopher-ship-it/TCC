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

export interface RecordingQuery {
  /** Number that was dialled (any format — compared on its last 10 digits). */
  remote: string;
  /** When the call started, epoch ms. */
  startedAt: number;
  talkSeconds?: number;
}

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
  /** Recording file name, if the provider announced one while the call was live. */
  recordingFile?: string;
  meta: Meta;
  /** Latest media-quality sample; refreshed while the call is live. */
  stats: MediaStats | null;
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
  /** Last media-quality sample seen before the call ended. Null for calls that
   *  never connected (and for providers that report no stats). */
  stats: MediaStats | null;
  /** In-browser recorded audio blob URL of the actual call, available immediately. */
  recordingBlobUrl?: string;
  /** Provider-side recording file name, when it was announced before the call ended. */
  recordingFile?: string;
}

export interface CallSnapshot {
  provider: string;
  connection: ConnectionState;
  connectionError: { code: number; reason: string } | null;
  call: CallSession | null;
  lastResult: CallResult | null;
  error: { code: number; message: string } | null;
}

/** One sample of WebRTC media quality, taken while a call is live.
 *  All fields optional — a provider emits what it can measure.
 *
 *  Two directions, which is the point: `packetsSent` / `bytesSent` count audio
 *  we're pushing out, and the `remote*` fields carry the far side's RTCP report
 *  on that same stream — so a stuck `packetsSent` or a `remoteFractionLost`
 *  near 1 means OUR microphone uplink is broken while the call still sounds
 *  fine to us. The plain `packetsReceived` / `packetsLost` / `jitterSec` /
 *  `roundTripSec` describe their voice coming towards us. */
export interface MediaStats {
  /** Audio codec in use, e.g. "audio/opus". */
  codec?: string;
  /** Current network type of the local candidate: wifi, ethernet, cellular… */
  network?: string;
  /** Round-trip time to the far party, seconds (WebRTC's currentRoundTripTime). */
  roundTripSec?: number;
  /** Receiving (their voice → us): cumulative packets / bytes since call start. */
  packetsReceived?: number;
  bytesReceived?: number;
  packetsLost?: number;
  jitterSec?: number;
  /** Sending (our voice → them): cumulative packets / bytes since call start. A
   *  flat count during an active call is a broken microphone or un-granted permission. */
  packetsSent?: number;
  bytesSent?: number;
  /** RTCP reports from the remote party about the stream they're receiving from us.
   *  Falls towards 0 when our uplink is broken even though we're "sending". */
  remoteFractionLost?: number;
  remoteJitterSec?: number;
  remoteRoundTripSec?: number;
  /** Audio level from WebRTC media-source (0 to 1). 0 indicates silent mic input. */
  audioLevel?: number;
  /** Name of the microphone the call is actually sending from (read off the live audio sender). */
  micLabel?: string;
  /** The browser reports the outgoing mic track as muted — no samples are arriving from the device. */
  micMuted?: boolean;
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
  | { type: 'ended'; code?: number; localHangup?: boolean; stats?: MediaStats; recordingBlobUrl?: string }
  | { type: 'hold'; whom: 'self' | 'remote'; on: boolean }
  | { type: 'error'; code: number; message: string }
  | { type: 'mediaFailed'; message: string }
  | { type: 'stats'; stats: MediaStats }
  /** The provider says a recording of a call exists. Can arrive during the call or well after it ended. */
  | { type: 'recording'; file: string; callId?: string };

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
  /** Swap the microphone of the call in progress. null = pick the best real one. Resolves to the device now in use. */
  setMicrophone?(deviceId: string | null): Promise<string | undefined>;
  /** Look up the provider's recording for a call already made (matched on number + start time). Resolves to a file name. */
  findRecording?(query: RecordingQuery): Promise<string | undefined>;
  getCallId(): string | null;
  subscribe(handler: (event: ProviderEvent) => void): () => void;
}
