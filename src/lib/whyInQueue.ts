import type { CustomerUser } from '../data/types';
import { BRAND } from '../brand';

const days = (n: number) => (n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'} ago`);

/** Why this customer is in front of the agent — the first thing to read before dialling. */
export function whyInQueue(u: CustomerUser): string | null {
  switch (u.queue) {
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
      return `${u.stageTag} — call to help them finish.`;
    case 'inactive':
      if (BRAND.fields) return `${BRAND.fields.inactive} ${u.lastOpenLabel.replace(' ago', '')} ago — call before the chit lapses.`;
      return `Hasn’t opened the app since ${u.lastOpenLabel.replace(' ago', '')} ago — win-back call.`;
    default:
      return null;
  }
}
