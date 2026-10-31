// Who gets which customer to call. The server runs this every few seconds (server/assign.ts); it is pure so the rules
// can be tested without a database.
//
// The three lists the team works every day (New installs, No answer, Follow-up) are handed out: each customer goes to
// ONE agent, and an agent holds at most `capacity` open customers at a time, so their list is a short to-do list that
// refills as they finish. The rest (tickets, payments, errors, inactive, not reached) stay a pool agents pick from.
//
//  - A customer only ever goes to an agent who speaks their language, has the product, and has that list.
//  - Only agents who are online get customers.
//  - Agents whose primary language is the customer's come first; then the agent with the fewest open customers, then
//    whoever was given one longest ago, so a batch spreads out round-robin.
//  - Customers nobody online can take wait, unowned. Nothing is ever given to someone who can't speak to them.
//  - A customer handed out but not yet called goes back when their agent goes offline, and so does one whose call-back
//    day has passed with their agent still away, so nobody is stuck waiting for someone who is not there.
import type { AgentAccount, CustomerUser, Language, QueueKey } from '../data/types.ts';
import { primaryLanguageOf } from './languages.ts';
import { startOfDay } from './followUps.ts';
import { queueOf, sortQueue } from './queue.ts';

/** The lists that are handed out, in the order they are served. */
export const ASSIGN_LISTS: QueueKey[] = ['new', 'noanswer', 'followup'];

/** How many open customers an agent holds at once. */
export const DEFAULT_CAPACITY = 5;

const isAgentActive = (a: AgentAccount) => a.role === 'agent' && (a.status ?? 'active') === 'active';

/** Can this agent be given this customer from this list? Language is the hard rule; states play no part. */
export function agentCovers(agent: AgentAccount, user: CustomerUser, list: QueueKey): boolean {
  return isAgentActive(agent) && agent.apps.includes(user.app) && agent.queues.includes(list) && agent.languages.includes(user.language);
}

const isHandedOut = (u: CustomerUser) => !u.manual && !u.adHoc && !u.deleted;

export interface AssignmentPlan {
  /** Customers to give to an agent now. */
  assign: { customerId: string; agentId: string; list: QueueKey }[];
  /** Customers taken back from an agent, so they can be given to someone else. */
  release: { customerId: string; reason: 'agent-gone' | 'agent-offline' }[];
  /** Customers still unowned after this run, by why. */
  waiting: { noAgent: Record<Language, number>; full: number };
}

export function planAssignments(p: { customers: CustomerUser[]; agents: AgentAccount[]; online: ReadonlySet<string>; now: number; capacity?: number }): AssignmentPlan {
  const capacity = p.capacity ?? DEFAULT_CAPACITY;
  const agentById = new Map(p.agents.map((a) => [a.id, a]));
  const plan: AssignmentPlan = { assign: [], release: [], waiting: { noAgent: {} as Record<Language, number>, full: 0 } };

  // Everyone due today on a handed-out list, and who holds them.
  const due = p.customers
    .filter(isHandedOut)
    .map((u) => ({ u, list: queueOf(u, p.now) }))
    .filter((x): x is { u: CustomerUser; list: QueueKey } => x.list !== null && ASSIGN_LISTS.includes(x.list));

  const owner = new Map<string, string | null>();
  for (const { u, list } of due) {
    let ownerId = u.ownerAgentId;
    // Only customers the server handed out are ever taken back; one given by hand (a supervisor) stays where it was put.
    if (ownerId && u.assignedAt !== undefined) {
      const a = agentById.get(ownerId);
      if (!a || !agentCovers(a, u, list)) {
        plan.release.push({ customerId: u.id, reason: 'agent-gone' });
        ownerId = null;
      } else if (!p.online.has(ownerId) && (!u.callHistory.some((c) => c.atTs >= u.assignedAt!) || (u.callback && u.callback.dueTs < startOfDay(p.now)))) {
        plan.release.push({ customerId: u.id, reason: 'agent-offline' });
        ownerId = null;
      }
    }
    owner.set(u.id, ownerId);
  }

  const load = new Map<string, number>();
  for (const a of p.agents) load.set(a.id, 0);
  for (const { u } of due) {
    const o = owner.get(u.id);
    if (o && load.has(o)) load.set(o, load.get(o)! + 1);
  }
  // Whoever was given a customer longest ago goes first when loads are equal.
  const lastGiven = new Map<string, number>();
  for (const u of p.customers) if (u.ownerAgentId && u.assignedAt !== undefined) lastGiven.set(u.ownerAgentId, Math.max(lastGiven.get(u.ownerAgentId) ?? 0, u.assignedAt));

  const onlineAgents = p.agents.filter((a) => isAgentActive(a) && p.online.has(a.id));
  const unowned = due.filter((x) => !owner.get(x.u.id));

  // Serve the lists in order, each in its own order (yesterday's sign-ups first, High priority first …).
  let tick = 0;
  for (const list of ASSIGN_LISTS) {
    const mine = sortQueue(list, unowned.filter((x) => x.list === list).map((x) => x.u), p.now);
    for (const u of mine) {
      const covering = onlineAgents.filter((a) => agentCovers(a, u, list));
      if (!covering.length) {
        plan.waiting.noAgent[u.language] = (plan.waiting.noAgent[u.language] ?? 0) + 1;
        continue;
      }
      const room = covering.filter((a) => (load.get(a.id) ?? 0) < capacity);
      if (!room.length) {
        plan.waiting.full++;
        continue;
      }
      const primary = room.filter((a) => primaryLanguageOf(a) === u.language);
      const pool = primary.length ? primary : room;
      pool.sort((a, b) => (load.get(a.id)! - load.get(b.id)!) || (lastGiven.get(a.id) ?? 0) - (lastGiven.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      const pick = pool[0];
      load.set(pick.id, load.get(pick.id)! + 1);
      lastGiven.set(pick.id, p.now + ++tick); // later in this run than anyone given one earlier
      plan.assign.push({ customerId: u.id, agentId: pick.id, list });
    }
  }
  return plan;
}

/** How many open customers each agent holds on the handed-out lists right now. */
export function openLoad(customers: CustomerUser[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of customers) {
    if (!u.ownerAgentId || !isHandedOut(u)) continue;
    const list = queueOf(u, now);
    if (list && ASSIGN_LISTS.includes(list)) out.set(u.ownerAgentId, (out.get(u.ownerAgentId) ?? 0) + 1);
  }
  return out;
}
