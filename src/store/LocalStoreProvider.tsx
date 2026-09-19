import React, { useEffect, useMemo, useReducer } from 'react';
import { generateSeed } from '../data/seed';
import type { CustomerUser, EscalationRecord, QueueKey } from '../data/types';
import { NEGATIVE_OUTCOMES } from '../data/types';
import { fmtDay, fmtDayTime } from '../lib/dates';
import { isReachable } from '../lib/queue';
import { StoreContext, type Action, type State } from './context';

const STORAGE_KEY = 'tcc-store-v1';
const DAY_MS = 86400000;

function loadInitial(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.users && parsed.agents) return parsed;
    }
  } catch {
    // fall through to fresh seed
  }
  const seed = generateSeed();
  return { ...seed, currentAgentId: null };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOGIN':
      return { ...state, currentAgentId: action.agentId };
    case 'LOGOUT':
      return { ...state, currentAgentId: null };
    case 'LOG_CALL': {
      const agent = state.agents.find((a) => a.id === action.agentId);
      const users = state.users.map((u) => {
        if (u.id !== action.userId) return u;
        const now = Date.now();
        const entry = {
          id: `cl-${now}-${Math.random().toString(36).slice(2, 7)}`,
          atTs: now,
          atLabel: fmtDayTime(now),
          agentName: agent?.name ?? 'You',
          status: action.status,
          outcome: action.outcome,
          comment: action.comment,
          telephony: action.telephony,
        };
        const callHistory = [entry, ...u.callHistory];
        const next: CustomerUser = { ...u, callHistory };

        if (!action.outcome) {
          next.attempt = u.attempt + 1;
          return next;
        }
        if (NEGATIVE_OUTCOMES.includes(action.outcome)) {
          next.queue = null;
          next.stageTag = 'Exited — negative';
          next.followUp = undefined;
          return next;
        }
        if (action.outcome === 'Ready to subscribe') {
          next.queue = null;
          next.paying = true;
          next.plan = 'Paid';
          next.stageTag = 'Converted';
          next.followUp = undefined;
          next.mrr = next.mrr ?? 999;
          return next;
        }
        if (action.outcome === 'Payment issue') {
          next.queue = 'payments';
          next.stageTag = 'Overdue';
          next.paymentDue = next.paymentDue ?? { amount: 999, dueLabel: fmtDay(now - DAY_MS), status: 'overdue' };
          return next;
        }
        if (action.outcome === 'Technical issue') {
          next.queue = 'errors';
          next.stageTag = 'Technical issue';
          return next;
        }
        const prevWeek = u.followUp?.weekNumber ?? 0;
        next.queue = 'followup';
        next.stageTag = 'Hot lead';
        next.followUp = {
          weekNumber: prevWeek + 1,
          nextDueLabel: fmtDay(now + 7 * DAY_MS),
          markedPositiveLabel: fmtDay(now),
          state: 'pending',
        };
        return next;
      });
      return { ...state, users };
    }
    case 'RAISE_TICKET': {
      const users = state.users.map((u) => {
        if (u.id !== action.userId) return u;
        const ticket = {
          id: `tk-${Date.now()}`,
          subject: action.subject,
          raisedAtLabel: fmtDay(Date.now()),
          slaBreached: false,
        };
        return { ...u, tickets: [ticket, ...u.tickets], queue: 'tickets' as QueueKey, stageTag: 'Open ticket' };
      });
      return { ...state, users };
    }
    case 'REQUEST_REROUTE': {
      const user = state.users.find((u) => u.id === action.userId);
      if (!user) return state;
      const esc: EscalationRecord = {
        id: `esc-${Date.now()}`,
        type: 'reroute',
        userId: user.id,
        userName: user.name,
        userCity: `${user.city}, ${user.effectiveState}`,
        app: user.app,
        raisedAtLabel: fmtDayTime(Date.now()).split(' · ')[1],
        raisedTs: Date.now(),
        raisedByAgentId: action.agentId,
        reason: action.note,
        targetLanguage: action.targetLanguage,
        suggestedOwnerId: action.suggestedOwnerId,
        note: action.note,
        status: 'pending',
      };
      const users = state.users.map((u) => (u.id === action.userId ? { ...u, hasActiveEscalation: true } : u));
      return { ...state, users, escalations: [esc, ...state.escalations] };
    }
    case 'REQUEST_ESCALATE': {
      const user = state.users.find((u) => u.id === action.userId);
      if (!user) return state;
      const esc: EscalationRecord = {
        id: `esc-${Date.now()}`,
        type: 'escalation',
        userId: user.id,
        userName: user.name,
        userCity: `${user.city}, ${user.effectiveState}`,
        app: user.app,
        raisedAtLabel: fmtDayTime(Date.now()).split(' · ')[1],
        raisedTs: Date.now(),
        raisedByAgentId: action.agentId,
        reason: action.reason,
        urgency: action.urgency,
        note: action.note,
        status: 'pending',
      };
      const users = state.users.map((u) => (u.id === action.userId ? { ...u, hasActiveEscalation: true } : u));
      return { ...state, users, escalations: [esc, ...state.escalations] };
    }
    case 'APPROVE_ESCALATION': {
      const esc = state.escalations.find((e) => e.id === action.id);
      if (!esc) return state;
      const escalations = state.escalations.map((e) => (e.id === action.id ? { ...e, status: 'approved' as const, resolutionNote: action.resolutionNote, resolvedLabel: fmtDayTime(Date.now()) } : e));
      const users = state.users.map((u) => {
        if (u.id !== esc.userId) return u;
        const stillPending = escalations.some((e) => e.userId === u.id && e.status === 'pending');
        if (esc.type === 'reroute' && esc.targetLanguage) {
          return { ...u, language: esc.targetLanguage, ownerAgentId: action.reassignAgentId ?? u.ownerAgentId, hasActiveEscalation: stillPending };
        }
        return { ...u, ownerAgentId: action.reassignAgentId ?? u.ownerAgentId, hasActiveEscalation: stillPending };
      });
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Approved · reassigned', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5 },
        ...state.clearedEscalations,
      ];
      return { ...state, escalations, users, clearedEscalations };
    }
    case 'DECLINE_ESCALATION': {
      const esc = state.escalations.find((e) => e.id === action.id);
      if (!esc) return state;
      const escalations = state.escalations.map((e) => (e.id === action.id ? { ...e, status: 'declined' as const, resolutionNote: action.resolutionNote, resolvedLabel: fmtDayTime(Date.now()) } : e));
      const users = state.users.map((u) => {
        if (u.id !== esc.userId) return u;
        const stillPending = escalations.some((e) => e.userId === u.id && e.status === 'pending');
        return { ...u, hasActiveEscalation: stillPending };
      });
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Declined · kept with agent', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5 },
        ...state.clearedEscalations,
      ];
      return { ...state, escalations, users, clearedEscalations };
    }
    case 'CREATE_AGENT':
      return { ...state, agents: [...state.agents, action.agent] };
    case 'UPDATE_AGENT_QUEUES':
      return { ...state, agents: state.agents.map((a) => (a.id === action.agentId ? { ...a, queues: action.queues } : a)) };
    case 'UPDATE_AGENT_ALLOCATION':
      return { ...state, agents: state.agents.map((a) => (a.id === action.agentId ? { ...a, languages: action.languages, states: action.states } : a)) };
    case 'REASSIGN_OWNER':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, ownerAgentId: action.agentId } : u)) };
    case 'CLOSE_FOLLOWUP':
      return {
        ...state,
        users: state.users.map((u) => (u.id === action.userId ? {
          ...u,
          queue: null,
          followUp: undefined,
          stageTag: action.converted ? 'Converted' : 'Exited — negative',
          paying: action.converted ? true : u.paying,
          plan: action.converted ? 'Paid' : u.plan,
          mrr: action.converted ? (u.mrr ?? 999) : u.mrr,
        } : u)),
      };
    case 'AUTO_DISTRIBUTE': {
      const users = state.users.map((u) => {
        if (u.ownerAgentId || !u.queue) return u;
        const owner = state.agents.find((a) => a.role === 'agent' && a.queues.includes(u.queue as QueueKey) && isReachable(a, u));
        return owner ? { ...u, ownerAgentId: owner.id } : u;
      });
      return { ...state, users };
    }
    case 'RESET': {
      localStorage.removeItem(STORAGE_KEY);
      const seed = generateSeed(Date.now());
      return { ...seed, currentAgentId: null };
    }
    default:
      return state;
  }
}

// Used when no Firebase project is configured (VITE_FIREBASE_*): everything
// lives in this browser's localStorage. This is what the published single-file
// artifact preview runs on, and it's the zero-setup path for local dev.
export function LocalStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentAgent = useMemo(() => state.agents.find((a) => a.id === state.currentAgentId) ?? null, [state.agents, state.currentAgentId]);
  const value = useMemo(() => ({ state, dispatch, currentAgent, ready: true, backend: 'local' as const }), [state, currentAgent]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
