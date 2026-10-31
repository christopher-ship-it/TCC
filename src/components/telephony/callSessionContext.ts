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
  /** The call was completed in the call card; the agent moves on to the next customer. */
  completeWrapUp: () => void;
  /** The recording for the call waiting to be completed was found. */
  attachRecording: (file: string) => void;
  /** Look for a logged call's recording now (what TeleCMI announced, then the softphone's call records). */
  checkRecording: (entryId: string) => Promise<{ found: boolean; message: string }>;
  /** Why the connected line is not marked available for incoming calls, when it isn't. */
  presenceError: string | null;
}

export const CallSessionContext = createContext<CallSessionValue>({
  available: false,
  liveCustomerId: null,
  wrapUp: null,
  dial: () => ({ ok: false, message: 'Calling is not set up in this build.' }),
  clearWrapUp: () => undefined,
  completeWrapUp: () => undefined,
  attachRecording: () => undefined,
  checkRecording: async () => ({ found: false, message: 'Calling is not set up in this build.' }),
  presenceError: null,
});

export function useCallSession() {
  return useContext(CallSessionContext);
}
