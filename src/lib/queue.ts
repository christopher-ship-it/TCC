import type { AgentAccount, AppId, CustomerUser, QueueKey } from '../data/types';

export function isReachable(agent: AgentAccount, user: CustomerUser): boolean {
  if (!agent.apps.includes(user.app)) return false;
  const stateOk = agent.states.includes(user.effectiveState);
  const langOk = user.state === null ? true : agent.languages.includes(user.language);
  return stateOk && langOk;
}

export function visibleQueuesFor(agent: AgentAccount): QueueKey[] {
  return agent.queues;
}

export function tasksForQueue(agent: AgentAccount, users: CustomerUser[], appId: AppId | null, queueKey: QueueKey): CustomerUser[] {
  if (!agent.queues.includes(queueKey)) return [];
  const list = users.filter((u) => (appId ? u.app === appId : agent.apps.includes(u.app)) && u.queue === queueKey && isReachable(agent, u));
  return sortQueue(queueKey, list);
}

function sortQueue(queueKey: QueueKey, list: CustomerUser[]): CustomerUser[] {
  const arr = list.slice();
  switch (queueKey) {
    case 'followup':
      arr.sort((a, b) => rank(a.followUp?.state) - rank(b.followUp?.state) || (b.followUp?.overdueDays ?? 0) - (a.followUp?.overdueDays ?? 0));
      return arr;
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
