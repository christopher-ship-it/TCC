import { createContext, useContext, type Dispatch } from 'react';
import type { Seed } from '../data/seed';
import type { AgentAccount, AuditAction, AuditEntry, CallAnalysis, CallStatus, CallTelephony, CustomerUser, EscalationRecord, Language, Outcome } from '../data/types';

export interface State {
  /** What the signed-in person may see: a demo account sees demo people and customers, everyone else the real ones (src/lib/world.ts). */
  agents: AgentAccount[];
  users: CustomerUser[];
  /** Everyone and every customer in both worlds. Only for admin screens that manage or audit the split (People, Customers). */
  allAgents: AgentAccount[];
  allUsers: CustomerUser[];
  escalations: EscalationRecord[];
  clearedEscalations: Seed['clearedEscalations'];
  audit: AuditEntry[];
  apps: Seed['apps'];
  states: Seed['states'];
  currentAgentId: string | null;
  /** 'imported' once real customers have been loaded (admin › Customers); 'sample' means there are none yet. */
  customerSource: 'sample' | 'imported';
}

/** What a provider keeps and reduces over, before it is scoped to the signed-in person. */
export type RawState = Omit<State, 'allAgents' | 'allUsers'>;

export type Action =
  | { type: 'LOGIN'; agentId: string }
  | { type: 'LOGOUT' }
  | { type: 'LOG_CALL'; userId: string; status: CallStatus; outcome?: Outcome; comment: string; agentId: string; telephony?: CallTelephony; analysis?: CallAnalysis }
  | { type: 'ATTACH_RECORDING'; file: string; callId?: string; entryId?: string }
  | { type: 'SET_ANALYSIS'; userId: string; entryId: string; analysis?: CallAnalysis; error?: string }
  | { type: 'RAISE_TICKET'; userId: string; subject: string }
  | { type: 'REQUEST_REROUTE'; userId: string; agentId: string; targetLanguage: Language; suggestedOwnerId?: string; note: string }
  | { type: 'REQUEST_ESCALATE'; userId: string; agentId: string; reason: string; urgency: 'normal' | 'urgent'; note: string }
  | { type: 'APPROVE_ESCALATION'; id: string; reassignAgentId?: string; resolutionNote: string; actorId: string }
  | { type: 'DECLINE_ESCALATION'; id: string; resolutionNote: string; actorId: string }
  | { type: 'CREATE_AGENT'; agent: AgentAccount; actorId: string }
  /** Any change to a person: role, access, queues, reach, status. `detail` is the human summary for the change log. */
  | { type: 'UPDATE_AGENT'; agentId: string; patch: Partial<Omit<AgentAccount, 'id'>>; actorId: string; detail: string; auditAction?: AuditAction }
  | { type: 'REASSIGN_OWNER'; userId: string; agentId: string; actorId: string }
  | { type: 'CLOSE_FOLLOWUP'; userId: string; converted: boolean }
  | { type: 'MARK_PAID'; userId: string; actorId: string }
  | { type: 'AUTO_DISTRIBUTE'; actorId: string }
  | { type: 'LOG_EXPORT'; actorId: string; detail: string }
  /** A number dialled directly: adds one customer record without touching the rest. No-op if the id already exists. */
  | { type: 'ADD_CUSTOMER'; customer: CustomerUser }
  /** Loads real customers from a CSV import (stamped origin 'app'), keeping call history etc. for any id already worked. Demo customers are untouched. */
  | { type: 'IMPORT_CUSTOMERS'; customers: CustomerUser[]; actorId: string }
  | { type: 'RESET' };

/** Why an account action did not happen. */
export type AccountResult = { ok: true } | { ok: false; message: string };

export interface StoreValue {
  state: State;
  dispatch: Dispatch<Action>;
  currentAgent: AgentAccount | null;
  ready: boolean;
  backend: 'local' | 'firestore';
  /** Firestore backend only: real per-person sign-in. The local demo store has none. */
  signInWithPassword?: (email: string, password: string) => Promise<AccountResult>;
  sendPasswordReset?: (email: string) => Promise<AccountResult>;
  /** Adds a person. On Firestore this also creates their login and emails them a link to choose a password. */
  createAgent: (agent: AgentAccount, actorId: string) => Promise<AccountResult>;
  /** Firestore backend: signed in, but this login is not linked to an active TCC person. */
  accessProblem?: string | null;
}

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

/** One change-log line, attributed to whoever is acting. */
export function auditEntry(agents: AgentAccount[], actorId: string, action: AuditAction, target: string | undefined, detail: string, now = Date.now()): AuditEntry {
  const actor = agents.find((a) => a.id === actorId);
  return { id: `audit-${now}-${Math.random().toString(36).slice(2, 7)}`, ts: now, actorId, actorName: actor?.name ?? 'Unknown', ...(actor?.demo ? { demo: true } : {}), action, target, detail };
}
