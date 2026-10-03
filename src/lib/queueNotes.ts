import type { CustomerUser, QueueKey } from '../data/types';
import { inrLabel } from './dates';

/** One short line under a queue's count that says why it matters right now. */
export function queueNote(key: QueueKey, tasks: CustomerUser[]): string {
  if (!tasks.length) return 'Nothing waiting';
  switch (key) {
    case 'new': {
      const oldest = Math.max(...tasks.map((t) => t.registeredDaysAgo));
      return oldest === 0 ? 'All registered today' : `Oldest ${oldest} day${oldest === 1 ? '' : 's'}`;
    }
    case 'tickets': {
      const late = tasks.filter((t) => t.tickets[0]?.slaBreached).length;
      return late ? `${late} past SLA` : 'All within SLA';
    }
    case 'payments':
      return `${inrLabel(tasks.reduce((n, t) => n + (t.paymentDue?.amount ?? 0), 0))} due`;
    case 'followup': {
      const due = tasks.filter((t) => t.followUp?.state !== 'pending').length;
      return due ? `${due} due or overdue` : 'None due today';
    }
    case 'errors':
      return 'Payment or app failures';
    case 'inactive':
      return 'Win-back calls';
  }
}
