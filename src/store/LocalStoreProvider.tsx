import React, { useEffect, useMemo, useReducer } from 'react';
import { generateSeed } from '../data/seed';
import type { AgentAccount } from '../data/types';
import { cleanLegacyCallData } from '../lib/attachRecording';
import { BaseStoreContext, type Action, type State } from './context';
import { reducer } from './reducer';

const STORAGE_KEY = 'tcc-store-v1';

function loadInitial(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.users && parsed.agents) return { ...parsed, audit: parsed.audit ?? [], users: cleanLegacyCallData(parsed.users), customerSource: parsed.customerSource ?? 'sample' };
    }
  } catch {
    // fall through to fresh seed
  }
  const seed = generateSeed();
  return { ...seed, currentAgentId: null, customerSource: 'sample' };
}

function localReducer(state: State, action: Action): State {
  if (action.type === 'RESET') {
    localStorage.removeItem(STORAGE_KEY);
    const seed = generateSeed(Date.now());
    return { ...seed, currentAgentId: null, customerSource: 'sample' };
  }
  return reducer(state, action);
}

// Used when no Firebase project is configured (VITE_FIREBASE_*): everything
// lives in this browser's localStorage. This is what the published single-file
// artifact preview runs on, and it's the zero-setup path for local dev.
export function LocalStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(localReducer, undefined, loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentAgent = useMemo(() => state.agents.find((a) => a.id === state.currentAgentId) ?? null, [state.agents, state.currentAgentId]);
  const createAgent = useMemo(
    () => async (agent: AgentAccount, actorId: string) => {
      dispatch({ type: 'CREATE_AGENT', agent, actorId });
      return { ok: true as const };
    },
    [],
  );
  const value = useMemo(() => ({ state, dispatch, currentAgent, ready: true, backend: 'local' as const, createAgent }), [state, currentAgent, createAgent]);

  return <BaseStoreContext.Provider value={value}>{children}</BaseStoreContext.Provider>;
}
