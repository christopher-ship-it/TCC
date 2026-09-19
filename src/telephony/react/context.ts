import { createContext } from 'react';
import type { PhoneController } from '../core/controller.ts';
import type { CallSnapshot } from '../core/types.ts';

export interface TelephonyContextValue {
  controller: PhoneController;
  snapshot: CallSnapshot;
  requiresCredentials: boolean;
}

export const TelephonyContext = createContext<TelephonyContextValue | null>(null);
