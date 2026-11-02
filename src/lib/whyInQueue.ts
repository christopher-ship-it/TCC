import type { CustomerUser } from '../data/types';
import { BRAND } from '../brand';
import { chainDay, AUTO_FOLLOWUP_DAYS } from './followUps';
import { queueOf } from './queue';

const days = (n: number) => (n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'} ago`);

/** Why this customer is in front of the agent — the first thing to read before dialling. */
export function whyInQueue(u: CustomerUser): string | null {
  switch (queueOf(u, Date.now()) ?? u.queue) {
    case 'noanswer':
      return u.autoFollowUp ? `Didn’t pick up. Day ${Math.min(chainDay(u.autoFollowUp), AUTO_FOLLOWUP_DAYS)} of ${AUTO_FOLLOWUP_DAYS} of daily calls.` : 'Didn’t pick up. Called again as planned.';
    case 'unreached':
      return `Nobody picked up in ${AUTO_FOLLOWUP_DAYS} days of daily calls. Try again when you have time.`;
    case 'new':
      if (BRAND.fields) return `${BRAND.fields.newVerb} ${days(u.registeredDaysAgo)} and hasn’t ${BRAND.fields.notYet} yet.`;
      return u.listings === 0
        ? `Registered ${u.registeredDaysAgo === 0 ? 'today' : `${u.registeredDaysAgo} day${u.registeredDaysAgo === 1 ? '' : 's'} ago`} and hasn’t added ${u.app === 'realbroks' ? 'a listing' : 'an order'} yet.`
        : `Registered ${u.registeredDaysAgo} day${u.registeredDaysAgo === 1 ? '' : 's'} ago — welcome call and plan walkthrough.`;
    case 'tickets': {
      const t = u.tickets[0];
      return t ? `Open ticket: “${t.subject}” since ${t.raisedAtLabel}${t.slaBreached ? ' — past SLA' : ''}.` : 'Has an open ticket.';
    }
    case 'payments':
      return u.paymentDue ? `₹${u.paymentDue.amount.toLocaleString('en-IN')} ${u.paymentDue.status === 'upcoming' ? `due on ${u.paymentDue.dueLabel}` : `${u.paymentDue.status} since ${u.paymentDue.dueLabel}`}.` : 'Payment follow-up.';
    case 'followup':
      return u.followUp ? `Week ${u.followUp.weekNumber} of the follow-up chain — marked positive on ${u.followUp.markedPositiveLabel}${u.followUp.state === 'overdue' ? `, ${u.followUp.overdueDays} days overdue` : ''}.` : 'Warm lead follow-up.';
    case 'errors':
      if (u.sync?.lastError) return `${u.sync.lastError.message} — call to help them finish.`;
      if (u.sync?.stageLabel && !u.sync.onboardingCompleted) return `Stopped at “${u.sync.stageLabel}” — call to help them finish setting up.`;
      return `${u.stageTag} — call to help them finish.`;
    case 'inactive':
      if (u.sync?.lastActiveTs) return `Hasn’t opened the app for ${Math.floor((Date.now() - u.sync.lastActiveTs) / 86_400_000)} days — win-back call.`;
      if (BRAND.fields) return `${BRAND.fields.inactive} ${u.lastOpenLabel.replace(' ago', '')} ago — call before the chit lapses.`;
      return `Hasn’t opened the app since ${u.lastOpenLabel.replace(' ago', '')} ago — win-back call.`;
    default:
      return null;
  }
}
