// Microphone selection for softphones. Browsers hand `getUserMedia({audio: true})` whatever the OS
// calls its default input — and on a machine with audio-routing tools installed (BlackHole,
// Soundflower, Iriun, Teams/Zoom/OBS virtual devices…) that is often a virtual device that
// delivers digital silence. The call still connects and packets still flow; the other side just
// hears nothing. This module picks a real microphone instead. No framework, no provider.

export interface InputDevice {
  deviceId: string;
  label: string;
}

// Chrome tags CoreAudio virtual/aggregate devices with "(Virtual)" / "(Aggregate)"; the names catch
// the common routing tools on platforms that don't get that suffix.
const VIRTUAL_INPUT = /\((virtual|aggregate)\)|blackhole|soundflower|loopback|vb-?cable|cable output|voicemeeter|iriun|epoccam|multi-?output|teams audio|zoom ?audio|\bobs\b|krisp|nvidia broadcast|\bndi\b|camo/i;

export function isVirtualInput(label: string): boolean {
  return VIRTUAL_INPUT.test(label);
}

const PSEUDO_IDS = new Set(['default', 'communications']);
const BUILT_IN = /built-?in|internal|macbook|integrated/i;

/**
 * Which input to use: the user's saved choice if it still exists (an explicit choice is respected
 * even if it looks virtual), otherwise the built-in mic, otherwise any identifiable non-virtual mic,
 * otherwise null (meaning: let the browser decide).
 */
export function choosePreferredInput(devices: InputDevice[], savedId?: string | null): InputDevice | null {
  const inputs = devices.filter((d) => d.deviceId && !PSEUDO_IDS.has(d.deviceId));
  if (savedId) {
    const saved = inputs.find((d) => d.deviceId === savedId);
    if (saved) return saved;
  }
  // Devices are unlabelled until the first permission grant; never guess among nameless inputs.
  const real = inputs.filter((d) => d.label && !isVirtualInput(d.label));
  return real.find((d) => BUILT_IN.test(d.label)) ?? real[0] ?? null;
}

/** The deviceId a constraints object explicitly asks for, or null when it leaves the choice to the browser. */
export function explicitDeviceId(audio: MediaStreamConstraints['audio']): string | null {
  if (!audio || typeof audio !== 'object') return null;
  const c = audio.deviceId as unknown;
  const raw = typeof c === 'string' || Array.isArray(c) ? c : c && typeof c === 'object' ? ((c as { exact?: unknown }).exact ?? (c as { ideal?: unknown }).ideal) : undefined;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === 'string' && id && !PSEUDO_IDS.has(id) ? id : null;
}

export interface MediaDevicesLike {
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
}

export interface AcquiredMicrophone {
  stream: MediaStream;
  label: string;
  /** True when the browser's default was a virtual input and we replaced it with a real one. */
  replacedVirtual: boolean;
}

async function listInputs(md: MediaDevicesLike): Promise<InputDevice[]> {
  try {
    return (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

const withDevice = (c: MediaStreamConstraints | undefined, deviceId: string): MediaStreamConstraints => ({
  ...c,
  audio: { ...(c && typeof c.audio === 'object' ? c.audio : {}), deviceId: { exact: deviceId } },
});

const labelOf = (s: MediaStream): string => s.getAudioTracks()[0]?.label ?? '';

/**
 * getUserMedia for a call: honours an explicit device, otherwise prefers a real microphone over a
 * virtual default. Never fails where a plain getUserMedia would have succeeded — every fallback ends
 * at the browser's own default.
 */
export async function acquireMicrophone(md: MediaDevicesLike, constraints: MediaStreamConstraints | undefined): Promise<AcquiredMicrophone> {
  const requested = constraints ?? { audio: true };
  if (explicitDeviceId(requested.audio)) {
    const stream = await md.getUserMedia(requested);
    return { stream, label: labelOf(stream), replacedVirtual: false };
  }

  // Labels are only populated after the first permission grant, so this can come back unlabelled on a first call.
  const first = choosePreferredInput(await listInputs(md));
  if (first) {
    try {
      const stream = await md.getUserMedia(withDevice(requested, first.deviceId));
      return { stream, label: labelOf(stream) || first.label, replacedVirtual: false };
    } catch {
      /* device vanished or refused — fall through to the default */
    }
  }

  const stream = await md.getUserMedia(requested);
  const label = labelOf(stream);
  if (!isVirtualInput(label)) return { stream, label, replacedVirtual: false };

  // First call on this browser: permission just granted, so labels exist now — swap to a real mic if there is one.
  const better = choosePreferredInput(await listInputs(md));
  if (better && !isVirtualInput(better.label)) {
    try {
      const real = await md.getUserMedia(withDevice(requested, better.deviceId));
      stream.getTracks().forEach((t) => t.stop());
      return { stream: real, label: labelOf(real) || better.label, replacedVirtual: true };
    } catch {
      /* keep the default stream */
    }
  }
  return { stream, label, replacedVirtual: false };
}
