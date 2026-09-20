import { useContext, useEffect, useState } from 'react';
import { TelephonyContext, type TelephonyContextValue } from './context.ts';

/** Telephony state + controller. Throws outside <TelephonyProvider>. */
export function useTelephony(): TelephonyContextValue {
  const ctx = useContext(TelephonyContext);
  if (!ctx) throw new Error('useTelephony must be used within <TelephonyProvider>');
  return ctx;
}

/** Same, but null when no provider is mounted — lets an app fall back gracefully when telephony is switched off. */
export function useTelephonyOptional(): TelephonyContextValue | null {
  return useContext(TelephonyContext);
}

/** Whole seconds elapsed since `since` (epoch ms), ticking once a second. 0 when `since` is null. */
export function useElapsedSeconds(since: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((Date.now() - since) / 1000));
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/** Lists available microphone devices and manages the active deviceId in localStorage for piopiy. */
export function useAudioDevices() {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    try {
      return (typeof localStorage !== 'undefined' && localStorage.getItem('deviceId')) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;

    let mounted = true;
    async function refresh() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const inputs = list
          .filter((d) => d.kind === 'audioinput')
          .map((d, idx) => ({
            deviceId: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`,
          }));

        if (mounted) {
          setDevices(inputs);
          try {
            const stored = localStorage.getItem('deviceId');
            if (stored && inputs.some((d) => d.deviceId === stored)) {
              setSelectedDeviceId(stored);
            } else if (inputs.length > 0 && !stored) {
              setSelectedDeviceId(inputs[0].deviceId);
            }
          } catch {
            // ignore localStorage errors
          }
        }
      } catch {
        // user may not have granted media permissions yet
      }
    }

    refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', refresh);
    return () => {
      mounted = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  function selectDevice(deviceId: string) {
    setSelectedDeviceId(deviceId);
    try {
      if (typeof localStorage !== 'undefined') {
        if (deviceId) localStorage.setItem('deviceId', deviceId);
        else localStorage.removeItem('deviceId');
      }
    } catch {
      // ignore
    }
  }

  return { devices, selectedDeviceId, selectDevice };
}

/**
 * Monitors live microphone input volume (0-100) using Web Audio AnalyserNode.
 * Can be active while on a call or during an explicit test mode.
 */
export function useMicLevel(active: boolean, deviceId?: string): { volume: number; isSilent: boolean } {
  const [volume, setVolume] = useState(0);
  const [isSilent, setIsSilent] = useState(false);

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setVolume(0);
      setIsSilent(false);
      return;
    }

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let animFrame: number | null = null;
    let silentStartTime: number | null = null;

    async function start() {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) return;

        audioCtx = new AudioCtxClass();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function tick() {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Scale to 0-100 percentage
          const pct = Math.min(100, Math.round((avg / 64) * 100));
          setVolume(pct);

          if (pct < 2) {
            if (!silentStartTime) silentStartTime = Date.now();
            else if (Date.now() - silentStartTime > 2500) {
              setIsSilent(true);
            }
          } else {
            silentStartTime = null;
            setIsSilent(false);
          }

          animFrame = requestAnimationFrame(tick);
        }

        tick();
      } catch {
        setIsSilent(true);
      }
    }

    start();

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
    };
  }, [active, deviceId]);

  return { volume, isSilent };
}
