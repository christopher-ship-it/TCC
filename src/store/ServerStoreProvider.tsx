// The store for a deployment with its own database (VITE_STORE=server, see server/store.ts). Everyone signs in with
// the username and password an admin gave them, and everyone sees the same people, customers and calls.
//
// Changes run through the same reducer as the demo store, so every screen behaves the same; whatever the reducer
// changed is then saved to the server, and changes other people made are fetched every few seconds.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APPS, STATE_DEFS } from '../data/seed';
import type { AgentAccount, AppId, AuditEntry, CustomerUser, EscalationRecord } from '../data/types';
import { BaseStoreContext, type AccountResult, type Action, type Notice, type State, type BaseStoreValue } from './context';
import { reducer } from './reducer';

export const serverStoreEnabled = import.meta.env.VITE_STORE === 'server';

const POLL_MS = 6000;
const SAVE_DELAY_MS = 400;

const EMPTY: State = { agents: [], users: [], escalations: [], clearedEscalations: [], audit: [], apps: APPS, states: STATE_DEFS, currentAgentId: null, customerSource: 'imported' };

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, body?: unknown, keepalive = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach Command Center. Check the internet connection.');
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status}).`);
  return json;
}

type Kind = 'agents' | 'users' | 'escalations';
interface DataResponse {
  cursor: string;
  me: AgentAccount;
  agents: AgentAccount[];
  customers: CustomerUser[];
  escalations: EscalationRecord[];
  audit: AuditEntry[];
  cleared?: State['clearedEscalations'];
  notices?: Notice[];
  visibility?: { changeLog: boolean };
}

/** Items the reducer replaced or added (it never mutates, so a changed item is a new object). */
function changedItems<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (prev === next) return [];
  const before = new Map(prev.map((x) => [x.id, x]));
  return next.filter((x) => before.get(x.id) !== x);
}

/** Folds other people's changes in, except for items this browser has changed and not yet saved. */
function mergeIn<T extends { id: string }>(cur: T[], incoming: T[], unsaved: Map<string, unknown>): T[] {
  const fresh = incoming.filter((x) => !unsaved.has(x.id));
  if (!fresh.length) return cur;
  const byId = new Map(fresh.map((x) => [x.id, x]));
  const out = cur.map((x) => byId.get(x.id) ?? x);
  const known = new Set(cur.map((x) => x.id));
  for (const x of fresh) if (!known.has(x.id)) out.push(x);
  return out;
}

/** Tells the super admin about a problem in this browser. Best effort; never throws. */
export function report(level: 'warn' | 'error', message: string, detail?: unknown) {
  void fetch('/api/events', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ level, message: message.slice(0, 500), detail: { page: location.hash, ...((detail as object) ?? {}) } }) }).catch(() => {});
}

const byNewest = <T extends { raisedTs?: number; ts?: number }>(a: T, b: T) => (b.raisedTs ?? b.ts ?? 0) - (a.raisedTs ?? a.ts ?? 0);

export function ServerStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const stateRef = useRef<State>(EMPTY);
  const [ready, setReady] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [codeRequired, setCodeRequired] = useState(false);
  const [setupAllowed, setSetupAllowed] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [visibility, setVisibility] = useState({ changeLog: true });
  const cursor = useRef<string | null>(null);
  const unsaved = useRef<Record<Kind, Map<string, unknown>>>({ agents: new Map(), users: new Map(), escalations: new Map() });
  const unsavedAudit = useRef<AuditEntry[]>([]);
  const unsavedCleared = useRef<State['clearedEscalations'] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);

  const commit = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const signedOut = useCallback(() => {
    cursor.current = null;
    unsaved.current = { agents: new Map(), users: new Map(), escalations: new Map() };
    unsavedAudit.current = [];
    unsavedCleared.current = null;
    setPendingCount(0);
    setNotices([]);
    commit(EMPTY);
  }, [commit]);

  const countPending = () => unsaved.current.agents.size + unsaved.current.users.size + unsaved.current.escalations.size + unsavedAudit.current.length + (unsavedCleared.current ? 1 : 0);

  const takeBatch = () => ({
    agents: [...unsaved.current.agents.values()],
    customers: [...unsaved.current.users.values()],
    escalations: [...unsaved.current.escalations.values()],
    audit: [...unsavedAudit.current],
    ...(unsavedCleared.current ? { cleared: unsavedCleared.current } : {}),
  });

  /** Asks the server to hand customers out now (set once `pull` exists). Fills an agent's list the moment they have room. */
  const refill = useRef<() => void>(() => {});

  const save = useCallback(async () => {
    if (saving.current || !countPending()) return;
    saving.current = true;
    const batch = takeBatch();
    try {
      await api('/api/data', batch);
      // Forget what was sent, unless it changed again while saving.
      for (const [kind, sent] of [['agents', batch.agents], ['users', batch.customers], ['escalations', batch.escalations]] as const) {
        for (const item of sent as { id: string }[]) if (unsaved.current[kind].get(item.id) === item) unsaved.current[kind].delete(item.id);
      }
      unsavedAudit.current = unsavedAudit.current.filter((e) => !batch.audit.includes(e));
      if (batch.customers.length) refill.current();
      if (unsavedCleared.current === batch.cleared) unsavedCleared.current = null;
      setSyncError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        signedOut();
      } else {
        setSyncError(e instanceof Error ? e.message : 'Could not save.');
        report('warn', `Save failed: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          // The server refused this change (no permission, a username taken): drop it rather than retry forever,
          // and reload so the screen shows what was actually saved.
          unsaved.current = { agents: new Map(), users: new Map(), escalations: new Map() };
          unsavedAudit.current = [];
          unsavedCleared.current = null;
          cursor.current = null;
        }
      }
    } finally {
      saving.current = false;
      setPendingCount(countPending());
      if (countPending()) saveTimer.current = setTimeout(() => void save(), 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut]);

  const scheduleSave = useCallback(() => {
    setPendingCount(countPending());
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  /** Everything (no cursor) or just what changed since the last fetch. */
  const pull = useCallback(async () => {
    let data: DataResponse;
    try {
      data = await api<DataResponse>(`/api/data${cursor.current ? `?since=${encodeURIComponent(cursor.current)}` : ''}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signedOut();
      return;
    }
    if (data.visibility) setVisibility((v) => (v.changeLog === data.visibility!.changeLog ? v : data.visibility!));
    setNotices((cur) => (JSON.stringify(cur) === JSON.stringify(data.notices ?? []) ? cur : (data.notices ?? [])));
    const s = stateRef.current;
    const full = !cursor.current;
    cursor.current = data.cursor;
    const u = unsaved.current;
    const audit = full ? data.audit : data.audit.filter((e) => !s.audit.some((x) => x.id === e.id));
    commit({
      ...s,
      currentAgentId: data.me.id,
      agents: full ? data.agents : mergeIn(s.agents, data.agents, u.agents),
      users: full ? data.customers : mergeIn(s.users, data.customers, u.users),
      escalations: (full ? data.escalations : mergeIn(s.escalations, data.escalations, u.escalations)).slice().sort(byNewest),
      audit: audit.length || full ? [...audit, ...(full ? [] : s.audit)].sort(byNewest).slice(0, 2000) : s.audit,
      clearedEscalations: data.cleared && !unsavedCleared.current ? data.cleared : full ? [] : s.clearedEscalations,
    });
  }, [commit, signedOut]);

  refill.current = () => {
    void api('/api/assignments/run', {})
      .then(() => pull())
      .catch(() => {});
  };

  // Who is signed in (a session cookie survives reloads), and whether anyone exists yet.
  useEffect(() => {
    let live = true;
    api<{ setupNeeded: boolean; setupAllowed?: boolean; setupCodeRequired: boolean; agent: AgentAccount | null }>('/api/auth/me')
      .then(async (r) => {
        if (!live) return;
        setSetupNeeded(r.setupNeeded);
        setCodeRequired(r.setupCodeRequired);
        setSetupAllowed(!!r.setupAllowed);
        if (r.agent) {
          await pull();
          refill.current();
        }
      })
      .catch((e: Error) => setSyncError(e.message))
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [pull]);

  // Other people's changes, every few seconds while this tab is open and visible.
  useEffect(() => {
    if (!state.currentAgentId) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, POLL_MS);
    const onShow = () => document.visibilityState === 'visible' && void pull();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [state.currentAgentId, pull]);

  // Crashes in this browser reach the super admin's event log (only while signed in).
  useEffect(() => {
    if (!state.currentAgentId) return;
    const seen = new Set<string>();
    const once = (msg: string, detail?: unknown) => {
      if (seen.has(msg) || seen.size > 20) return;
      seen.add(msg);
      report('error', msg, detail);
    };
    const onError = (e: ErrorEvent) => once(`Browser error: ${e.message}`, { at: `${e.filename}:${e.lineno}` });
    const onRejection = (e: PromiseRejectionEvent) => once(`Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [state.currentAgentId]);

  // Closing the tab with something unsaved: send it on the way out.
  useEffect(() => {
    const onHide = () => {
      if (countPending()) void api('/api/data', takeBatch(), true).catch(() => {});
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      if (action.type === 'LOGOUT') {
        void api('/api/auth/logout', {}).finally(signedOut);
        return;
      }
      if (action.type === 'LOGIN' || action.type === 'RESET') return; // sign-in goes through signInWithPassword; there is no sample data
      const prev = stateRef.current;
      const next = reducer(prev, action);
      if (next === prev) return;
      commit(next);
      for (const a of changedItems(prev.agents, next.agents)) unsaved.current.agents.set(a.id, a);
      for (const c of changedItems(prev.users, next.users)) unsaved.current.users.set(c.id, c);
      for (const e of changedItems(prev.escalations, next.escalations)) unsaved.current.escalations.set(e.id, e);
      if (next.audit !== prev.audit) {
        const had = new Set(prev.audit.map((e) => e.id));
        unsavedAudit.current.push(...next.audit.filter((e) => !had.has(e.id)));
      }
      if (next.clearedEscalations !== prev.clearedEscalations) unsavedCleared.current = next.clearedEscalations;
      scheduleSave();
    },
    [commit, scheduleSave, signedOut],
  );

  const result = async (fn: () => Promise<void>): Promise<AccountResult> => {
    try {
      await fn();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Something went wrong.' };
    }
  };

  const signInWithPassword = useCallback(
    (username: string, password: string, product?: AppId) =>
      result(async () => {
        await api('/api/auth/login', { username, password, ...(product ? { app: product } : {}) });
        cursor.current = null;
        await pull();
      }),
    [pull],
  );

  const runSetup = useCallback(
    (p: { name: string; username: string; password: string; code?: string }) =>
      result(async () => {
        await api('/api/auth/setup', { ...p, apps: APPS.map((a) => a.id) });
        setSetupNeeded(false);
        cursor.current = null;
        await pull();
      }),
    [pull],
  );

  const createAgent = useCallback(
    (agent: AgentAccount, _actorId: string, password?: string) =>
      result(async () => {
        if (!password) throw new Error('Set a password for them.');
        const r = await api<{ agent: AgentAccount; audit: AuditEntry }>('/api/people', { agent, password });
        const s = stateRef.current;
        commit({ ...s, agents: [...s.agents.filter((a) => a.id !== r.agent.id), r.agent], audit: [r.audit, ...s.audit] });
      }),
    [commit],
  );

  const setPassword = useCallback(
    (agentId: string, password: string) =>
      result(async () => {
        const r = await api<{ audit: AuditEntry }>(`/api/people/${encodeURIComponent(agentId)}/password`, { password });
        const s = stateRef.current;
        commit({ ...s, audit: [r.audit, ...s.audit] });
      }),
    [commit],
  );

  const changeMyPassword = useCallback(
    (password: string) =>
      result(async () => {
        const me = stateRef.current.currentAgentId;
        if (!me) throw new Error('Sign in first.');
        await api(`/api/people/${encodeURIComponent(me)}/password`, { password });
        setNotices((n) => n.filter((x) => x.kind !== 'password_change'));
      }),
    [],
  );

  const requestPasswordChange = useCallback(
    (agentId?: string, note?: string) =>
      result(async () => {
        const r = await api<{ audit: AuditEntry }>('/api/password-requests', { agentId, note });
        const s = stateRef.current;
        commit({ ...s, audit: [r.audit, ...s.audit] });
      }),
    [commit],
  );

  const grantPasswordChange = useCallback(
    (agentId: string, note?: string) =>
      result(async () => {
        const r = await api<{ audit: AuditEntry }>('/api/notices', { agentId, kind: 'password_change', note });
        const s = stateRef.current;
        commit({ ...s, audit: [r.audit, ...s.audit] });
        void pull();
      }),
    [commit, pull],
  );

  const dismissNotice = useCallback(async (id: string) => {
    setNotices((n) => n.filter((x) => x.id !== id));
    await api(`/api/notices/${encodeURIComponent(id)}/done`, {}).catch(() => {});
  }, []);

  const currentAgent = useMemo(() => state.agents.find((a) => a.id === state.currentAgentId) ?? null, [state.agents, state.currentAgentId]);

  const value = useMemo<BaseStoreValue>(
    () => ({
      state,
      dispatch,
      currentAgent,
      ready,
      backend: 'server',
      signInWithPassword,
      createAgent,
      setPassword,
      setup: { needed: setupNeeded, allowed: setupAllowed, codeRequired, run: runSetup },
      sync: { pending: pendingCount, error: syncError },
      notices,
      visibility,
      dismissNotice,
      changeMyPassword,
      requestPasswordChange,
      grantPasswordChange,
    }),
    [state, dispatch, currentAgent, ready, signInWithPassword, createAgent, setPassword, setupNeeded, setupAllowed, codeRequired, runSetup, pendingCount, syncError, notices, visibility, dismissNotice, changeMyPassword, requestPasswordChange, grantPasswordChange],
  );

  return <BaseStoreContext.Provider value={value}>{children}</BaseStoreContext.Provider>;
}
