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
