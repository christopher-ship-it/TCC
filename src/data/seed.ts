import { Rng } from '../lib/rng';
import { DAY_MS, fmtDay, fmtDayTime } from '../lib/dates';
import type {
  AgentAccount,
  AppDef,
  AppId,
  CallLogEntry,
  CallStatus,
  CustomerUser,
  EscalationRecord,
  Language,
  Outcome,
  QueueKey,
  StateDef,
  TicketRecord,
} from './types';

const NOW = Date.now();

export const APPS: AppDef[] = [
  { id: 'realbroks', name: 'RealBroks', tagline: 'Broker assistant · 10K+ installs', logo: 'logo-realbroks.png', live: true },
  { id: 'irondrobe', name: 'IronDrobe', tagline: 'Laundry & ironing CRM · 1K+ installs', logo: 'logo-irondrobe.png', live: true },
  { id: 'influnet', name: 'Influnet', tagline: 'influnet.io · in development', logo: 'logo-influnet.png', live: false },
  { id: 'vehigo', name: 'Vehigo', tagline: 'In development', logo: 'logo-vehigo.png', live: false },
];

interface StateSeedDef extends StateDef {
  weight: number;
  cities: string[];
}

export const STATE_DEFS: StateSeedDef[] = [
  { name: 'Tamil Nadu', lon: 78.4, lat: 11.0, language: 'Tamil', weight: 5768, cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruppur', 'Salem', 'Erode', 'Trichy', 'Karur', 'Pollachi', 'Vellore'] },
  { name: 'Karnataka', lon: 76.2, lat: 14.6, language: 'Kannada', weight: 1420, cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru'] },
  { name: 'Telangana', lon: 79.0, lat: 17.9, language: 'Telugu', weight: 980, cities: ['Hyderabad', 'Warangal', 'Nizamabad'] },
  { name: 'Andhra Pradesh', lon: 80.2, lat: 15.6, language: 'Telugu', weight: 860, cities: ['Vijayawada', 'Visakhapatnam', 'Guntur'] },
  { name: 'Kerala', lon: 76.4, lat: 10.2, language: 'Malayalam', weight: 720, cities: ['Kochi', 'Thiruvananthapuram', 'Kozhikode'] },
  { name: 'Maharashtra', lon: 75.5, lat: 19.4, language: 'Hindi', weight: 610, cities: ['Mumbai', 'Pune', 'Nagpur'] },
  { name: 'Delhi', lon: 77.1, lat: 28.6, language: 'Hindi', weight: 340, cities: ['New Delhi', 'Dwarka', 'Rohini'] },
  { name: 'Uttar Pradesh', lon: 80.8, lat: 26.9, language: 'Hindi', weight: 290, cities: ['Lucknow', 'Kanpur', 'Noida'] },
  { name: 'Gujarat', lon: 71.8, lat: 22.4, language: 'Hindi', weight: 210, cities: ['Ahmedabad', 'Surat', 'Vadodara'] },
  { name: 'West Bengal', lon: 87.8, lat: 23.5, language: 'Hindi', weight: 120, cities: ['Kolkata', 'Howrah', 'Siliguri'] },
  { name: 'Rajasthan', lon: 74.2, lat: 27.0, language: 'Hindi', weight: 62, cities: ['Jaipur', 'Jodhpur'] },
  { name: 'Madhya Pradesh', lon: 78.5, lat: 23.5, language: 'Hindi', weight: 50, cities: ['Bhopal', 'Indore'] },
];

export const NO_STATE_WEIGHT = 412;

export const AGENTS: AgentAccount[] = [
  {
    id: 'ravi-s', name: 'Ravi S', username: 'ravi.s', role: 'agent',
    apps: ['realbroks'], queues: ['new', 'followup', 'inactive'],
    languages: ['Tamil', 'Telugu', 'Kannada'],
    states: ['Tamil Nadu', 'Telangana', 'Andhra Pradesh', 'Karnataka'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '2 min ago',
    todayCalls: 62, todayConnected: 44, todayPositive: 21, todaySubscribed: 4, todayOverdue: 2, avgHandleLabel: '3m 10s',
    workingQueueLabel: 'New registrations',
  },
  {
    id: 'abhinaya-m', name: 'Abhinaya M', username: 'abhinaya.m', role: 'agent',
    apps: ['realbroks', 'irondrobe'], queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'],
    languages: ['Tamil', 'Hindi'],
    states: ['Tamil Nadu', 'Maharashtra', 'Delhi', 'Uttar Pradesh', 'Gujarat', 'Rajasthan', 'Madhya Pradesh', 'West Bengal'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: 'now · on call',
    todayCalls: 58, todayConnected: 39, todayPositive: 18, todaySubscribed: 3, todayOverdue: 7, avgHandleLabel: '3m 48s',
    workingQueueLabel: 'Positive follow-up',
  },
  {
    id: 'karthick-g', name: 'Karthick G', username: 'karthick.g', role: 'agent',
    apps: ['realbroks'], queues: ['payments', 'errors'],
    languages: ['Tamil'],
    states: ['Tamil Nadu'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '14 min ago',
    todayCalls: 51, todayConnected: 31, todayPositive: 14, todaySubscribed: 2, todayOverdue: 11, avgHandleLabel: '4m 02s',
    workingQueueLabel: 'Payments & dues',
  },
  {
    id: 'divya-p', name: 'Divya P', username: 'divya.p', role: 'agent',
    apps: ['irondrobe'], queues: ['tickets', 'inactive'],
    languages: ['Tamil', 'Malayalam'],
    states: ['Tamil Nadu', 'Kerala'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '1 hr ago',
    todayCalls: 43, todayConnected: 32, todayPositive: 10, todaySubscribed: 1, todayOverdue: 7, avgHandleLabel: '5m 21s',
    workingQueueLabel: 'Tickets & flags',
  },
  {
    id: 'priya-n', name: 'Priya N', username: 'priya.n', role: 'agent', trainee: true,
    apps: ['irondrobe'], queues: ['new'],
    languages: ['Tamil', 'Telugu'],
    states: ['Tamil Nadu'],
    dailyTarget: 30, clickToDial: true, lastActiveLabel: 'Yesterday',
    todayCalls: 19, todayConnected: 12, todayPositive: 4, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '6m 40s',
    workingQueueLabel: 'New registrations',
  },
  {
    id: 'munees-a', name: 'Munees A', username: 'munees.a', role: 'supervisor',
    apps: ['realbroks', 'irondrobe'], queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'],
    languages: ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Hindi', 'Bengali', 'English'],
    states: STATE_DEFS.map((s) => s.name),
    dailyTarget: 0, clickToDial: true, lastActiveLabel: 'now',
    todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—',
    workingQueueLabel: '—',
  },
  {
    id: 'owner-1', name: 'You', username: 'owner', role: 'admin',
    apps: ['realbroks', 'irondrobe', 'influnet', 'vehigo'], queues: [],
    languages: [], states: [],
    dailyTarget: 0, clickToDial: false, lastActiveLabel: 'now',
    todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—',
    workingQueueLabel: '—',
  },
];

const FIRST_NAMES = [
  'Suresh', 'Meena', 'Anand', 'Prakash', 'Vijay', 'Lakshmi', 'Mahesh', 'Sanjay', 'Deepa', 'Kavya',
  'Arjun', 'Sneha', 'Rajesh', 'Pooja', 'Vikram', 'Anitha', 'Naveen', 'Swathi', 'Manoj', 'Bhavya',
  'Ganesh', 'Nithya', 'Ashok', 'Radha', 'Dinesh', 'Kalyani', 'Senthil', 'Malathi', 'Bala', 'Revathi',
  'Gopal', 'Uma', 'Chandran', 'Geetha', 'Murali', 'Vani', 'Ramesh', 'Latha', 'Selvam', 'Padma',
  'Kumar', 'Shanti', 'Raghav', 'Devi', 'Harish', 'Jyothi', 'Kiran', 'Lavanya', 'Mohan', 'Nandini',
  'Om Prakash', 'Priyanka', 'Qadir', 'Ritesh', 'Sowmya', 'Tarun', 'Usha', 'Venkat', 'Yamuna', 'Zubin',
];

const SURNAMES = [
  'Kumar', 'Reddy', 'Rao', 'Nair', 'Iyer', 'Menon', 'Pillai', 'Sharma', 'Gupta', 'Patel',
  'Verma', 'Naidu', 'Chettiar', 'Pandian', 'Subramaniam', 'Krishnan', 'Raman', 'Bose', 'Das', 'Iyengar',
];

const BIZ_TEMPLATES_REALBROKS = (name: string, city: string, r: Rng) =>
  r.pick([
    `${name} Properties`, `${name} Realty`, `${name} Homes`, `${name} Estates`, `${city} Realtors`,
    `${name} Housing Solutions`, `${name} Land & Homes`, `${city} Property Hub`, `${name} Realty Group`,
  ]);

const BIZ_TEMPLATES_IRONDROBE = (name: string, city: string, r: Rng) =>
  r.pick([
    `${name} Fold Laundry`, `${name} Ironing Services`, `Fresh Fold ${city}`, `${name} Dhobi Ghat`,
    `Sparkle ${name} Laundromat`, `${city} Press & Fold`, `${name} Quick Wash`, `${name} Laundry Co.`,
  ]);

const CALL_STATUSES: CallStatus[] = ['Answered — DG', 'Answered — DNG', 'Answered — Followup', 'Not Reachable', 'No Answer'];
const APP_VERSIONS = ['2.21 · Android', '2.19 · Android', '2.21 · iOS', '2.15 · Android', '2.22 · Android'];

function pickState(r: Rng): StateSeedDef | null {
  const total = STATE_DEFS.reduce((s, st) => s + st.weight, 0) + NO_STATE_WEIGHT;
  let roll = r.float() * total;
  for (const st of STATE_DEFS) {
    roll -= st.weight;
    if (roll <= 0) return st;
  }
  return null;
}

function reachableAgent(agents: AgentAccount[], app: AppId, queue: QueueKey | null, effState: string, lang: Language, hasState: boolean): AgentAccount | null {
  const pool = agents.filter((a) => a.role === 'agent' && a.apps.includes(app) && (queue == null || a.queues.includes(queue)));
  const matching = pool.filter((a) => {
    const stateOk = a.states.includes(effState);
    const langOk = hasState ? a.languages.includes(lang) : true; // no-state users are open to any agent holding the default state
    return stateOk && langOk;
  });
  if (matching.length === 0) return null;
  return matching[0];
}

function makeCallHistory(r: Rng, agentNames: string[], attempts: number, finalStatus: CallStatus | null, finalOutcome: Outcome | undefined, finalComment: string): CallLogEntry[] {
  const entries: CallLogEntry[] = [];
  let ts = NOW - attempts * r.int(1, 3) * DAY_MS;
  for (let i = 0; i < attempts - (finalStatus ? 1 : 0); i++) {
    ts += r.int(1, 3) * DAY_MS;
    const status = r.pick<CallStatus>(['No Answer', 'Not Reachable', 'No Answer']);
    entries.push({
      id: `cl-${r.int(1, 1e9)}`,
      atTs: ts,
      atLabel: fmtDayTime(ts),
      agentName: r.pick(agentNames),
      status,
      comment: r.pick(['Rang out twice', 'Switched off', 'Line busy', 'No response']),
      auto: r.bool(0.4),
    });
  }
  if (finalStatus) {
    ts = NOW - r.int(0, 2) * DAY_MS - r.int(0, 12) * 3600000;
    entries.push({
      id: `cl-${r.int(1, 1e9)}`,
      atTs: ts,
      atLabel: fmtDayTime(ts),
      agentName: r.pick(agentNames),
      status: finalStatus,
      outcome: finalOutcome,
      comment: finalComment,
    });
  }
  return entries.sort((a, b) => b.atTs - a.atTs);
}

const COMMENTS_POOL = [
  'Wants to see commission tracking before paying. Asked to call back after 6pm.',
  'Runs 2 branches, interested in the annual plan discount.',
  'Happy with the app so far, just needs a payment reminder next week.',
  'Was confused about the free order limit, explained and they are okay now.',
  'Asked for a demo of the buyer management screen.',
  'Said business is slow this month, will decide after Diwali.',
  'Wants invoice support before subscribing.',
  'Very responsive, likely to convert soon.',
  'Requested a callback in the evening, busy at the shop right now.',
  'Compared pricing with a competitor app, considering both.',
];

function buildUser(opts: {
  r: Rng;
  app: AppId;
  queue: QueueKey | null;
  agents: AgentAccount[];
  idx: number;
}): CustomerUser {
  const { r, app, queue, agents, idx } = opts;
  const stateDef = pickState(r);
  const hasState = !!stateDef;
  const effState = stateDef ? stateDef.name : 'Tamil Nadu';
  const lang: Language = stateDef ? stateDef.language : r.pick<Language>(['Tamil', 'Telugu', 'Hindi', 'Kannada', 'Malayalam']);
  const city = stateDef ? r.pick(stateDef.cities) : r.pick(STATE_DEFS[0].cities);
  const first = r.pick(FIRST_NAMES);
  const last = r.pick(SURNAMES);
  const name = `${first} ${last}`;
  const business = app === 'realbroks' ? BIZ_TEMPLATES_REALBROKS(last, city, r) : BIZ_TEMPLATES_IRONDROBE(last, city, r);
  const registeredDaysAgo = queue === 'inactive' ? r.int(35, 220) : queue === 'new' ? r.int(0, 4) : r.int(1, 260);
  const registeredTs = NOW - registeredDaysAgo * DAY_MS;
  const shopCode = `TS${2026060000 + r.int(1, 999999)}`;
  const phone = `+91 ${r.int(70000, 99999)} ${r.int(10000, 99999)}`;
  const owner = reachableAgent(agents, app, queue, effState, lang, hasState);
  const ownerNames = owner ? [owner.name] : ['Ravi S', 'Abhinaya M'];

  const paying = queue === null ? r.bool(0.18) : queue === 'payments' ? r.bool(0.85) : false;
  const active = queue === 'inactive' ? false : r.bool(0.7);
  const conversionScore = queue === 'followup' ? r.int(55, 92) : queue === 'new' ? r.int(20, 75) : r.int(10, 60);

  let stageTag = 'Registered';
  let attempt = 1;
  let callHistory: CallLogEntry[] = [];
  let tickets: TicketRecord[] = [];
  let paymentDue: CustomerUser['paymentDue'];
  let followUp: CustomerUser['followUp'];
  let planNote: string | undefined;

  const comment = r.pick(COMMENTS_POOL);

  switch (queue) {
    case 'new': {
      attempt = r.int(1, 4);
      stageTag = attempt > 1 ? 'Hot lead' : 'New';
      callHistory = makeCallHistory(r, ownerNames, attempt, r.bool(0.5) ? r.pick(CALL_STATUSES) : null, undefined, comment);
      planNote = `Free · ${r.int(2, 50)} orders left`;
      break;
    }
    case 'tickets': {
      attempt = 1;
      const slaBreached = r.bool(0.3);
      tickets = [{
        id: `tk-${r.int(1, 1e9)}`,
        subject: r.pick(['App crashes on checkout', 'Payment deducted, subscription not active', 'Cannot upload listing photos', 'OTP not received', 'Wrong plan applied', 'Refund not processed']),
        raisedAtLabel: fmtDay(NOW - r.int(0, 6) * DAY_MS),
        slaBreached,
      }];
      stageTag = slaBreached ? 'SLA breach' : 'Open ticket';
      callHistory = makeCallHistory(r, ownerNames, 1, null, undefined, comment);
      break;
    }
    case 'payments': {
      const status = r.weighted([
        { value: 'upcoming' as const, weight: 5 },
        { value: 'overdue' as const, weight: 3 },
        { value: 'expired' as const, weight: 2 },
      ]);
      paymentDue = {
        amount: r.pick([499, 999, 1499, 2499, 4999]),
        dueLabel: fmtDay(NOW + (status === 'upcoming' ? r.int(1, 10) : -r.int(1, 20)) * DAY_MS),
        status,
      };
      stageTag = status === 'expired' ? 'Expired' : status === 'overdue' ? 'Overdue' : 'Due soon';
      callHistory = makeCallHistory(r, ownerNames, r.int(1, 3), null, undefined, comment);
      break;
    }
    case 'followup': {
      const week = r.int(1, 4);
      const dueOffsetDays = r.int(-9, 3);
      const state = dueOffsetDays > 0 ? 'pending' : dueOffsetDays === 0 ? 'due-today' : 'overdue';
      followUp = {
        weekNumber: week,
        nextDueLabel: fmtDay(NOW + dueOffsetDays * DAY_MS),
        markedPositiveLabel: fmtDay(NOW - (week * 7 + r.int(0, 3)) * DAY_MS),
        state,
        overdueDays: state === 'overdue' ? Math.abs(dueOffsetDays) : undefined,
      };
      stageTag = 'Hot lead';
      const finalOutcome = r.pick<Outcome>(['Interested', 'Very interested', 'Ready to subscribe']);
      callHistory = makeCallHistory(r, ownerNames, week + 1, r.pick(CALL_STATUSES), finalOutcome, comment);
      break;
    }
    case 'errors': {
      stageTag = r.pick(['Payment failed', 'Tried to subscribe', 'App crash on pay']);
      callHistory = makeCallHistory(r, ownerNames, 1, null, undefined, comment);
      break;
    }
    case 'inactive': {
      stageTag = 'Inactive 30+';
      callHistory = makeCallHistory(r, ownerNames, r.int(0, 2), null, undefined, comment);
      break;
    }
    default: {
      stageTag = paying ? 'Paying' : active ? 'Active' : 'Dormant';
      break;
    }
  }

  return {
    id: `u-${app}-${idx}`,
    shopCode,
    name,
    business,
    app,
    phone,
    city,
    state: stateDef ? stateDef.name : null,
    effectiveState: effState,
    language: lang,
    registeredAtLabel: fmtDay(registeredTs),
    registeredDaysAgo,
    plan: paying ? 'Paid' : 'Free',
    planNote,
    listings: app === 'realbroks' ? r.int(0, 12) : r.int(0, 40),
    buyers: app === 'realbroks' ? r.int(0, 6) : 0,
    lastOpenLabel: active ? `${r.int(1, 23)}h ago` : `${r.int(31, 90)}d ago`,
    appVersion: r.pick(APP_VERSIONS),
    conversionScore,
    stageTag,
    queue,
    attempt,
    callHistory,
    tickets,
    paymentDue,
    followUp,
    paying,
    active,
    ownerAgentId: owner ? owner.id : null,
    mrr: paying ? r.pick([499, 999, 1499, 2499]) : undefined,
  };
}

interface QueueCounts {
  new: number;
  tickets: number;
  payments: number;
  followup: number;
  errors: number;
  inactive: number;
  rest: number;
}

const REALBROKS_COUNTS: QueueCounts = { new: 40, tickets: 10, payments: 18, followup: 26, errors: 6, inactive: 140, rest: 410 };
const IRONDROBE_COUNTS: QueueCounts = { new: 5, tickets: 3, payments: 4, followup: 3, errors: 0, inactive: 30, rest: 115 };

function buildAppUsers(app: AppId, counts: QueueCounts, agents: AgentAccount[], r: Rng): CustomerUser[] {
  const users: CustomerUser[] = [];
  let idx = 0;
  const plan: [QueueKey | null, number][] = [
    ['new', counts.new],
    ['tickets', counts.tickets],
    ['payments', counts.payments],
    ['followup', counts.followup],
    ['errors', counts.errors],
    ['inactive', counts.inactive],
    [null, counts.rest],
  ];
  for (const [queue, count] of plan) {
    for (let i = 0; i < count; i++) {
      idx += 1;
      users.push(buildUser({ r, app, queue, agents, idx }));
    }
  }
  return users;
}

function buildEscalations(users: CustomerUser[], agents: AgentAccount[], r: Rng): EscalationRecord[] {
  const candidates = users.filter((u) => u.app === 'realbroks' || u.app === 'irondrobe').filter((u) => u.queue === 'new' || u.queue === 'tickets');
  const chosen = r.shuffle(candidates).slice(0, 5);
  const list: EscalationRecord[] = [];
  const rerouteReasons = [
    { lang: 'Telugu' as Language, reason: 'Speaks Telugu, agent has Tamil only' },
    { lang: 'Hindi' as Language, reason: 'Hindi — agent holds Tamil only' },
    { lang: 'Kannada' as Language, reason: 'Prefers Kannada, current agent is Tamil-only' },
  ];
  chosen.forEach((u, i) => {
    const owner = agents.find((a) => a.id === u.ownerAgentId) ?? agents[0];
    const raisedTs = NOW - r.int(5, 300) * 60000;
    if (i < 3) {
      const rr = rerouteReasons[i % rerouteReasons.length];
      list.push({
        id: `esc-${i}`, type: 'reroute', userId: u.id, userName: u.name, userCity: `${u.city}, ${u.effectiveState}`, app: u.app,
        raisedAtLabel: fmtDayTime(raisedTs).split(' · ')[1], raisedTs,
        raisedByAgentId: owner.id, reason: rr.reason, targetLanguage: rr.lang,
        suggestedOwnerId: agents.find((a) => a.languages.includes(rr.lang) && a.id !== owner.id)?.id,
        note: r.pick(COMMENTS_POOL), status: 'pending',
      });
    } else {
      list.push({
        id: `esc-${i}`, type: 'escalation', userId: u.id, userName: u.name, userCity: `${u.city}, ${u.effectiveState}`, app: u.app,
        raisedAtLabel: fmtDayTime(raisedTs).split(' · ')[1], raisedTs,
        raisedByAgentId: owner.id, reason: r.pick(['Refund request — paid twice', 'Wants to negotiate annual pricing', 'Wants the manager', 'Billing dispute']),
        urgency: r.bool(0.3) ? 'urgent' : 'normal',
        note: r.pick(COMMENTS_POOL), status: 'pending',
      });
    }
  });
  return list.sort((a, b) => b.raisedTs - a.raisedTs);
}

function buildClearedEscalations(r: Rng) {
  const names = ['Meena R', 'Vijay Homes', 'S. Lakshmi', 'Anand Realty', 'K. Prakash'];
  return names.slice(0, 3).map((n, i) => ({
    id: `cleared-${i}`,
    atLabel: i === 0 ? fmtDayTime(NOW - r.int(1, 4) * 3600000).split(' · ')[1] : 'Yesterday',
    name: n,
    action: r.pick(['Reroute → Kannada', 'Escalation → pricing', 'Reroute → Hindi', 'Escalation → refund']),
    result: r.pick(['Approved · reassigned', 'Closed · 10% annual offer', 'Declined · handled in English', 'Approved · refund issued']),
    minutes: r.int(15, 90),
  }));
}

export interface Seed {
  apps: AppDef[];
  states: StateSeedDef[];
  agents: AgentAccount[];
  users: CustomerUser[];
  escalations: EscalationRecord[];
  clearedEscalations: ReturnType<typeof buildClearedEscalations>;
  generatedAt: number;
}

export function generateSeed(seedNumber = 20260816): Seed {
  const r = new Rng(seedNumber);
  const users = [
    ...buildAppUsers('realbroks', REALBROKS_COUNTS, AGENTS, r),
    ...buildAppUsers('irondrobe', IRONDROBE_COUNTS, AGENTS, r),
  ];
  const escalations = buildEscalations(users, AGENTS, r);
  escalations.forEach((e) => {
    const u = users.find((x) => x.id === e.userId);
    if (u) u.hasActiveEscalation = true;
  });
  return {
    apps: APPS,
    states: STATE_DEFS,
    agents: AGENTS,
    users,
    escalations,
    clearedEscalations: buildClearedEscalations(r),
    generatedAt: NOW,
  };
}
