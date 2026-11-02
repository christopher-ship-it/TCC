import { createContext, useContext, type Dispatch } from 'react';
import type { Seed } from '../data/seed';
import type { AgentAccount, AuditAction, AuditEntry, CallAnalysis, CallLogEntry, CallStatus, CallTelephony, CustomerUser, AppId, EscalationRecord, Language, Lead, Outcome, Priority, Rating } from '../data/types';

export interface State {
  agents: AgentAccount[];
  users: CustomerUser[];
  escalations: EscalationRecord[];
  clearedEscalations: Seed['clearedEscalations'];
  audit: AuditEntry[];
  apps: Seed['apps'];
  states: Seed['states'];
  currentAgentId: string | null;
  /** 'imported' once an admin has loaded real customers (People/admin › Customers); 'sample' is the generated set. */
  customerSource: 'sample' | 'imported';
}

export type Action =
  | { type: 'LOGIN'; agentId: string }
  | { type: 'LOGOUT' }
  | { type: 'LOG_CALL'; userId: string; status: CallStatus; outcome?: Outcome; comment: string; agentId: string; telephony?: CallTelephony; analysis?: CallAnalysis; source?: string; followUpTs?: number; lead?: Lead; rating?: Rating; priority?: Priority; analysisFeedback?: CallLogEntry['analysisFeedback'] }
  /** Remembers the agent's verdict on the AI's reading of one call, on the call itself. */
  | { type: 'SET_ANALYSIS_FEEDBACK'; userId: string; entryId: string; feedback: NonNullable<CallLogEntry['analysisFeedback']> }
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
  | { type: 'SET_CUSTOMER_TYPE'; userId: string; customerType: string }
  /** Marks a customer positive or negative by hand (customer page); `null` clears it. */
  | { type: 'SET_LEAD'; userId: string; lead: Lead | null }
  /** Sets how urgently a follow-up should be called (follow-up lists, customer page); `null` clears it. */
  | { type: 'SET_PRIORITY'; userId: string; priority: Priority | null }
  | { type: 'AUTO_DISTRIBUTE'; actorId: string }
  | { type: 'LOG_EXPORT'; actorId: string; detail: string }
  /** Replaces the fabricated sample customers with a real CSV import, preserving call history etc. for any id already worked. */
  /** A number dialled directly: adds one customer record without touching the rest. No-op if the id already exists. */
  | { type: 'ADD_CUSTOMER'; customer: CustomerUser }
  /** Fills in a customer's details (an agent naming a number that first came in as an unknown caller). */
  | { type: 'UPDATE_CUSTOMER'; userId: string; patch: Partial<Omit<CustomerUser, 'id' | 'callHistory'>> }
  /** Removes a customer from every list. The reason is required and goes in the super admin's log. */
  | { type: 'DELETE_CUSTOMER'; userId: string; actorId: string; reason: string }
  | { type: 'IMPORT_CUSTOMERS'; customers: CustomerUser[]; actorId: string }
  | { type: 'RESET' };

/** Something someone asked this person to do in the app — a card in their inbox. */
export interface Notice {
  id: string;
  /** password_change: the super admin lets you choose a new password. password_request: someone asks the super admin for one (super admin's inbox). */
  kind: 'password_change' | 'password_request' | 'message';
  subjectId?: string;
  subjectName?: string;
  title: string;
  body: string;
  fromName: string;
  ts: number;
}

/** Why an account action did not happen. */
export type AccountResult = { ok: true } | { ok: false; message: string };

/** What the signed-in person gets to see (src/lib/world.ts), plus everyone and every customer for the admin screens that manage the split. */
export interface ScopedState extends State {
  allAgents: AgentAccount[];
  allUsers: CustomerUser[];
}

export interface StoreValue {
  state: ScopedState;
  dispatch: Dispatch<Action>;
  currentAgent: AgentAccount | null;
  ready: boolean;
  backend: 'local' | 'firestore' | 'server';
  /** Firestore (email) and server (username) backends: real per-person sign-in. The local demo store has none. */
  signInWithPassword?: (emailOrUsername: string, password: string, product?: AppId) => Promise<AccountResult>;
  /** The product this session works in (src/lib/product.ts). Null until one is picked on the sign-in page. */
  product: AppId | null;
  /** Picks (or, with null, leaves) the product. A build with one product has it picked already. */
  chooseProduct: (app: AppId | null) => void;
  /** The signed-in person with all their products — `currentAgent` is them inside the chosen product. */
  account: AgentAccount | null;
  sendPasswordReset?: (email: string) => Promise<AccountResult>;
  /** Adds a person. On Firestore this also creates their login and emails them a link to choose a password. */
  createAgent: (agent: AgentAccount, actorId: string, password?: string) => Promise<AccountResult>;
  /** Server backend: an admin (or supervisor, for agents) sets someone's password. */
  setPassword?: (agentId: string, password: string) => Promise<AccountResult>;
  /** Server backend: nobody exists yet, so the sign-in page offers to create the first admin. */
  setup?: { needed: boolean; allowed: boolean; codeRequired: boolean; run: (p: { name: string; username: string; password: string; code?: string }) => Promise<AccountResult> };
  /** Server backend: what the super admin lets client admins and agents see. */
  visibility?: { changeLog: boolean };
  /** Server backend: this person's inbox, and what they can do with it. */
  notices?: Notice[];
  dismissNotice?: (id: string) => Promise<void>;
  changeMyPassword?: (password: string) => Promise<AccountResult>;
  /** Asks the super admin for a new password — for yourself, or (admins) for one of your agents. */
  requestPasswordChange?: (agentId?: string, note?: string) => Promise<AccountResult>;
  /** Super admin: puts a "choose a new password" card in someone's inbox. */
  grantPasswordChange?: (agentId: string, note?: string) => Promise<AccountResult>;
  /** Server backend: changes not yet saved, or the last save failed. */
  sync?: { pending: number; error: string | null };
  /** Firestore backend: signed in, but this login is not linked to an active TCC person. */
  accessProblem?: string | null;
}

/** What a backend provides (src/store/*Provider.tsx); StoreContext.tsx adds the product the session works in. */
export type BaseStoreValue = Omit<StoreValue, 'state' | 'product' | 'chooseProduct' | 'account'> & { state: State };
export const BaseStoreContext = createContext<BaseStoreValue | null>(null);
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
