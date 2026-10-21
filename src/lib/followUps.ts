// Calling people back. An agent can set a date on any call. When the first try ends unanswered (no answer / not
// reachable) and nobody set one, TCC calls again every day for 14 days — until they answer or the 14 days run out.
import type { AgentAccount, CustomerUser } from '../data/types.ts';

export const AUTO_FOLLOWUP_DAYS = 14;
const DAY = 86_400_000;

export const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** A calendar date picked in the call card ("2026-10-24") as the start of that local day. */
export const dayFromInput = (value: string): number | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : undefined;
};

export const inputFromDay = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface FollowUpPlan {
  callback?: CustomerUser['callback'];
  autoFollowUp?: CustomerUser['autoFollowUp'];
  /** The 14 days are used up with no answer: take them out of the queues. */
  ended: boolean;
}

/** What a just-logged call means for the next call: a date the agent chose wins; otherwise the automatic daily chain. */
export function planFollowUp(p: { answered: boolean; hadAnswered: boolean; auto: CustomerUser['autoFollowUp']; manualTs?: number; now: number }): FollowUpPlan {
  const manual = p.manualTs !== undefined ? { dueTs: startOfDay(p.manualTs), auto: false } : undefined;
  // Reached: the automatic calls stop, whatever the agent chose still stands.
  if (p.answered) return { callback: manual, ended: false };

  // Only a customer we have never reached gets the automatic chain.
  if (!p.auto && p.hadAnswered) return { callback: manual, ended: false };
  const chain = { startedTs: p.auto?.startedTs ?? startOfDay(p.now), attempts: (p.auto?.attempts ?? 0) + 1 };
  if (manual) return { callback: manual, autoFollowUp: chain, ended: false };

  const next = startOfDay(p.now) + DAY;
  if (next > chain.startedTs + AUTO_FOLLOWUP_DAYS * DAY) return { ended: true };
  return { callback: { dueTs: next, auto: true }, autoFollowUp: chain, ended: false };
}

/** Where a customer is in the 14 days (1 = the first day), for the customer page. */
export function chainDay(auto: NonNullable<CustomerUser['autoFollowUp']>, now = Date.now()): number {
  return Math.min(AUTO_FOLLOWUP_DAYS + 1, Math.floor((startOfDay(now) - auto.startedTs) / DAY) + 1);
}

export const callbackIsDue = (u: Pick<CustomerUser, 'callback'>, now = Date.now()): boolean => !!u.callback && u.callback.dueTs < startOfDay(now) + DAY;

/** `n` calendar days after the day of `ts`, as the start of that day. */
export function addDays(ts: number, n: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Why someone is on the Follow-ups page: a date an agent chose, the automatic daily calls, or the weekly positive chain. */
export type FollowUpKind = 'agent' | 'auto' | 'weekly';

export interface ScheduledFollowUp {
  user: CustomerUser;
  /** Start of the day they should be called. */
  dueTs: number;
  kind: FollowUpKind;
}

const WEEKLY = new Set(['Interested', 'Very interested', 'Created first listing']);
function weeklyFromHistory(u: CustomerUser): number | undefined {
  const last = u.callHistory.find((c) => c.outcome && WEEKLY.has(c.outcome));
  return last ? addDays(last.atTs, 7) : undefined;
}

/** Everyone with a date to be called again, earliest first. A call-back date wins over the weekly chain. */
export function scheduledFollowUps(users: CustomerUser[]): ScheduledFollowUp[] {
  const out: ScheduledFollowUp[] = [];
  for (const u of users) {
    if (u.deleted) continue;
    if (u.callback) out.push({ user: u, dueTs: startOfDay(u.callback.dueTs), kind: u.callback.auto ? 'auto' : 'agent' });
    else if (u.followUp) {
      // Chains made before the date was stored: a week after the last call that put them in it.
      const due = u.followUp.nextDueTs ?? weeklyFromHistory(u);
      if (due !== undefined) out.push({ user: u, dueTs: startOfDay(due), kind: 'weekly' });
    }
  }
  return out.sort((a, b) => a.dueTs - b.dueTs || a.user.name.localeCompare(b.user.name));
}

export type FollowUpRange = 'overdue' | 'today' | 'tomorrow' | 'week' | 'upcoming' | 'custom';

/** The days a filter covers, as [from, to): start of the first day up to the start of the day after the last. */
export function rangeBounds(range: FollowUpRange, now: number, custom?: { from?: number; to?: number }): { from: number; to: number } {
  const today = startOfDay(now);
  switch (range) {
    case 'overdue':
      return { from: -Infinity, to: today };
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'tomorrow':
      return { from: addDays(today, 1), to: addDays(today, 2) };
    case 'week': {
      // Today up to and including Sunday.
      const day = new Date(today).getDay();
      return { from: today, to: addDays(today, ((7 - day) % 7) + 1) };
    }
    case 'upcoming':
      return { from: today, to: Infinity };
    case 'custom':
      return { from: custom?.from !== undefined ? startOfDay(custom.from) : -Infinity, to: custom?.to !== undefined ? addDays(custom.to, 1) : Infinity };
  }
}

export const inRange = (dueTs: number, r: { from: number; to: number }): boolean => dueTs >= r.from && dueTs < r.to;

/** An agent's own follow-up: a customer they own, or an unowned one they called. */
export const isFollowUpOf = (u: CustomerUser, agent: Pick<AgentAccount, 'id' | 'name'>): boolean =>
  u.ownerAgentId === agent.id || (!u.ownerAgentId && u.callHistory.some((c) => c.agentName === agent.name));
