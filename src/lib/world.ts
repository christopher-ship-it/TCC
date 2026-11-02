// Two worlds share one database: the real one (real people, real customers) and the demo one (practice accounts,
// generated customers). Nothing may cross between them — a demo account must never be handed a real customer, and a
// real account must never be handed a made-up one. Every rule for that lives here so it is one thing to read and test.
import type { AgentAccount, AuditEntry, CustomerUser, EscalationRecord, Origin } from '../data/types.ts';

export const ORIGIN_LABEL: Record<Origin, string> = {
  app: 'From the app',
  tcc: 'Created in TCC',
  sample: 'Demo data',
};

/** Where a customer record came from. Records saved before `origin` existed are classified by how they were made. */
export function originOf(u: Pick<CustomerUser, 'id' | 'origin' | 'adHoc'>): Origin {
  if (u.origin) return u.origin;
  if (u.adHoc) return 'tcc';
  return u.id.startsWith('cust-') ? 'app' : 'sample';
}

export const isDemoAgent = (a: Pick<AgentAccount, 'demo'> | null | undefined): boolean => !!a?.demo;

/** Demo customers are for demo accounts and for nobody else. */
export const isRealOrigin = (o: Origin): boolean => o !== 'sample';

/** True when this person and this customer belong to the same world. */
export function sameWorld(agent: Pick<AgentAccount, 'demo'> | null | undefined, user: Pick<CustomerUser, 'id' | 'origin' | 'adHoc'>): boolean {
  return isDemoAgent(agent) === (originOf(user) === 'sample');
}

/** The origin a customer made by this person gets: a demo account only ever makes demo customers. */
export function originForNewCustomer(agent: Pick<AgentAccount, 'demo'> | null | undefined): Origin {
  return isDemoAgent(agent) ? 'sample' : 'tcc';
}

export interface Scopable {
  agents: AgentAccount[];
  users: CustomerUser[];
  audit: AuditEntry[];
  escalations: EscalationRecord[];
  clearedEscalations: { demo?: boolean }[];
}

/**
 * What one signed-in person gets to see. Demo accounts see only demo people, customers and history; everyone else sees
 * only the real ones. With nobody signed in (the sign-in screen) nothing is filtered.
 */
export function scopeFor<T extends Scopable>(viewer: Pick<AgentAccount, 'demo'> | null | undefined, all: T): T {
  if (!viewer) return all;
  const demo = isDemoAgent(viewer);
  const users = all.users.filter((u) => sameWorld(viewer, u));
  const ids = new Set(users.map((u) => u.id));
  return {
    ...all,
    agents: all.agents.filter((a) => isDemoAgent(a) === demo),
    users,
    audit: all.audit.filter((e) => !!e.demo === demo),
    escalations: all.escalations.filter((e) => ids.has(e.userId)),
    clearedEscalations: all.clearedEscalations.filter((c) => !!c.demo === demo),
  };
}

/** Real customers that still name a demo account (or nobody who exists) as their owner — they should be released. */
export function realCustomersOwnedByDemo(users: CustomerUser[], agents: AgentAccount[]): CustomerUser[] {
  const demoIds = new Set(agents.filter(isDemoAgent).map((a) => a.id));
  return users.filter((u) => isRealOrigin(originOf(u)) && u.ownerAgentId && demoIds.has(u.ownerAgentId));
}

export interface OriginCounts {
  app: number;
  tcc: number;
  sample: number;
}

/** How many customers came from each place, per app. */
export function countByOrigin(users: CustomerUser[]): Record<string, OriginCounts> {
  const out: Record<string, OriginCounts> = {};
  for (const u of users) {
    const row = (out[u.app] ??= { app: 0, tcc: 0, sample: 0 });
    row[originOf(u)] += 1;
  }
  return out;
}
