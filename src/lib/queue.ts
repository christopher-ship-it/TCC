import { QUEUES, type AgentAccount, type AppId, type CustomerUser, type QueueKey } from '../data/types.ts';
import { NO_ANSWER_ENDED_TAG, callbackIsDue, isConnected, priorityRank, startOfDay } from './followUps.ts';

export function isReachable(agent: AgentAccount, user: CustomerUser): boolean {
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
  const list = users.filter((u) => (appId ? u.app === appId : agent.apps.includes(u.app)) && queueOf(u, now) === queueKey && isReachable(agent, u));
  return sortQueue(queueKey, list, now);
}

/** Yesterday's sign-ups first (the team's first call), then today's, then older ones newest first. */
const newRank = (days: number) => (days === 1 ? 0 : days === 0 ? 1 : days + 1);

function sortQueue(queueKey: QueueKey, list: CustomerUser[], now: number): CustomerUser[] {
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
export function reachableCount(scope: Pick<AgentAccount, 'apps' | 'languages' | 'states'>, users: CustomerUser[]): number {
  let n = 0;
  for (const u of users) {
    if (!u.queue || !scope.apps.includes(u.app) || !scope.states.includes(u.effectiveState)) continue;
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
    out.total++;
    if (!agent.queues.includes(q)) out.lists[q] = (out.lists[q] ?? 0) + 1;
    else if (!agent.states.includes(u.effectiveState)) out.states++;
    else out.languages++;
  }
  return out;
}
