// Calling people back. An agent can set a date on any call. When the first try ends unanswered (no answer / not
// reachable) and nobody set one, TCC calls again every day for 14 days — until they answer or the 14 days run out.
import type { CustomerUser } from '../data/types.ts';

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
