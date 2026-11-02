import { QUEUES, type AgentAccount, type AppId, type CustomerUser, type QueueKey } from '../data/types.ts';
import { sameWorld } from './world.ts';
import { NO_ANSWER_ENDED_TAG, callbackIsDue, isConnected, priorityRank, startOfDay } from './followUps.ts';

/**
 * Whether the three daily lists (New installs, No answer, Follow-up) are handed out by the server, one customer to one
 * agent (src/lib/assignment.ts). On the shared database that is always so; the sample data in a browser has no server
 * to hand them out, so there everyone who reaches a customer sees them.
 */
export const assignmentMode = { on: (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_STORE === 'server' };

/** The lists that are handed out; the same three the server serves (src/lib/assignment.ts). */
const HANDED_OUT: QueueKey[] = ['new', 'noanswer', 'followup'];

/** An agent sees a handed-out list only for customers the server gave to them. Everyone else sees the shared pool. */
const handedOutTo = (agent: AgentAccount, u: CustomerUser, q: QueueKey): boolean =>
  !assignmentMode.on || agent.role !== 'agent' || !HANDED_OUT.includes(q) || u.manual === true || u.adHoc === true || u.ownerAgentId === agent.id;

export function isReachable(agent: Pick<AgentAccount, 'id' | 'apps' | 'languages' | 'states' | 'demo'>, user: CustomerUser): boolean {
  // A demo account is only ever served demo customers, and a real one only real customers — whatever else it covers.
  if (!sameWorld(agent, user)) return false;
  if (!agent.apps.includes(user.app)) return false;
  // A customer added by hand belongs to whoever it was given to, whatever their states; unowned, anyone who speaks
  // the customer's language in that product can take it.
  if (user.manual || user.adHoc) return user.ownerAgentId ? user.ownerAgentId === agent.id : agent.languages.includes(user.language);
  const stateOk = agent.states.includes(user.effectiveState);
  const langOk = user.state === null ? true : agent.languages.includes(user.language);
  return stateOk && langOk;
}

export function visibleQueuesFor(agent: AgentAccount): QueueKey[] {
  return agent.queues;
}

/** 14 days of daily calls ended with nobody picking up, and nobody has reached them since. */
export const isUnreached = (u: CustomerUser): boolean => !u.queue && !u.callback && u.stageTag === NO_ANSWER_ENDED_TAG && !u.callHistory.some(isConnected);

/**
 * Which call list a customer is in right now. A customer with a call-back date waits out of every list until that day,
 * then shows up under "No answer" (the automatic daily calls) or "Follow-up" (a date an agent chose). After the 14
 * days they sit in "Not reached" until someone gets through.
 */
export function queueOf(u: CustomerUser, now: number): QueueKey | null {
  if (u.deleted) return null;
  if (u.callback) return callbackIsDue(u, now) ? (u.callback.auto ? 'noanswer' : 'followup') : null;
  if (isUnreached(u)) return 'unreached';
  return u.queue;
}

export function tasksForQueue(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, queueKey: QueueKey, now = Date.now()): CustomerUser[] {
  if (!agent.queues.includes(queueKey)) return [];
  const list = users.filter((u) => (appId ? u.app === appId : agent.apps.includes(u.app)) && queueOf(u, now) === queueKey && isReachable(agent, u) && handedOutTo(agent, u, queueKey));
  return sortQueue(queueKey, list, now);
}

/** Yesterday's sign-ups first (the team's first call), then today's, then older ones newest first. */
const newRank = (days: number) => (days === 1 ? 0 : days === 0 ? 1 : days + 1);

export function sortQueue(queueKey: QueueKey, list: CustomerUser[], now: number): CustomerUser[] {
  const arr = list.slice();
  const byPriority = (a: CustomerUser, b: CustomerUser) => priorityRank(a.priority) - priorityRank(b.priority);
  switch (queueKey) {
    case 'new':
      arr.sort((a, b) => newRank(a.registeredDaysAgo) - newRank(b.registeredDaysAgo));
      return arr;
    case 'noanswer':
      // High priority first, then the longest waiting, then the ones closest to running out of the 14 days.
      arr.sort((a, b) => byPriority(a, b) || (a.callback?.dueTs ?? 0) - (b.callback?.dueTs ?? 0) || (b.autoFollowUp?.attempts ?? 0) - (a.autoFollowUp?.attempts ?? 0));
      return arr;
    case 'unreached':
      arr.sort((a, b) => byPriority(a, b) || (b.callHistory[0]?.atTs ?? 0) - (a.callHistory[0]?.atTs ?? 0));
      return arr;
    case 'followup': {
      const state = (u: CustomerUser) => (u.callback ? (u.callback.dueTs < startOfDay(now) ? 'overdue' : 'due-today') : u.followUp?.state);
      arr.sort((a, b) => byPriority(a, b) || rank(state(a)) - rank(state(b)) || (b.followUp?.overdueDays ?? 0) - (a.followUp?.overdueDays ?? 0) || (a.callback?.dueTs ?? 0) - (b.callback?.dueTs ?? 0));
      return arr;
    }
    case 'payments':
      arr.sort((a, b) => payRank(a.paymentDue?.status) - payRank(b.paymentDue?.status));
      return arr;
    case 'tickets':
      arr.sort((a, b) => Number(b.tickets[0]?.slaBreached) - Number(a.tickets[0]?.slaBreached));
      return arr;
    default:
      arr.sort((a, b) => b.registeredDaysAgo - a.registeredDaysAgo);
      return arr;
  }
}

function rank(state?: string) {
  if (state === 'overdue') return 0;
  if (state === 'due-today') return 1;
  return 2;
}
function payRank(status?: string) {
  if (status === 'expired') return 0;
  if (status === 'overdue') return 1;
  return 2;
}

export function queueCounts(agent: AgentAccount, users: CustomerUser[], appId: AppId | null): Record<QueueKey, number> {
  const keys: QueueKey[] = QUEUES.map((q) => q.key);
  const out = {} as Record<QueueKey, number>;
  for (const k of keys) out[k] = tasksForQueue(agent, users, appId, k).length;
  return out;
}

export function totalOpenTasks(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, includeInactive = false): number {
  const counts = queueCounts(agent, users, appId);
  return (Object.keys(counts) as QueueKey[]).reduce((sum, k) => ((k === 'inactive' || k === 'unreached') && !includeInactive ? sum : sum + counts[k]), 0);
}

export function nextTask(agent: AgentAccount, users: CustomerUser[], appId: AppId | null): { queue: QueueKey; user: CustomerUser } | null {
  // "Call next" works down the team's order; the 14-day unreached list is for agents to pick from, not served automatically.
  const order: QueueKey[] = ['new', 'noanswer', 'followup', 'tickets', 'payments', 'errors', 'inactive'];
  for (const q of order) {
    const tasks = tasksForQueue(agent, users, appId, q);
    if (tasks.length) return { queue: q, user: tasks[0] };
  }
  return null;
}

/** Customers in queues that someone with this scope could be served (apps × states × languages). */
export function reachableCount(scope: Pick<AgentAccount, 'apps' | 'languages' | 'states' | 'demo'>, users: CustomerUser[]): number {
  let n = 0;
  for (const u of users) {
    if (!u.queue || !sameWorld(scope, u) || !scope.apps.includes(u.app) || !scope.states.includes(u.effectiveState)) continue;
    if (u.state !== null && !scope.languages.includes(u.language)) continue;
    n++;
  }
  return n;
}

/**
 * Customers of one product waiting in a call list that this person can't see, and the first reason why: the list isn't
 * on their account, or the customer's state or language isn't. Shown when their own lists are empty, so "nothing to
 * call" never hides "your account doesn't cover these customers".
 */
export function outOfReach(agent: AgentAccount, users: CustomerUser[], appId: AppId, now = Date.now()): { lists: Partial<Record<QueueKey, number>>; states: number; languages: number; total: number } {
  const out = { lists: {} as Partial<Record<QueueKey, number>>, states: 0, languages: 0, total: 0 };
  if (!agent.apps.includes(appId)) return out;
  for (const u of users) {
    if (u.app !== appId || u.manual || u.adHoc) continue;
    const q = queueOf(u, now);
    if (!q || isReachable(agent, u) && agent.queues.includes(q)) continue;
    // Handed out by the server: with someone else, or waiting for room on this agent's list. Not out of reach.
    if (assignmentMode.on && HANDED_OUT.includes(q) && agent.queues.includes(q) && agent.languages.includes(u.language)) continue;
    out.total++;
    if (!agent.queues.includes(q)) out.lists[q] = (out.lists[q] ?? 0) + 1;
    else if (!agent.states.includes(u.effectiveState)) out.states++;
    else out.languages++;
  }
  return out;
}

/** Customers due on the handed-out lists that nobody holds yet and this agent can be given: they arrive as the agent finishes. */
export function waitingForYou(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, now = Date.now()): number {
  if (!assignmentMode.on || agent.role !== 'agent') return 0;
  let n = 0;
  for (const u of users) {
    if (u.ownerAgentId || u.manual || u.adHoc || (appId ? u.app !== appId : !agent.apps.includes(u.app))) continue;
    const q = queueOf(u, now);
    if (q && HANDED_OUT.includes(q) && agent.apps.includes(u.app) && agent.queues.includes(q) && agent.languages.includes(u.language)) n++;
  }
  return n;
}
