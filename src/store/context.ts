import { createContext, useContext, type Dispatch } from 'react';
import type { Seed } from '../data/seed';
import type { AgentAccount, CallStatus, CustomerUser, EscalationRecord, Language, Outcome, QueueKey } from '../data/types';

export interface State {
  agents: AgentAccount[];
  users: CustomerUser[];
  escalations: EscalationRecord[];
  clearedEscalations: Seed['clearedEscalations'];
  apps: Seed['apps'];
  states: Seed['states'];
  currentAgentId: string | null;
}

export type Action =
  | { type: 'LOGIN'; agentId: string }
  | { type: 'LOGOUT' }
  | { type: 'LOG_CALL'; userId: string; status: CallStatus; outcome?: Outcome; comment: string; agentId: string }
  | { type: 'RAISE_TICKET'; userId: string; subject: string }
  | { type: 'REQUEST_REROUTE'; userId: string; agentId: string; targetLanguage: Language; suggestedOwnerId?: string; note: string }
  | { type: 'REQUEST_ESCALATE'; userId: string; agentId: string; reason: string; urgency: 'normal' | 'urgent'; note: string }
  | { type: 'APPROVE_ESCALATION'; id: string; reassignAgentId?: string; resolutionNote: string }
  | { type: 'DECLINE_ESCALATION'; id: string; resolutionNote: string }
  | { type: 'CREATE_AGENT'; agent: AgentAccount }
  | { type: 'UPDATE_AGENT_QUEUES'; agentId: string; queues: QueueKey[] }
  | { type: 'UPDATE_AGENT_ALLOCATION'; agentId: string; languages: Language[]; states: string[] }
  | { type: 'REASSIGN_OWNER'; userId: string; agentId: string }
  | { type: 'CLOSE_FOLLOWUP'; userId: string; converted: boolean }
  | { type: 'AUTO_DISTRIBUTE' }
  | { type: 'RESET' };

export interface StoreValue {
  state: State;
  dispatch: Dispatch<Action>;
  currentAgent: AgentAccount | null;
  ready: boolean;
  backend: 'local' | 'firestore';
}

export const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
