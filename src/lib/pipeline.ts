// What is coming in and where it stands: who signed up today, what is in the call lists, how much of it is already with
// an agent and how much waits (and why). Pure, so the Overview and the tests use the same counting.

import { CUSTOMER_LANGUAGES, primaryLanguageOf } from './languages.ts';
import { ASSIGN_LISTS, agentCovers } from './assignment.ts';
import { queueOf } from './queue.ts';
import { startOfDay } from './followUps.ts';
import type { AgentAccount, CustomerUser, Language, QueueKey } from '../data/types.ts';

/** A sign-up date TCC can trust: the product sent one. Customers without it are counted apart, never as "today". */
export const hasSignUpDate = (u: CustomerUser): boolean => u.registeredAtLabel !== 'Not recorded';

export interface SignUps {
  today: number;
  yesterday: number;
  last7: number;
  /** Customers the product sent without a sign-up date, so they can't be placed in a day. */
  undated: number;
  /** Of those, how many are still at the very first step. */
  undatedNew: number;
}

export function signUps(users: CustomerUser[]): SignUps {
  const out: SignUps = { today: 0, yesterday: 0, last7: 0, undated: 0, undatedNew: 0 };
  for (const u of users) {
    if (u.deleted || u.manual || u.adHoc) continue;
    if (!hasSignUpDate(u)) {
      out.undated++;
      if (u.sync?.stage === 'registered') out.undatedNew++;
      continue;
    }
    if (u.registeredDaysAgo === 0) out.today++;
    if (u.registeredDaysAgo === 1) out.yesterday++;
    if (u.registeredDaysAgo <= 6) out.last7++;
  }
  return out;
}

export interface LanguageRow {
  language: Language;
  signedToday: number;
  /** In a handed-out list right now (New installs, No answer, Follow-up). */
  inQueue: number;
  /** Of those, with an agent. */
  held: number;
  /** Of those, with nobody yet. */
  waiting: number;
  /** Signed-in agents who can take them. */
  onlineAgents: number;
  /** Agents whose first language this is (they get these customers before anyone else). */
  primaryAgents: number;
}

export interface QueueSnapshot {
  /** Customers in each handed-out list, with how many an agent holds. */
  lists: { key: QueueKey; total: number; held: number; waiting: number }[];
  total: number;
  held: number;
  waiting: number;
  byLanguage: LanguageRow[];
  /** Waiting with nobody signed in who speaks their language. */
  noAgentOnline: number;
}

/** Where the three handed-out lists stand right now, overall and language by language. */
export function queueSnapshot(users: CustomerUser[], agents: AgentAccount[], online: ReadonlySet<string>, now: number): QueueSnapshot {
  const rows = new Map<Language, LanguageRow>(
    CUSTOMER_LANGUAGES.map((language) => [language, { language, signedToday: 0, inQueue: 0, held: 0, waiting: 0, onlineAgents: 0, primaryAgents: 0 }]),
  );
  const row = (l: Language) => rows.get(l) ?? rows.set(l, { language: l, signedToday: 0, inQueue: 0, held: 0, waiting: 0, onlineAgents: 0, primaryAgents: 0 }).get(l)!;

  const people = agents.filter((a) => a.role === 'agent' && (a.status ?? 'active') === 'active');
  for (const l of CUSTOMER_LANGUAGES) {
    row(l).onlineAgents = people.filter((a) => online.has(a.id) && a.languages.includes(l)).length;
    row(l).primaryAgents = people.filter((a) => primaryLanguageOf(a) === l).length;
  }

  const lists = ASSIGN_LISTS.map((key) => ({ key, total: 0, held: 0, waiting: 0 }));
  let noAgentOnline = 0;
  for (const u of users) {
    if (u.deleted || u.manual || u.adHoc) continue;
    if (hasSignUpDate(u) && u.registeredDaysAgo === 0) row(u.language).signedToday++;
    const q = queueOf(u, now);
    const list = q ? lists.find((l) => l.key === q) : undefined;
    if (!list || !q) continue;
    list.total++;
    row(u.language).inQueue++;
    if (u.ownerAgentId) {
      list.held++;
      row(u.language).held++;
    } else {
      list.waiting++;
      row(u.language).waiting++;
      if (!people.some((a) => online.has(a.id) && agentCovers(a, u, q))) noAgentOnline++;
    }
  }

  const byLanguage = [...rows.values()].filter((r) => r.signedToday || r.inQueue || r.onlineAgents || r.primaryAgents);
  return {
    lists,
    total: lists.reduce((n, l) => n + l.total, 0),
    held: lists.reduce((n, l) => n + l.held, 0),
    waiting: lists.reduce((n, l) => n + l.waiting, 0),
    byLanguage,
    noAgentOnline,
  };
}

export interface AgentProgress {
  /** Customers the agent holds on the handed-out lists, not yet finished. */
  open: { user: CustomerUser; list: QueueKey; since: number | null; called: boolean }[];
  /** Calls the agent made or took today, newest first. */
  callsToday: { user: CustomerUser; call: CustomerUser['callHistory'][number] }[];
  connectedToday: number;
  /** Customers that arrive on their list as they finish — unowned, in their language, on their lists. */
  lined: number;
  lastCallAt: number | null;
}

/** One agent's day: what they hold, what they have done, and what is lined up for them. */
export function agentProgress(agent: AgentAccount, users: CustomerUser[], now: number): AgentProgress {
  const startToday = startOfDay(now);
  const open: AgentProgress['open'] = [];
  const callsToday: AgentProgress['callsToday'] = [];
  let lined = 0;
  let lastCallAt: number | null = null;
  for (const u of users) {
    if (u.deleted) continue;
    for (const c of u.callHistory) {
      if (c.agentName !== agent.name) continue;
      if (lastCallAt === null || c.atTs > lastCallAt) lastCallAt = c.atTs;
      if (c.atTs >= startToday) callsToday.push({ user: u, call: c });
    }
    const q = queueOf(u, now);
    if (!q || !ASSIGN_LISTS.includes(q)) continue;
    if (u.ownerAgentId === agent.id) {
      const since = u.assignedAt ?? null;
      open.push({ user: u, list: q, since, called: u.callHistory.some((c) => c.atTs >= (since ?? startToday)) });
    } else if (!u.ownerAgentId && !u.manual && !u.adHoc && agentCovers(agent, u, q)) lined++;
  }
  callsToday.sort((a, b) => b.call.atTs - a.call.atTs);
  open.sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  const connectedToday = callsToday.filter((x) => x.call.status.startsWith('Answered') || (x.call.telephony?.durationSec ?? 0) > 0).length;
  return { open, callsToday, connectedToday, lined, lastCallAt };
}

/** Where a customer record came from: the product's own database, or made inside TCC (by hand, by dialling, by import). */
export const originOf = (u: CustomerUser): 'product' | 'tcc' => (u.sync ? 'product' : 'tcc');

/** A name that looks like someone trying the app out rather than a real shop. Only a hint; the page says so. */
export const looksLikeTest = (u: CustomerUser): boolean => /\b(test|testing|demo|dummy|sample)\b/i.test(`${u.name} ${u.business}`);

export type InstallPeriod = 'today' | '7' | 'list';

/** The people behind "signed up today" and "New installs", newest first. */
export function installs(users: CustomerUser[], period: InstallPeriod, now: number): CustomerUser[] {
  const rows = users.filter((u) => {
    if (u.deleted) return false;
    if (period === 'list') return queueOf(u, now) === 'new';
    if (!hasSignUpDate(u)) return false;
    return period === 'today' ? u.registeredDaysAgo === 0 : u.registeredDaysAgo <= 6;
  });
  return rows.sort((a, b) => (b.sync?.registeredTs ?? 0) - (a.sync?.registeredTs ?? 0) || a.registeredDaysAgo - b.registeredDaysAgo);
}
