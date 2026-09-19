import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PhoneController } from '../core/controller.ts';
import type { CallResult, Credentials, TelephonyProvider as Provider } from '../core/types.ts';
import { TelephonyContext } from './context.ts';

export interface TelephonyProviderProps {
  /** Create once (module scope or useMemo) — the provider instance must outlive re-renders. */
  provider: Provider;
  defaultCountryCode?: string;
  /** When given, connects automatically (and reconnects if they change). Omit to let the user sign in via <CallPanel>. */
  credentials?: Credentials | null;
  onCallEnded?: (result: CallResult) => void;
  children: ReactNode;
}

export function TelephonyProvider({ provider, defaultCountryCode, credentials, onCallEnded, children }: TelephonyProviderProps) {
  const [controller] = useState(() => new PhoneController({ provider, defaultCountryCode }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const onEndedRef = useRef(onCallEnded);
  useEffect(() => {
    onEndedRef.current = onCallEnded;
  });

  useEffect(() => {
    controller.start();
    const off = controller.onCallEnded((r) => onEndedRef.current?.(r));
    return () => {
      off();
      controller.stop();
    };
  }, [controller]);

  const userId = credentials?.userId;
  const password = credentials?.password;
  const region = credentials?.region;
  const displayName = credentials?.displayName;
  useEffect(() => {
    if (userId === undefined || password === undefined) return;
    // Deferred so React StrictMode's mount→unmount→mount never fires a real login for the discarded first mount.
    const t = setTimeout(() => controller.connect({ userId, password, region, displayName }), 0);
    return () => clearTimeout(t);
  }, [controller, userId, password, region, displayName]);

  return <TelephonyContext.Provider value={{ controller, snapshot, requiresCredentials: controller.requiresCredentials }}>{children}</TelephonyContext.Provider>;
}
