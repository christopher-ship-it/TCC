import React, { useEffect, useMemo, useReducer } from 'react';
import { generateSeed } from '../data/seed';
import type { AgentAccount, CustomerUser, EscalationRecord, QueueKey } from '../data/types';
import { NEGATIVE_OUTCOMES, overlayFromUser } from '../data/types';
import { fmtDay, fmtDayTime } from '../lib/dates';
import { isReachable } from '../lib/queue';
import { attachRecording, cleanLegacyCallData, withAnalysis } from '../lib/attachRecording';
import { buildCallLogEntry } from '../lib/callLog';
import { recordingUrlFor } from '../lib/telephony';
import { isRealOrigin, originOf, scopeFor } from '../lib/world';
import { auditEntry, StoreContext, type Action, type RawState } from './context';

const STORAGE_KEY = 'tcc-store-v1';
const DAY_MS = 86400000;

/**
 * Browsers that saved their data before demo accounts existed hold only the generated roster and customers, so all of
 * it is demo: flag it, otherwise the new rules would hide every customer from every account.
 */
function markLegacyAsDemo(s: RawState): RawState {
  if (s.agents.some((a) => a.demo !== undefined)) return s;
  return {
    ...s,
    agents: s.agents.map((a) => ({ ...a, demo: true })),
    audit: s.audit.map((e) => ({ ...e, demo: true })),
    clearedEscalations: s.clearedEscalations.map((c) => ({ ...c, demo: true })),
    users: s.users.map((u) => (u.origin ? u : { ...u, origin: originOf(u) })),
  };
}

function loadInitial(): RawState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RawState;
      if (parsed.users && parsed.agents) return markLegacyAsDemo({ ...parsed, audit: parsed.audit ?? [], users: cleanLegacyCallData(parsed.users), customerSource: parsed.customerSource ?? 'sample' });
    }
  } catch {
    // fall through to fresh seed
  }
  const seed = generateSeed();
  return { ...seed, currentAgentId: null, customerSource: 'sample' };
}

const MAX_AUDIT = 2000;

function withAudit(state: RawState, entry: ReturnType<typeof auditEntry>): RawState {
  return { ...state, audit: [entry, ...state.audit].slice(0, MAX_AUDIT) };
}

function reducer(state: RawState, action: Action): RawState {
  switch (action.type) {
    case 'LOGIN':
      return withAudit({ ...state, currentAgentId: action.agentId }, auditEntry(state.agents, action.agentId, 'signed_in', undefined, 'Signed in'));
    case 'LOGOUT':
      if (!state.currentAgentId) return state;
      return withAudit({ ...state, currentAgentId: null }, auditEntry(state.agents, state.currentAgentId, 'signed_out', undefined, 'Signed out'));
    case 'LOG_CALL': {
      const agent = state.agents.find((a) => a.id === action.agentId);
      const users = state.users.map((u) => {
        if (u.id !== action.userId) return u;
        const now = Date.now();
        const entry = buildCallLogEntry(now, agent?.name ?? 'You', u, action);
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
    case 'ATTACH_RECORDING': {
      const hit = attachRecording(state.users, action.file, recordingUrlFor(action.file), action.callId, Date.now(), action.entryId);
      if (!hit) return state;
      return { ...state, users: state.users.map((u) => (u.id === hit.userId ? { ...u, callHistory: hit.callHistory } : u)) };
    }
    case 'SET_ANALYSIS':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, callHistory: withAnalysis(u.callHistory, action.entryId, action.analysis, action.error) } : u)) };
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
      const demo = !!state.agents.find((a) => a.id === action.actorId)?.demo;
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Approved · reassigned', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5, ...(demo ? { demo } : {}) },
        ...state.clearedEscalations,
      ];
      return withAudit({ ...state, escalations, users, clearedEscalations }, auditEntry(state.agents, action.actorId, 'escalation_approved', esc.userName, `${clearedEscalations[0].action} · ${action.resolutionNote || 'approved'}`));
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
      const demo = !!state.agents.find((a) => a.id === action.actorId)?.demo;
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Declined · kept with agent', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5, ...(demo ? { demo } : {}) },
        ...state.clearedEscalations,
      ];
      return withAudit({ ...state, escalations, users, clearedEscalations }, auditEntry(state.agents, action.actorId, 'escalation_declined', esc.userName, `${clearedEscalations[0].action} · ${action.resolutionNote || 'declined'}`));
    }
    case 'CREATE_AGENT': {
      const a = action.agent;
      const agents = [...state.agents, a];
      return withAudit({ ...state, agents }, auditEntry(agents, action.actorId, 'user_created', a.name, `${a.role}${a.trainee ? ' · trainee' : ''} · ${a.apps.join(', ') || 'no apps'}`));
    }
    case 'UPDATE_AGENT': {
      const target = state.agents.find((a) => a.id === action.agentId);
      if (!target) return state;
      const agents = state.agents.map((a) => (a.id === action.agentId ? { ...a, ...action.patch } : a));
      // Turning someone into a demo account takes the real customers they own back, so they can be served by a real agent.
      const released = action.patch.demo && !target.demo ? state.users.filter((u) => u.ownerAgentId === target.id && isRealOrigin(originOf(u))).length : 0;
      const users = released ? state.users.map((u) => (u.ownerAgentId === target.id && isRealOrigin(originOf(u)) ? { ...u, ownerAgentId: null } : u)) : state.users;
      const detail = released ? `${action.detail} · ${released} real customer${released === 1 ? '' : 's'} released from them` : action.detail;
      return withAudit({ ...state, agents, users }, auditEntry(state.agents, action.actorId, action.auditAction ?? 'access_changed', target.name, detail));
    }
    case 'REASSIGN_OWNER': {
      const user = state.users.find((u) => u.id === action.userId);
      const owner = state.agents.find((a) => a.id === action.agentId);
      const users = state.users.map((u) => (u.id === action.userId ? { ...u, ownerAgentId: action.agentId } : u));
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'owner_reassigned', user?.name, `Now owned by ${owner?.name ?? 'nobody'}`));
    }
    case 'MARK_PAID': {
      const user = state.users.find((u) => u.id === action.userId);
      if (!user) return state;
      const users = state.users.map((u) =>
        u.id === action.userId
          ? { ...u, paymentDue: undefined, paying: true, plan: 'Paid' as const, stageTag: 'Paying', queue: u.queue === 'payments' ? null : u.queue, mrr: u.mrr ?? u.paymentDue?.amount ?? 999 }
          : u,
      );
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'payment_marked_paid', user.name, user.paymentDue ? `₹${user.paymentDue.amount.toLocaleString('en-IN')} due ${user.paymentDue.dueLabel}` : 'Marked as paying'));
    }
    case 'LOG_EXPORT':
      return withAudit(state, auditEntry(state.agents, action.actorId, 'data_exported', undefined, action.detail));
    case 'ADD_CUSTOMER':
      return state.users.some((u) => u.id === action.customer.id) ? state : { ...state, users: [...state.users, action.customer] };
    case 'IMPORT_CUSTOMERS': {
      // Keep whatever an agent has already done (call history, tickets, follow-ups, ownership) for
      // any customer id that reappears in the new file; everything else comes in fresh.
      const existingById = new Map(state.users.map((u) => [u.id, u]));
      const imported = action.customers.map((u) => {
        const prev = existingById.get(u.id);
        const real = { ...u, origin: 'app' as const };
        return prev ? { ...real, ...overlayFromUser(prev) } : real;
      });
      // The demo sandbox (generated customers, numbers dialled by demo accounts) stays; only the real list is replaced.
      const kept = state.users.filter((u) => originOf(u) !== 'app');
      const users = [...imported, ...kept];
      return withAudit(
        { ...state, users, customerSource: 'imported' },
        auditEntry(state.agents, action.actorId, 'customers_imported', undefined, `Imported ${imported.length} real customers (CSV)`),
      );
    }
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
      // isReachable keeps the worlds apart: a demo agent is never made the owner of a real customer, nor a real agent of a demo one.
      const users = state.users.map((u) => {
        if (u.ownerAgentId || !u.queue) return u;
        const owner = state.agents.find((a) => a.role === 'agent' && (a.status ?? 'active') === 'active' && a.queues.includes(u.queue as QueueKey) && isReachable(a, u));
        return owner ? { ...u, ownerAgentId: owner.id } : u;
      });
      const moved = users.filter((u, i) => u !== state.users[i]).length;
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'queues_distributed', undefined, `${moved} unowned customer${moved === 1 ? '' : 's'} given an owner`));
    }
    case 'RESET': {
      localStorage.removeItem(STORAGE_KEY);
      const seed = generateSeed(Date.now());
      return { ...seed, currentAgentId: null, customerSource: 'sample' };
    }
    default:
      return state;
  }
}

// Used when no Firebase project is configured (VITE_FIREBASE_*): everything
// lives in this browser's localStorage. This is what the published single-file
// artifact preview runs on, and it's the zero-setup path for local dev.
export function LocalStoreProvider({ children }: { children: React.ReactNode }) {
  const [raw, dispatch] = useReducer(reducer, undefined, loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  }, [raw]);

  const currentAgent = useMemo(() => raw.agents.find((a) => a.id === raw.currentAgentId) ?? null, [raw.agents, raw.currentAgentId]);
  const state = useMemo(() => ({ ...scopeFor(currentAgent, raw), allAgents: raw.agents, allUsers: raw.users }), [raw, currentAgent]);
  const createAgent = useMemo(
    () => async (agent: AgentAccount, actorId: string) => {
      dispatch({ type: 'CREATE_AGENT', agent, actorId });
      return { ok: true as const };
    },
    [],
  );
  const value = useMemo(() => ({ state, dispatch, currentAgent, ready: true, backend: 'local' as const, createAgent }), [state, currentAgent, createAgent]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
