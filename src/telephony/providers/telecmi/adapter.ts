import type { Credentials, MediaStats, Meta, ProviderEvent, TelephonyProvider } from '../../core/types.ts';

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
}

async function pollPeerStats(peer: { getStats: () => Promise<unknown> }): Promise<MediaStats | null> {
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
    if (s.type === 'media-source' && s.mimeType) codec = s.mimeType;
    if (s.type === 'codec' && s.mimeType && !s.isRemote) sendCodecs.set(s.mimeType, s.mimeType);
  });
  const mime = codec ?? [...sendCodecs.keys()][0];
  if (mime) out.codec = mime;
  return out;
}

//
// Peer-connection tap. The SDK never exposes its RTCPeerConnection, and its own
// stats event lacks packet counts, so before the SDK script loads we swap in a
// passthrough subclass that remembers the newest connection (the SDK is strictly
// single-call). The live call's full getStats() is then one await away.
//
let tappedPeer: RTCPeerConnection | null = null;
let currentCallRecorder: { stop: () => Promise<string | undefined> } | null = null;

function installMediaTap(): void {
  const g = globalThis as { navigator?: Navigator & { mediaDevices?: MediaDevices } };
  const md = g.navigator?.mediaDevices;
  if (!md || (md as { __tccMediaTap?: boolean }).__tccMediaTap) return;

  const origGetUserMedia = md.getUserMedia.bind(md);
  md.getUserMedia = async (constraints) => {
    let cleanConstraints: MediaStreamConstraints = constraints || { audio: true };
    if (typeof cleanConstraints.audio === 'object') {
      const audio = { ...cleanConstraints.audio } as Record<string, unknown>;
      // If deviceId is empty or "default", remove it so Chrome uses default input safely
      if (typeof audio.deviceId === 'string' && (!audio.deviceId || audio.deviceId === 'default')) {
        delete audio.deviceId;
      } else if (typeof audio.deviceId === 'string') {
        audio.deviceId = { ideal: audio.deviceId };
      }
      cleanConstraints = {
        ...cleanConstraints,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...audio,
        },
      };
    } else if (cleanConstraints.audio === true) {
      cleanConstraints = {
        ...cleanConstraints,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };
    }

    try {
      const stream = await origGetUserMedia(cleanConstraints);
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
        console.debug('[telecmi] Acquired audio track:', track.label, 'enabled:', track.enabled, 'muted:', track.muted);
      });
      return stream;
    } catch (err) {
      console.warn('[telecmi] getUserMedia failed with constraints, falling back to basic audio', err);
      const fallback = await origGetUserMedia({ audio: true, video: false });
      fallback.getAudioTracks().forEach((t) => { t.enabled = true; });
      return fallback;
    }
  };
  (md as { __tccMediaTap?: boolean }).__tccMediaTap = true;
}

function startCallRecording(peer: RTCPeerConnection): { stop: () => Promise<string | undefined> } | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; MediaRecorder?: typeof MediaRecorder; MediaStream?: typeof MediaStream };
  if (!g.AudioContext || !g.MediaRecorder || !g.MediaStream) return null;

  try {
    const audioCtx = new g.AudioContext();
    const dest = audioCtx.createMediaStreamDestination();

    let localConnected = false;
    let remoteConnected = false;

    function attachTracks() {
      peer.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'audio' && !localConnected) {
          try {
            const src = audioCtx.createMediaStreamSource(new g.MediaStream!([s.track]));
            src.connect(dest);
            localConnected = true;
          } catch {
            // ignore
          }
        }
      });
      peer.getReceivers().forEach((r) => {
        if (r.track && r.track.kind === 'audio' && !remoteConnected) {
          try {
            const src = audioCtx.createMediaStreamSource(new g.MediaStream!([r.track]));
            src.connect(dest);
            remoteConnected = true;
          } catch {
            // ignore
          }
        }
      });
    }

    attachTracks();
    peer.addEventListener('track', () => attachTracks());

    const recorder = new g.MediaRecorder(dest.stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.start(1000);

    return {
      stop: () =>
        new Promise<string | undefined>((resolve) => {
          if (recorder.state === 'inactive') {
            audioCtx.close().catch(() => {});
            return resolve(undefined);
          }
          recorder.onstop = () => {
            try {
              audioCtx.close().catch(() => {});
              if (chunks.length > 0) {
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                const url = URL.createObjectURL(blob);
                resolve(url);
              } else {
                resolve(undefined);
              }
            } catch {
              resolve(undefined);
            }
          };
          try {
            recorder.stop();
          } catch {
            resolve(undefined);
          }
        }),
    };
  } catch {
    return null;
  }
}

function capturePeer(peer: RTCPeerConnection): void {
  tappedPeer = peer;
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'connected') {
      peer.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'audio') {
          s.track.enabled = true;
        }
      });
      currentCallRecorder ??= startCallRecording(peer);
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
      }
      return super.addTrack(track, ...streams);
    }
  };
  (Tapped as { __tccTap?: boolean }).__tccTap = true;
  g.RTCPeerConnection = Tapped;
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
    on('answered', () => ({ type: 'answered' }));
    on('inComingCall', (d) => ({ type: 'incoming', from: str(d.from) ?? 'unknown', callId: str(d.call_id), team: str(d.team_name), toNumber: str(d.to_number) }));
    // `hangup` = we ended/cancelled it; `ended` = the far side did (or it failed, with a SIP-style code).
    // Both carry the newest stats sample so the saved call result records the call's final media state.
    on('hangup', async (d) => {
      this.stopStatsPolling();
      this.flushStats();
      const recUrl = await currentCallRecorder?.stop().catch(() => undefined);
      currentCallRecorder = null;
      return { type: 'ended', code: num(d.code), localHangup: true, stats: this.lastStats ?? undefined, recordingBlobUrl: recUrl };
    });
    on('ended', async (d) => {
      this.stopStatsPolling();
      this.flushStats();
      const recUrl = await currentCallRecorder?.stop().catch(() => undefined);
      currentCallRecorder = null;
      return { type: 'ended', code: num(d.code), stats: this.lastStats ?? undefined, recordingBlobUrl: recUrl };
    });
    on('hold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: true }));
    on('unhold', (d) => ({ type: 'hold', whom: d.whom === 'other' ? 'remote' : 'self', on: false }));
    on('error', (d) => ({ type: 'error', code: num(d.code) ?? 1001, message: str(d.status) ?? 'Softphone error' }));
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
    this.statsTimer = setInterval(() => {
      const peer = tappedPeer;
      if (!peer || this.statsBusy) return;
      this.statsBusy = true;
      pollPeerStats(peer)
        .then((stats) => {
          if (stats) {
            this.lastStats = { ...this.lastStats, ...stats };
            this.emit({ type: 'stats', stats: this.lastStats });
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
