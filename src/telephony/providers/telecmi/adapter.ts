import type { Credentials, MediaStats, Meta, ProviderEvent, TelephonyProvider } from '../../core/types.ts';
import { acquireMicrophone, isVirtualInput } from '../../core/microphone.ts';
import type { RecordingQuery } from '../../core/types.ts';
import { fetchOutgoingCdr, fetchUserToken, pickRecording } from './cdr.ts';

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

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Translation of piopiyjs's own 1-second WebRTC sampler (`RTCStats`, lib/stats.js).
 * Only useful as a fallback: it has no packet counts for either direction, which is
 * exactly what direction-failure diagnosis needs. Field names are the SDK's
 * (including its `rountTrip` typo).
 */
function sdkStatsToMediaStats(d: Record<string, unknown>): MediaStats {
  return {
    ...(str(d.codec) ? { codec: str(d.codec) } : {}),
    ...(str(d.network) ? { network: str(d.network) } : {}),
    ...(num(d.delay) !== undefined ? { roundTripSec: num(d.delay) } : {}),
    packetsLost: num(d.totalPacketLost) ?? 0,
    jitterSec: num(d.jitter) ?? 0,
    remoteFractionLost: num(d.fractionLost),
    remoteRoundTripSec: num(d.rountTrip),
  };
}

/** Minimal WebRTC stats we read when polling the peer connection directly. */
interface RtcStatLike {
  type?: string;
  mimeType?: string;
  networkType?: string;
  currentRoundTripTime?: number;
  packetsReceived?: number;
  bytesReceived?: number;
  packetsLost?: number;
  jitter?: number;
  packetsSent?: number;
  bytesSent?: number;
  isRemote?: boolean;
  fractionLost?: number;
  audioLevel?: number;
}

async function pollPeerStats(peer: { getStats: () => Promise<unknown>; getSenders?: () => { track: MediaStreamTrack | null }[] }): Promise<MediaStats | null> {
  let report: unknown;
  try {
    report = await peer.getStats();
  } catch {
    return null; // peer connection gone mid-poll — the ended/failed event will follow on its own
  }
  const out: MediaStats = {};
  let codec: string | undefined;
  const sendCodecs = new Map<string, string>();
  // report.forEach over the RTCStatsReport (it is not a plain iterable in all browsers).
  (report as { forEach?: (cb: (s: RtcStatLike) => void) => void }).forEach?.((s) => {
    if (s.type === 'inbound-rtp') {
      if (s.packetsReceived !== undefined) out.packetsReceived = (out.packetsReceived ?? 0) + s.packetsReceived;
      if (s.bytesReceived !== undefined) out.bytesReceived = (out.bytesReceived ?? 0) + s.bytesReceived;
      if (s.packetsLost !== undefined) out.packetsLost = (out.packetsLost ?? 0) + s.packetsLost;
      if (s.jitter !== undefined) out.jitterSec = Math.max(out.jitterSec ?? 0, s.jitter);
    }
    if (s.type === 'outbound-rtp' && s.packetsSent !== undefined) {
      out.packetsSent = (out.packetsSent ?? 0) + s.packetsSent;
      if (s.bytesSent !== undefined) out.bytesSent = (out.bytesSent ?? 0) + s.bytesSent;
    }
    if (s.type === 'remote-inbound-rtp') {
      // The far side's RTCP report on the stream WE send.
      if (s.fractionLost !== undefined) out.remoteFractionLost = s.fractionLost;
      if (s.jitter !== undefined) out.remoteJitterSec = s.jitter;
      if (s.currentRoundTripTime !== undefined) out.remoteRoundTripSec = s.currentRoundTripTime;
    }
    if (s.type === 'candidate-pair' && (s as { nominated?: boolean }).nominated && s.currentRoundTripTime !== undefined) out.roundTripSec = s.currentRoundTripTime;
    if (s.type === 'local-candidate' && s.networkType) out.network = s.networkType;
    if (s.type === 'media-source') {
      if (s.mimeType) codec = s.mimeType;
      if (typeof s.audioLevel === 'number') out.audioLevel = s.audioLevel;
    }
    if (s.type === 'codec' && s.mimeType && !s.isRemote) sendCodecs.set(s.mimeType, s.mimeType);
  });
  const mime = codec ?? [...sendCodecs.keys()][0];
  if (mime) out.codec = mime;
  // What the call is REALLY sending from — the audio sender's own track, not what we asked the browser for.
  const micTrack = peer.getSenders?.().find((s) => s.track?.kind === 'audio')?.track;
  if (micTrack) {
    if (micTrack.label) out.micLabel = micTrack.label;
    out.micMuted = micTrack.muted;
  }
  return out;
}

//
// Peer-connection tap. The SDK never exposes its RTCPeerConnection, and its own
// stats event lacks packet counts, so before the SDK script loads we swap in a
// passthrough subclass that remembers the newest connection (the SDK is strictly
// single-call). The live call's full getStats() is then one await away.
//
let tappedPeer: RTCPeerConnection | null = null;

function savedMicChoice(): boolean {
  try {
    return !!localStorage.getItem('deviceId'); // the SDK's own key for an explicit input choice
  } catch {
    return false;
  }
}

/** Call-friendly audio constraints: drop a bare "default" deviceId, keep browser echo/noise processing on. */
function callAudioConstraints(constraints: MediaStreamConstraints): MediaStreamConstraints {
  const audio = constraints.audio;
  if (audio === true) return { ...constraints, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
  if (audio && typeof audio === 'object') {
    const rest = { ...audio } as Record<string, unknown>;
    if (typeof rest.deviceId === 'string' && (!rest.deviceId || rest.deviceId === 'default')) delete rest.deviceId;
    return { ...constraints, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...rest } };
  }
  return constraints;
}

function installMediaTap(): void {
  const g = globalThis as { navigator?: Navigator & { mediaDevices?: MediaDevices } };
  const md = g.navigator?.mediaDevices;
  if (!md || (md as { __tccMediaTap?: boolean }).__tccMediaTap) return;

  const origGetUserMedia = md.getUserMedia.bind(md);
  const origEnumerateDevices = md.enumerateDevices.bind(md);
  md.getUserMedia = async (constraints) => {
    if (!constraints?.audio) return origGetUserMedia(constraints); // not a microphone request
    let stream: MediaStream;
    try {
      // The browser's default input is often a virtual device (BlackHole, Iriun, Teams…) that captures
      // pure silence — the call connects and the far side hears nothing. Prefer a real microphone.
      const mic = await acquireMicrophone({ getUserMedia: origGetUserMedia, enumerateDevices: origEnumerateDevices }, callAudioConstraints(constraints));
      stream = mic.stream;
      if (mic.replacedVirtual) console.warn('[telecmi mic] Default input was a virtual device; using', mic.label);
      console.debug('[telecmi mic] Capturing from:', mic.label);
    } catch (err) {
      console.warn('[telecmi mic] Microphone selection failed, falling back to basic audio', err);
      stream = await origGetUserMedia({ audio: true, video: false });
    }
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      track.addEventListener('mute', () => console.warn('[telecmi mic] Audio track was MUTED by system:', track.label));
      track.addEventListener('unmute', () => console.debug('[telecmi mic] Audio track UNMUTED:', track.label));
    });
    return stream;
  };
  (md as { __tccMediaTap?: boolean }).__tccMediaTap = true;
}

function capturePeer(peer: RTCPeerConnection): void {
  tappedPeer = peer;
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'connected') {
      peer.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'audio') {
          s.track.enabled = true;
          console.debug('[telecmi peer] Verified audio sender track enabled:', s.track.label, 'muted:', s.track.muted);
        }
      });
    }
  });
}

function installPeerTap(): void {
  installMediaTap();
  const g = globalThis as { RTCPeerConnection?: unknown };
  const Native = g.RTCPeerConnection as (typeof RTCPeerConnection & { __tccTap?: boolean }) | undefined;
  if (!Native || Native.__tccTap) return;
  const Tapped = class extends Native {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      capturePeer(this);
    }

    override addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
      if (track.kind === 'audio') {
        track.enabled = true;
        track.addEventListener('mute', () => {
          console.warn('[telecmi audio track] Track MUTED by system/browser! Label:', track.label);
        });
        track.addEventListener('unmute', () => {
          console.log('[telecmi audio track] Track UNMUTED. Label:', track.label);
        });
      }
      return super.addTrack(track, ...streams);
    }
  };
  (Tapped as { __tccTap?: boolean }).__tccTap = true;
  g.RTCPeerConnection = Tapped;
}

/** First string in an event payload that looks like an audio file name (its last path segment, query stripped). */
export function findRecordingFile(payload: unknown, depth = 0): string | undefined {
  if (depth > 3 || payload == null) return undefined;
  if (typeof payload === 'string') {
    const m = /([^/\\?#]+\.(?:mp3|wav|ogg|m4a))(?:[?#].*)?$/i.exec(payload.trim());
    return m ? m[1] : undefined;
  }
  if (typeof payload === 'object') {
    for (const v of Object.values(payload as Record<string, unknown>)) {
      const hit = findRecordingFile(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

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
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private statsBusy = false;
  private micChecked = false;
  /** The agent's REST token (from the same login the SDK does) — lets us read their own call records, no App Secret. */
  private userToken: string | null = null;
  private trace: { remote: string; startedAt: number; answeredAt: number | null } | null = null;
  private readonly claimedRecordings = new Set<string>();
  /** Newest merged sample from the poll + the SDK's own sampler; re-emitted with 'ended'. */
  private lastStats: MediaStats | null = null;

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
    void fetchUserToken(credentials.userId, credentials.password).then((token) => {
      this.userToken = token;
      if (this.config.debug) console.debug('[telecmi] REST token', token ? 'obtained' : 'NOT obtained — recordings cannot be looked up');
    });
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
    this.userToken = null;
    const sdk = this.sdk;
    if (sdk?.isLogedIn()) sdk.logout(); // logout() on a non-registered UA emits an error event, so guard it
    else this.emit({ type: 'disconnected', reason: 'logout' });
  }

  dial(to: string, meta: Meta): void {
    this.trace = { remote: to, startedAt: Date.now(), answeredAt: null };
    // The SDK only accepts tags as one JSON *string* under `extra_param`.
    this.need().call(to, Object.keys(meta).length ? { extra_param: JSON.stringify(meta) } : undefined);
    this.startStatsPolling();
  }

  answer(): void {
    this.need().answer();
    this.startStatsPolling();
  }

  reject(): void {
    this.need().reject();
  }

  hangup(): void {
    this.stopStatsPolling();
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

  /** The recording for a call already made: asks the agent's own call records (`out_cdr`) and matches on number + start time. */
  async findRecording(q: RecordingQuery): Promise<string | undefined> {
    if (!this.userToken) return undefined;
    const entries = await fetchOutgoingCdr(this.userToken, q.startedAt - 5 * 60_000, q.startedAt + 10 * 60_000);
    const file = pickRecording(entries, q, this.claimedRecordings);
    if (file) this.claimedRecordings.add(file);
    if (this.config.debug) console.debug('[telecmi] out_cdr', { returned: entries.length, picked: file ?? null });
    return file;
  }

  /** After an answered call ends, poll for its recording — TeleCMI's record appears a few seconds after hangup. */
  private scheduleRecordingLookup(): void {
    const trace = this.trace;
    this.trace = null;
    if (!trace || trace.answeredAt === null || !this.userToken) return;
    const query: RecordingQuery = { remote: trace.remote, startedAt: trace.startedAt, talkSeconds: Math.round((Date.now() - trace.answeredAt) / 1000) };
    const delays = [3000, 5000, 8000, 12000, 20000]; // ≈ 48 s in total
    const attempt = async (i: number): Promise<void> => {
      const file = await this.findRecording(query).catch((e: unknown) => {
        if (this.config.debug) console.debug('[telecmi] out_cdr failed', e);
        return undefined;
      });
      if (file) this.emit({ type: 'recording', file });
      else if (i + 1 < delays.length) setTimeout(() => void attempt(i + 1), delays[i + 1]);
      else console.warn('[telecmi] No recording found for the call after', delays.length, 'lookups');
    };
    setTimeout(() => void attempt(0), delays[0]);
  }

  /** Swap the live call's microphone in place (RTCRtpSender.replaceTrack — no renegotiation, the far side never notices). */
  async setMicrophone(deviceId: string | null): Promise<string | undefined> {
    const md = globalThis.navigator?.mediaDevices;
    const sender = tappedPeer?.getSenders().find((s) => s.track?.kind === 'audio');
    if (!md || !sender) return undefined;
    // Goes through the patched getUserMedia: an explicit id is honoured, null means "best real microphone".
    const stream = await md.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
    const next = stream.getAudioTracks()[0];
    if (!next) return undefined;
    const previous = sender.track;
    next.enabled = previous ? previous.enabled : true; // keep a muted call muted
    await sender.replaceTrack(next);
    previous?.stop();
    return next.label;
  }

  /** First stats sample of a call: if it is sending from a virtual input (and the agent didn't pick that on purpose), swap to a real one. */
  private verifyMicrophone(stats: MediaStats): void {
    if (this.micChecked || !stats.micLabel) return;
    this.micChecked = true;
    if (!isVirtualInput(stats.micLabel) || savedMicChoice()) return;
    console.warn(`[telecmi mic] Call is sending from a virtual input (${stats.micLabel}) — switching to a real microphone`);
    this.setMicrophone(null)
      .then((label) => console.debug('[telecmi mic] Now sending from', label))
      .catch((e) => console.warn('[telecmi mic] Could not switch microphone', e));
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

  /** One last getStats() read raced against the SIP teardown, so the final sample lands before 'ended'. */
  private flushStats(): void {
    const peer = tappedPeer;
    if (!peer) return;
    pollPeerStats(peer)
      .then((stats) => {
        if (stats) this.lastStats = { ...this.lastStats, ...stats };
      })
      .catch(() => {});
  }

  private ensureSdk(displayName?: string): Promise<PiopiySdk> {
    if (this.sdk) return Promise.resolve(this.sdk);
    installPeerTap(); // before the SDK script runs, so it picks up the tap
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
    const on = (name: string, fn: (d: Record<string, unknown>) => ProviderEvent | Promise<ProviderEvent | null> | null) =>
      sdk.on(name, (d) => {
        if (this.config.debug) console.debug(`[telecmi] ${name}`, d); // raw SDK payloads — how the unverified event assumptions get checked
        const e = fn(d ?? {});
        if (e && typeof (e as Promise<unknown>).then === 'function') {
          (e as Promise<ProviderEvent | null>).then((ev) => {
            if (ev) this.emit(ev);
          }).catch(() => {});
        } else if (e) {
          this.emit(e as ProviderEvent);
        }
      });

    on('login', () => ({ type: 'ready' }));
    // 401 invalid user/password · 405 too many connections · 407 invalid IP (IP whitelisting) / token failure
    on('loginFailed', (d) => ({ type: 'connectFailed', code: num(d.code) ?? 401, reason: str(d.status) ?? 'login failed' }));
    on('logout', () => ({ type: 'disconnected', reason: 'logout' }));
    on('disconnected', () => ({ type: 'disconnected', reason: 'network' }));
    on('sbc_logout', () => ({ type: 'disconnected', reason: 'Signed in on another device' }));

    on('trying', () => ({ type: 'trying' }));
    on('ringing', () => ({ type: 'ringing' }));
    on('answered', () => {
      if (this.trace && this.trace.answeredAt === null) this.trace.answeredAt = Date.now();
      return { type: 'answered' };
    });
    on('inComingCall', (d) => ({ type: 'incoming', from: str(d.from) ?? 'unknown', callId: str(d.call_id), team: str(d.team_name), toNumber: str(d.to_number) }));
    // `hangup` = we ended/cancelled it; `ended` = the far side did (or it failed, with a SIP-style code).
    // Both carry the newest stats sample so the saved call result records the call's final media state.
    on('hangup', (d) => {
      this.stopStatsPolling();
      this.flushStats();
      this.scheduleRecordingLookup();
      return { type: 'ended', code: num(d.code), localHangup: true, stats: this.lastStats ?? undefined };
    });
    on('ended', (d) => {
      this.stopStatsPolling();
      this.flushStats();
      this.scheduleRecordingLookup();
      return { type: 'ended', code: num(d.code), stats: this.lastStats ?? undefined };
    });
    on('hold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: true }));
    on('unhold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: false }));
    on('error', (d) => ({ type: 'error', code: num(d.code) ?? 1001, message: str(d.status) ?? 'Softphone error' }));
    // TeleCMI's notification socket announces recordings (`cmi_record`). Payload shape is unverified, so the file name is
    // found by looking for an audio file name anywhere in it; the raw payload is logged under `debug`.
    on('record', (d) => {
      const file = findRecordingFile(d);
      const callId = str(d.call_id) ?? str(d.callId) ?? str(d.uuid) ?? str(d.cmiuuid);
      return file ? { type: 'recording', file, callId } : null;
    });
    on('mediaFailed', (d) => ({ type: 'mediaFailed', message: typeof d.status === 'string' ? d.status : 'Microphone unavailable — allow microphone access and retry' }));

    // The SDK's own sampler as a fallback for anything our direct poll misses
    // (e.g. a future SDK that stops exposing the peer connection). Normalised
    // and merged by the caller, like the poll's output.
    sdk.on('RTCStats', (d) => {
      if (this.config.debug) console.debug('[telecmi] RTCStats', d);
      const stats = sdkStatsToMediaStats(d ?? {});
      this.lastStats = { ...this.lastStats, ...stats };
      this.emit({ type: 'stats', stats: this.lastStats });
    });
    // ICE-level connectivity changes, distinct from SIP signalling — this is what
    // "the call was up but the network path died" looks like.
    sdk.on('RTC', (d) => {
      if (this.config.debug) console.debug('[telecmi] RTC', d);
      if ((d as { state?: unknown } | null)?.state === 'disconnected') this.emit({ type: 'error', code: 1004, message: 'Media connection lost (network changed?)' });
    });
  }

  /** Once a second while a call is live: full getStats() off the tapped peer connection. */
  private startStatsPolling(): void {
    if (this.statsTimer) return;
    installPeerTap();
    this.lastStats = null;
    this.micChecked = false;
    this.statsTimer = setInterval(() => {
      const peer = tappedPeer;
      if (!peer || this.statsBusy) return;
      this.statsBusy = true;
      pollPeerStats(peer)
        .then((stats) => {
          if (stats) {
            this.lastStats = { ...this.lastStats, ...stats };
            this.emit({ type: 'stats', stats: this.lastStats });
            this.verifyMicrophone(stats);
          }
        })
        .catch(() => {})
        .finally(() => {
          this.statsBusy = false;
        });
    }, 1000);
  }

  private stopStatsPolling(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
  }

  private emit(event: ProviderEvent): void {
    for (const h of [...this.handlers]) h(event);
  }
}
