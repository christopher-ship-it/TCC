// Who may do what. A person's scope is: their role, the apps they're in, what they may do in each app
// (capabilities), and — for calling — which queues, languages and states they work.

import type { AgentAccount, AppId, Capability, Language, QueueKey, Role } from '../data/types';

export const ALL_APPS: AppId[] = ['realbroks', 'irondrobe', 'influnet', 'vehigo', 'vanmoh'];

export const CAPABILITIES: { key: Capability; label: string; short: string; help: string }[] = [
  { key: 'call', label: 'Call customers', short: 'Call', help: 'Work their queues and call from the browser.' },
  { key: 'tickets', label: 'Raise tickets', short: 'Tickets', help: 'Tickets go to the same app’s Tickets & flags queue.' },
  { key: 'recordings', label: 'Hear recordings', short: 'Recordings', help: 'Play call recordings and read transcripts and analysis.' },
  { key: 'payments', label: 'Handle payments', short: 'Payments', help: 'Mark dues as paid.' },
  { key: 'export', label: 'Export lists', short: 'Export', help: 'Download call and customer lists. Every export is logged.' },
];

export const ROLE_INFO: Record<Role, { label: string; help: string }> = {
  agent: { label: 'Agent', help: 'Calls customers in the queues they are given.' },
  supervisor: { label: 'Supervisor', help: 'Runs a team: performance, call audits, access for agents, escalations.' },
  admin: { label: 'Admin', help: 'Everything, across every app — people, access, numbers and the change log.' },
};

const DEFAULT_CAPS: Record<Role, Capability[]> = {
  agent: ['call', 'tickets', 'recordings'],
  supervisor: ['call', 'tickets', 'recordings', 'payments', 'export'],
  admin: ['call', 'tickets', 'recordings', 'payments', 'export'],
};

export function isActive(agent: AgentAccount): boolean {
  return (agent.status ?? 'active') === 'active';
}

/** What this person may do in one app. Admins may do everything everywhere. */
export function capsFor(agent: AgentAccount, app: AppId): Capability[] {
  if (agent.role === 'admin') return DEFAULT_CAPS.admin;
  if (!agent.apps.includes(app)) return [];
  return agent.capabilities?.[app] ?? DEFAULT_CAPS[agent.role];
}

export function can(agent: AgentAccount | null | undefined, app: AppId, cap: Capability): boolean {
  return !!agent && isActive(agent) && capsFor(agent, app).includes(cap);
}

/** True when the person may do this in at least one app. */
export function canAnywhere(agent: AgentAccount | null | undefined, cap: Capability): boolean {
  if (!agent) return false;
  return ALL_APPS.some((app) => can(agent, app, cap));
}

/** Supervisors manage agents; admins manage everyone. (The people page stops anyone suspending or demoting themselves.) */
export function canManage(actor: AgentAccount | null | undefined, target?: AgentAccount): boolean {
  if (!actor || !isActive(actor)) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'supervisor') return !target || target.role === 'agent';
  return false;
}

export interface AccessTemplate {
  id: string;
  label: string;
  help: string;
  role: Role;
  queues: QueueKey[];
  caps: Capability[];
  dailyTarget: number;
  trainee?: boolean;
}

export const ACCESS_TEMPLATES: AccessTemplate[] = [
  { id: 'new-agent', label: 'New agent', help: 'New registrations and follow-ups. Calls are reviewed.', role: 'agent', queues: ['new', 'followup'], caps: ['call', 'tickets', 'recordings'], dailyTarget: 30, trainee: true },
  { id: 'follow-up', label: 'Follow-up caller', help: 'Works warm leads through the weekly follow-up chain.', role: 'agent', queues: ['followup', 'inactive'], caps: ['call', 'tickets', 'recordings'], dailyTarget: 50 },
  { id: 'payments', label: 'Payments desk', help: 'Dues, failed payments and drop-offs. Can mark dues paid.', role: 'agent', queues: ['payments', 'errors'], caps: ['call', 'tickets', 'recordings', 'payments'], dailyTarget: 50 },
  { id: 'support', label: 'Support desk', help: 'Tickets and app errors.', role: 'agent', queues: ['tickets', 'errors'], caps: ['call', 'tickets', 'recordings'], dailyTarget: 40 },
  { id: 'supervisor', label: 'Supervisor', help: 'Every queue, team numbers, audits and access for agents.', role: 'supervisor', queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'], caps: DEFAULT_CAPS.supervisor, dailyTarget: 0 },
  { id: 'admin', label: 'Admin', help: 'Full access to every app, person and number.', role: 'admin', queues: [], caps: DEFAULT_CAPS.admin, dailyTarget: 0 },
];

/** Script names for language chips — customers are matched to agents by language first. */
export const LANGUAGE_SCRIPT: Record<Language, string> = {
  Tamil: 'தமிழ்',
  Telugu: 'తెలుగు',
  Kannada: 'ಕನ್ನಡ',
  Malayalam: 'മലയാളം',
  Hindi: 'हिन्दी',
  Bengali: 'বাংলা',
  English: 'English',
};

export const ALL_LANGUAGES: Language[] = ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Hindi', 'Bengali', 'English'];

/** A plain-language sentence list describing a person's scope — shown while it is being edited. */
export function describeScope(a: Pick<AgentAccount, 'role' | 'apps' | 'queues' | 'languages' | 'states' | 'capabilities'>, appName: (id: AppId) => string, queueLabel: (q: QueueKey) => string): { can: string[]; cannot: string[] } {
  if (a.role === 'admin') return { can: ['See and change everything in every app, including people and access'], cannot: [] };
  const can: string[] = [];
  const missing = new Set<Capability>(CAPABILITIES.map((c) => c.key));
  for (const app of a.apps) {
    const caps = a.capabilities?.[app] ?? DEFAULT_CAPS[a.role];
    caps.forEach((c) => missing.delete(c));
    if (caps.includes('call')) {
      const qs = a.queues.map(queueLabel);
      can.push(qs.length ? `Call ${appName(app)} customers in ${listJoin(qs)}` : `Open ${appName(app)} — but no queues are assigned yet`);
    } else {
      can.push(`View ${appName(app)} customers`);
    }
  }
  const extra = CAPABILITIES.filter((c) => c.key !== 'call' && !missing.has(c.key)).map((c) => c.label.toLowerCase());
  if (extra.length) can.push(capitalise(listJoin(extra)));
  if (a.languages.length) can.push(`Speak with customers in ${listJoin(a.languages)}`);
  if (a.states.length) can.push(`Reach customers in ${a.states.length > 3 ? `${a.states.length} states` : listJoin(a.states)}`);
  if (a.role === 'supervisor') can.push('See team numbers, audit calls and change agents’ access');
  const cannot = CAPABILITIES.filter((c) => missing.has(c.key)).map((c) => c.label.toLowerCase());
  return { can, cannot: cannot.length ? [capitalise(listJoin(cannot, 'or'))] : [] };
}

export function listJoin(items: string[], last = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
