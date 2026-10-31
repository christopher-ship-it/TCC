// The one place that decides how an action changes TCC's state. The browser-only demo store and the
// server-backed store (ServerStoreProvider) both run it, so a screen behaves the same on either.
import type { CustomerUser, EscalationRecord, Outcome, QueueKey } from '../data/types';
import { NEGATIVE_OUTCOMES, OUTCOME_LIST, overlayFromUser } from '../data/types';
import { customerTypesFor } from '../data/products';
import { isConnected } from '../lib/metrics';
import { NO_ANSWER_ENDED_TAG, planFollowUp, startOfDay } from '../lib/followUps';
import { fmtDay, fmtDayTime } from '../lib/dates';
import { isReachable } from '../lib/queue';
import { attachRecording, withAnalysis } from '../lib/attachRecording';
import { buildCallLogEntry } from '../lib/callLog';
import { recordingUrlFor } from '../lib/telephony';
import { auditEntry, type Action, type State } from './context';

const DAY_MS = 86400000;
const MAX_AUDIT = 2000;

function withAudit(state: State, entry: ReturnType<typeof auditEntry>): State {
  return { ...state, audit: [entry, ...state.audit].slice(0, MAX_AUDIT) };
}

/** What a call's outcome does to the customer: which queue they land in, whether they convert or exit. */
function applyOutcome(next: CustomerUser, outcome: Outcome, now: number): CustomerUser {
  if (NEGATIVE_OUTCOMES.includes(outcome)) {
    return { ...next, queue: null, stageTag: 'Exited — negative', followUp: undefined, callback: undefined, priority: null };
  }
  if (outcome === 'Ready to subscribe') {
    return { ...next, queue: null, paying: true, plan: 'Paid', stageTag: 'Converted', followUp: undefined, callback: undefined, priority: null, mrr: next.mrr ?? 999 };
  }
  if (outcome === 'Payment issue') {
    return { ...next, queue: 'payments', stageTag: 'Overdue', paymentDue: next.paymentDue ?? { amount: 999, dueLabel: fmtDay(now - DAY_MS), status: 'overdue' } };
  }
  if (outcome === 'Technical issue') return { ...next, queue: 'errors', stageTag: 'Technical issue' };
  const prevWeek = next.followUp?.weekNumber ?? 0;
  return {
    ...next,
    queue: 'followup',
    stageTag: 'Hot lead',
    followUp: { weekNumber: prevWeek + 1, nextDueLabel: fmtDay(now + 7 * DAY_MS), nextDueTs: startOfDay(now + 7 * DAY_MS), markedPositiveLabel: fmtDay(now), state: 'pending' },
  };
}

/** Every change to the shared state. Pure: the local, Firestore-less and server-backed stores all run it. */
export function reducer(state: State, action: Action): State {
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

        // When to call again: the agent's date, else the automatic daily calls (first try unanswered, 14 days).
        const plan = planFollowUp({ answered: isConnected(entry), hadAnswered: u.callHistory.some(isConnected), auto: u.autoFollowUp, manualTs: action.followUpTs, now });
        next.callback = plan.callback;
        next.autoFollowUp = plan.autoFollowUp;
        if (action.source) next.source = action.source;
        if (action.lead) next.lead = action.lead;
        // A rating only means something on a positive call; a negative one wipes it.
        if (action.lead === 'negative') next.rating = null;
        else if (action.rating) next.rating = action.rating;
        if (action.priority) next.priority = action.priority;
        if (plan.callback) callHistory[0] = { ...entry, followUpTs: plan.callback.dueTs };
        if (plan.ended) {
          next.attempt = u.attempt + 1;
          next.queue = null;
          next.stageTag = NO_ANSWER_ENDED_TAG;
          return next;
        }

        if (!action.outcome) {
          // A call they made to us is not one of our attempts at reaching them.
          if (action.telephony?.direction !== 'inbound') next.attempt = u.attempt + 1;
          return next;
        }
        return applyOutcome(next, action.outcome, now);
      });
      return { ...state, users };
    }
    case 'ATTACH_RECORDING': {
      const hit = attachRecording(state.users, action.file, recordingUrlFor(action.file), action.callId, Date.now(), action.entryId);
      if (!hit) return state;
      return { ...state, users: state.users.map((u) => (u.id === hit.userId ? { ...u, callHistory: hit.callHistory } : u)) };
    }
    case 'SET_ANALYSIS': {
      // The call itself decides what the agent used to be asked: who they are (broker or not) and what they said.
      // Nothing the agent already picked is overwritten.
      const users = state.users.map((u) => {
        if (u.id !== action.userId) return u;
        let next: CustomerUser = { ...u, callHistory: withAnalysis(u.callHistory, action.entryId, action.analysis, action.error) };
        const a = action.analysis;
        const entry = u.callHistory.find((e) => e.id === action.entryId);
        if (!a || !entry) return next;
        if (!next.customerType && a.customerType && customerTypesFor(u.app).includes(a.customerType)) next.customerType = a.customerType;
        const outcome = OUTCOME_LIST.find((x) => x.outcome === a.outcome)?.outcome;
        if (outcome && !entry.outcome && isConnected(entry)) {
          next.callHistory = next.callHistory.map((e) => (e.id === entry.id ? { ...e, outcome } : e));
          if (u.callHistory[0]?.id === entry.id) {
            // Logging counted this as a missed try; it was a real conversation.
            if (entry.telephony?.direction !== 'inbound' && next.attempt > 0) next.attempt -= 1;
            next = applyOutcome(next, outcome, Date.now());
          }
        }
        return next;
      });
      return { ...state, users };
    }
    case 'DELETE_CUSTOMER': {
      const user = state.users.find((u) => u.id === action.userId);
      const actor = state.agents.find((a) => a.id === action.actorId);
      if (!user || user.deleted) return state;
      const now = Date.now();
      const deleted = { byId: action.actorId, byName: actor?.name ?? 'Unknown', reason: action.reason.trim(), ts: now, atLabel: fmtDayTime(now) };
      const users = state.users.map((u) => (u.id === action.userId ? { ...u, deleted, queue: null, followUp: undefined, ownerAgentId: null } : u));
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'customer_deleted', user.name, `${user.phone} · ${deleted.reason}`));
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
          return { ...u, language: esc.targetLanguage, ownerAgentId: action.reassignAgentId ?? u.ownerAgentId, ...(action.reassignAgentId ? { handOwnedAt: Date.now() } : {}), hasActiveEscalation: stillPending };
        }
        return { ...u, ownerAgentId: action.reassignAgentId ?? u.ownerAgentId, ...(action.reassignAgentId ? { handOwnedAt: Date.now() } : {}), hasActiveEscalation: stillPending };
      });
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Approved · reassigned', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5 },
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
      const clearedEscalations = [
        { id: `cleared-${Date.now()}`, atLabel: fmtDayTime(Date.now()).split(' · ')[1], name: esc.userName, action: esc.type === 'reroute' ? `Reroute → ${esc.targetLanguage}` : `Escalation → ${esc.reason}`, result: 'Declined · kept with agent', minutes: Math.round((Date.now() - esc.raisedTs) / 60000) || 5 },
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
      return withAudit({ ...state, agents }, auditEntry(state.agents, action.actorId, action.auditAction ?? 'access_changed', target.name, action.detail));
    }
    case 'REASSIGN_OWNER': {
      const user = state.users.find((u) => u.id === action.userId);
      const owner = state.agents.find((a) => a.id === action.agentId);
      const users = state.users.map((u) => (u.id === action.userId ? { ...u, ownerAgentId: action.agentId, handOwnedAt: Date.now() } : u));
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'owner_reassigned', user?.name, `Now owned by ${owner?.name ?? 'nobody'}`));
    }
    case 'SET_CUSTOMER_TYPE':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, customerType: action.customerType } : u)) };
    case 'SET_PRIORITY':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, priority: action.priority } : u)) };
    case 'SET_LEAD':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, lead: action.lead } : u)) };
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
    case 'UPDATE_CUSTOMER':
      return { ...state, users: state.users.map((u) => (u.id === action.userId ? { ...u, ...action.patch } : u)) };
    case 'ADD_CUSTOMER':
      return state.users.some((u) => u.id === action.customer.id) ? state : { ...state, users: [...state.users, action.customer] };
    case 'IMPORT_CUSTOMERS': {
      // Keep whatever an agent has already done (call history, tickets, follow-ups, ownership) for
      // any customer id that reappears in the new file; everything else comes in fresh.
      const existingById = new Map(state.users.map((u) => [u.id, u]));
      const users = action.customers.map((u) => {
        const prev = existingById.get(u.id);
        return prev ? { ...u, ...overlayFromUser(prev) } : u;
      });
      return withAudit(
        { ...state, users, customerSource: 'imported' },
        auditEntry(state.agents, action.actorId, 'customers_imported', undefined, `Imported ${users.length} real customers (CSV)`),
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
      const users = state.users.map((u) => {
        if (u.ownerAgentId || !u.queue) return u;
        const owner = state.agents.find((a) => a.role === 'agent' && (a.status ?? 'active') === 'active' && a.queues.includes(u.queue as QueueKey) && isReachable(a, u));
        return owner ? { ...u, ownerAgentId: owner.id } : u;
      });
      const moved = users.filter((u, i) => u !== state.users[i]).length;
      return withAudit({ ...state, users }, auditEntry(state.agents, action.actorId, 'queues_distributed', undefined, `${moved} unowned customer${moved === 1 ? '' : 's'} given an owner`));
    }
    default:
      return state;
  }
}
