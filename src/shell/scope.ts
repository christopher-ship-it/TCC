import { createContext, useContext } from 'react';
import type { AppId } from '../data/types';

/** Which app the dashboards are looking at: one app, or all of the apps this person may see. */
export interface ScopeValue {
  app: AppId | 'all';
  setApp: (app: AppId | 'all') => void;
  /** The apps this person may see, in display order. */
  visibleApps: AppId[];
  /** `app` resolved to a list — what pages filter by. */
  apps: AppId[];
}

export const ScopeContext = createContext<ScopeValue>({ app: 'all', setApp: () => undefined, visibleApps: [], apps: [] });

export function useScope() {
  return useContext(ScopeContext);
}
