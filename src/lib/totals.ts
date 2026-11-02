// Everything TCC holds, counted: customers, calls, follow-ups, notes, escalations and people, overall and per
// product. The super admin's overview shows these (src/pages/admin/Totals.tsx).

import { QUEUES, type AgentAccount, type AppId, type CallStatus, type CustomerUser, type EscalationRecord, type QueueKey } from '../data/types.ts';
import { isActive } from './access.ts';
import { scheduledFollowUps, startOfDay, type FollowUpKind } from './followUps.ts';

const DAY_MS = 86_400_000;

/** How many notes there are for one product (`app: null` = for every product), by who can read them. */
export interface NoteCount {
  app: string | null;
  audience: string;
  count: number;
}

export interface Totals {
  customers: number;
  /** From the product's own database (the customer sync) vs added in TCC (by hand, by dialling, by import). */
  fromProduct: number;
  addedInTcc: number;
  /** Customers no one has called yet. */
  neverCalled: number;
  calls: number;
  connected: number;
  incoming: number;
  callsToday: number;
  calls7d: number;
  talkSec: number;
  byStatus: Record<CallStatus, number>;
  followUps: number;
  followUpsOverdue: number;
  followUpsToday: number;
  followUpsByKind: Record<FollowUpKind, number>;
  positive: number;
  negative: number;
  escalations: number;
  escalationsWaiting: number;
  escalationsUrgent: number;
  escalationsApproved: number;
  escalationsDeclined: number;
  /** Null when this deployment keeps no notes (notes live on TCC's own server). */
  notes: number | null;
  notesForAgents: number | null;
  agents: number;
  supervisors: number;
  admins: number;
  /** Customers waiting in each call list, most urgent list first; `none` = in no list. */
  byQueue: Record<QueueKey | 'none', number>;
}

const STATUSES: CallStatus[] = ['Answered — DG', 'Answered — DNG', 'Answered — Followup', 'Not Reachable', 'No Answer'];

function empty(): Totals {
  return {
    customers: 0, fromProduct: 0, addedInTcc: 0, neverCalled: 0,
    calls: 0, connected: 0, incoming: 0, callsToday: 0, calls7d: 0, talkSec: 0,
    byStatus: Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<CallStatus, number>,
    followUps: 0, followUpsOverdue: 0, followUpsToday: 0, followUpsByKind: { agent: 0, auto: 0, weekly: 0 },
    positive: 0, negative: 0,
    escalations: 0, escalationsWaiting: 0, escalationsUrgent: 0, escalationsApproved: 0, escalationsDeclined: 0,
    notes: null, notesForAgents: null,
    agents: 0, supervisors: 0, admins: 0,
    byQueue: { ...(Object.fromEntries(QUEUES.map((q) => [q.key, 0])) as Record<QueueKey, number>), none: 0 },
  };
}

const connectedCall = (c: CustomerUser['callHistory'][number]) => c.status.startsWith('Answered') || (c.telephony?.durationSec ?? 0) > 0;

/**
 * Counts for the given products: `overall` across all of them, and one set per product. People are counted in every
 * product on their account (so the per-product rows can add up to more than the overall); Tecstellar's own super
 * admin isn't counted. Notes for every product only count in `overall`.
 */
export function countEverything(
  input: { users: CustomerUser[]; agents: AgentAccount[]; escalations: EscalationRecord[]; notes: NoteCount[] | null },
  apps: AppId[],
  now = Date.now(),
): { overall: Totals; byApp: Record<string, Totals> } {
  const overall = empty();
  const byApp: Record<string, Totals> = Object.fromEntries(apps.map((a) => [a, empty()]));
  const today = startOfDay(now);
  const weekAgo = today - 6 * DAY_MS;
  const inScope = (app: string) => apps.includes(app as AppId);

  const users = input.users.filter((u) => !u.deleted && inScope(u.app));
  for (const u of users) {
    for (const t of [overall, byApp[u.app]]) {
      t.customers++;
      if (u.sync) t.fromProduct++;
      else t.addedInTcc++;
      if (!u.callHistory.length) t.neverCalled++;
      if (u.lead === 'positive') t.positive++;
      if (u.lead === 'negative') t.negative++;
      t.byQueue[u.queue ?? 'none'] = (t.byQueue[u.queue ?? 'none'] ?? 0) + 1;
      for (const c of u.callHistory) {
        t.calls++;
        if (connectedCall(c)) t.connected++;
        if (c.telephony?.direction === 'inbound') t.incoming++;
        if (c.atTs >= today) t.callsToday++;
        if (c.atTs >= weekAgo) t.calls7d++;
        t.talkSec += c.telephony?.durationSec ?? 0;
        if (c.status in t.byStatus) t.byStatus[c.status]++;
      }
    }
  }

  for (const f of scheduledFollowUps(users)) {
    for (const t of [overall, byApp[f.user.app]]) {
      t.followUps++;
      t.followUpsByKind[f.kind]++;
      if (f.dueTs < today) t.followUpsOverdue++;
      else if (f.dueTs === today) t.followUpsToday++;
    }
  }

  for (const e of input.escalations) {
    if (!inScope(e.app)) continue;
    for (const t of [overall, byApp[e.app]]) {
      t.escalations++;
      if (e.status === 'pending') {
        t.escalationsWaiting++;
        if (e.urgency === 'urgent') t.escalationsUrgent++;
      }
      if (e.status === 'approved') t.escalationsApproved++;
      if (e.status === 'declined') t.escalationsDeclined++;
    }
  }

  if (input.notes) {
    for (const t of [overall, ...Object.values(byApp)]) {
      t.notes = 0;
      t.notesForAgents = 0;
    }
    for (const n of input.notes) {
      if (n.app && !inScope(n.app)) continue;
      const targets = n.app ? [overall, byApp[n.app]] : [overall];
      for (const t of targets) {
        t.notes! += n.count;
        if (n.audience === 'agents') t.notesForAgents! += n.count;
      }
    }
  }

  for (const a of input.agents) {
    if (a.superAdmin || !isActive(a)) continue;
    const key = a.role === 'agent' ? 'agents' : a.role === 'supervisor' ? 'supervisors' : 'admins';
    // Admins run every product; everyone else the products on their account.
    const theirs = a.role === 'admin' ? apps : a.apps.filter(inScope);
    if (!theirs.length) continue;
    overall[key]++;
    for (const app of theirs) byApp[app][key]++;
  }

  return { overall, byApp };
}
