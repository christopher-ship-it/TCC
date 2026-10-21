import type { AgentAccount, AppId, CustomerUser, QueueKey } from '../data/types';
import { callbackIsDue, startOfDay } from './followUps';

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

/** A customer with a call-back date waits out of every queue until that day, then shows up under Follow-up. */
function queueOf(u: CustomerUser, now: number): QueueKey | null {
  if (u.deleted) return null;
  if (u.callback) return callbackIsDue(u, now) ? 'followup' : null;
  return u.queue;
}

export function tasksForQueue(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, queueKey: QueueKey, now = Date.now()): CustomerUser[] {
  if (!agent.queues.includes(queueKey)) return [];
  const list = users.filter((u) => (appId ? u.app === appId : agent.apps.includes(u.app)) && queueOf(u, now) === queueKey && isReachable(agent, u));
  return sortQueue(queueKey, list, now);
}

function sortQueue(queueKey: QueueKey, list: CustomerUser[], now: number): CustomerUser[] {
  const arr = list.slice();
  switch (queueKey) {
    case 'followup': {
      const state = (u: CustomerUser) => (u.callback ? (u.callback.dueTs < startOfDay(now) ? 'overdue' : 'due-today') : u.followUp?.state);
      arr.sort((a, b) => rank(state(a)) - rank(state(b)) || (b.followUp?.overdueDays ?? 0) - (a.followUp?.overdueDays ?? 0) || (a.callback?.dueTs ?? 0) - (b.callback?.dueTs ?? 0));
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
  const keys: QueueKey[] = ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'];
  const out = {} as Record<QueueKey, number>;
  for (const k of keys) out[k] = tasksForQueue(agent, users, appId, k).length;
  return out;
}

export function totalOpenTasks(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, includeInactive = false): number {
  const counts = queueCounts(agent, users, appId);
  return (Object.keys(counts) as QueueKey[]).reduce((sum, k) => (k === 'inactive' && !includeInactive ? sum : sum + counts[k]), 0);
}

export function nextTask(agent: AgentAccount, users: CustomerUser[], appId: AppId | null): { queue: QueueKey; user: CustomerUser } | null {
  const order: QueueKey[] = ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'];
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
