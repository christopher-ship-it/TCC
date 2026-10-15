import { createContext, useContext } from 'react';
import type { CallResult } from '../../telephony';
import type { CustomerUser } from '../../data/types';

export type DialOutcome = { ok: true } | { ok: false; message: string };

export interface CallSessionValue {
  /** A telephony provider is configured for this build (mock or TeleCMI). */
  available: boolean;
  /** Customer id of the call in progress, if any. */
  liveCustomerId: string | null;
  /** A call that has ended but is not logged yet — the agent still owes its outcome. */
  wrapUp: { result: CallResult; customerId: string } | null;
  dial: (user: CustomerUser) => DialOutcome;
  /** Called once the ended call has been logged. */
  clearWrapUp: () => void;
}

export const CallSessionContext = createContext<CallSessionValue>({
  available: false,
  liveCustomerId: null,
  wrapUp: null,
  dial: () => ({ ok: false, message: 'Calling is not set up in this build.' }),
  clearWrapUp: () => undefined,
});

export function useCallSession() {
  return useContext(CallSessionContext);
}
