import { Rng } from '../lib/rng';
import { DAY_MS, fmtDay, fmtDayTime } from '../lib/dates';
import { recordingUrlFor } from '../lib/telephony';
import type {
  AgentAccount,
  AppDef,
  AppId,
  AuditEntry,
  CallAnalysis,
  CallLogEntry,
  CallStatus,
  CustomerUser,
  EscalationRecord,
  Language,
  Outcome,
  QueueKey,
  TicketRecord,
} from './types';
import { BRAND } from '../brand';
import { customerTypesFor } from './products';
import { TECSTELLAR_STATES, type StateSeedDef } from './states';
import {
  COLLECTION_MODES, SCHEMES, SCHEME_WEIGHTS, VANMOH_AGENTS, VANMOH_APPS, VANMOH_AUDIT, VANMOH_CLEARED, VANMOH_CLEARED_ACTIONS,
  VANMOH_CLEARED_RESULTS, VANMOH_COMMENTS, VANMOH_ESCALATIONS, VANMOH_FAILED, VANMOH_FIRST_NAMES, VANMOH_NO_STATE_WEIGHT,
  VANMOH_REROUTES, VANMOH_STATES, VANMOH_SURNAMES, VANMOH_TICKETS, schemeLabel, vanmohSampleAnalysis,
} from './seedVanmoh';

const NOW = Date.now();

/** The Vanmoh Chit Funds build (VITE_BRAND=vanmoh) generates its own sample subscribers; see seedVanmoh.ts. */
const VM = BRAND.key === 'vanmoh';

const ALL_TECSTELLAR_APPS: AppDef[] = [
  { id: 'realbroks', name: 'RealBroks', tagline: 'Broker assistant · 10K+ installs', logo: 'logo-realbroks.png', live: true },
  { id: 'irondrobe', name: 'IronDrobe', tagline: 'Laundry & ironing CRM · 1K+ installs', logo: 'logo-irondrobe.png', live: true },
  { id: 'influnet', name: 'Influnet', tagline: 'influnet.io · in development', logo: 'logo-influnet.png', live: false },
  { id: 'vehigo', name: 'Vehigo', tagline: 'In development', logo: 'logo-vehigo.png', live: false },
];

// VITE_APPS (comma-separated app ids) limits a deployment to some of Tecstellar's apps — e.g. "realbroks,irondrobe".
// Unset = all of them, as before. The others then appear nowhere: menus, access, search, customers.
const ENABLED_APPS = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APPS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const TECSTELLAR_APPS: AppDef[] = ENABLED_APPS.length ? ALL_TECSTELLAR_APPS.filter((a) => ENABLED_APPS.includes(a.id)) : ALL_TECSTELLAR_APPS;

export const APPS: AppDef[] = VM ? VANMOH_APPS : TECSTELLAR_APPS;
export const STATE_DEFS: StateSeedDef[] = VM ? VANMOH_STATES : TECSTELLAR_STATES;
export const NO_STATE_WEIGHT = VM ? VANMOH_NO_STATE_WEIGHT : 412;

const TECSTELLAR_AGENTS: AgentAccount[] = [
  {
    id: 'ravi-s', name: 'Ravi S', username: 'ravi.s', role: 'agent', status: 'active', createdTs: NOW - 160 * DAY_MS,
    apps: ['realbroks'], queues: ['new', 'followup', 'inactive'],
    languages: ['Tamil', 'Telugu', 'Kannada'],
    states: ['Tamil Nadu', 'Telangana', 'Andhra Pradesh', 'Karnataka'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '2 min ago',
    telecmiUserId: '5001_33338836',
    todayCalls: 62, todayConnected: 44, todayPositive: 21, todaySubscribed: 4, todayOverdue: 2, avgHandleLabel: '3m 10s',
    workingQueueLabel: 'New registrations',
  },
  {
    id: 'abhinaya-m', name: 'Abhinaya M', username: 'abhinaya.m', role: 'agent', status: 'active', createdTs: NOW - 160 * DAY_MS,
    apps: ['realbroks', 'irondrobe'], queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'],
    languages: ['Tamil', 'Hindi'],
    states: ['Tamil Nadu', 'Maharashtra', 'Delhi', 'Uttar Pradesh', 'Gujarat', 'Rajasthan', 'Madhya Pradesh', 'West Bengal'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: 'now · on call',
    telecmiUserId: '5002_33338836',
    todayCalls: 58, todayConnected: 39, todayPositive: 18, todaySubscribed: 3, todayOverdue: 7, avgHandleLabel: '3m 48s',
    workingQueueLabel: 'Positive follow-up',
  },
  {
    id: 'karthick-g', name: 'Karthick G', username: 'karthick.g', role: 'agent', status: 'active', createdTs: NOW - 160 * DAY_MS,
    apps: ['realbroks'], queues: ['payments', 'errors'],
    languages: ['Tamil'],
    states: ['Tamil Nadu'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '14 min ago',
    telecmiUserId: '5003_33338836',
    capabilities: { realbroks: ['call', 'tickets', 'recordings', 'payments'] },
    todayCalls: 51, todayConnected: 31, todayPositive: 14, todaySubscribed: 2, todayOverdue: 11, avgHandleLabel: '4m 02s',
    workingQueueLabel: 'Payments & dues',
  },
  {
    id: 'divya-p', name: 'Divya P', username: 'divya.p', role: 'agent', status: 'active', createdTs: NOW - 160 * DAY_MS,
    apps: ['irondrobe'], queues: ['tickets', 'inactive'],
    languages: ['Tamil', 'Malayalam'],
    states: ['Tamil Nadu', 'Kerala'],
    dailyTarget: 50, clickToDial: true, lastActiveLabel: '1 hr ago',
    telecmiUserId: '5004_33338836',
    todayCalls: 43, todayConnected: 32, todayPositive: 10, todaySubscribed: 1, todayOverdue: 7, avgHandleLabel: '5m 21s',
    workingQueueLabel: 'Tickets & flags',
  },
  {
    id: 'priya-n', name: 'Priya N', username: 'priya.n', role: 'agent', trainee: true, status: 'active', createdTs: NOW - 52 * DAY_MS,
    apps: ['irondrobe'], queues: ['new'],
    languages: ['Tamil', 'Telugu'],
    states: ['Tamil Nadu'],
    dailyTarget: 30, clickToDial: true, lastActiveLabel: 'Yesterday',
    telecmiUserId: '5005_33338836',
    capabilities: { irondrobe: ['call', 'recordings'] },
    todayCalls: 19, todayConnected: 12, todayPositive: 4, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '6m 40s',
    workingQueueLabel: 'New registrations',
  },
  {
    id: 'munees-a', name: 'Munees A', username: 'munees.a', role: 'supervisor', status: 'active', createdTs: NOW - 300 * DAY_MS,
    apps: ['realbroks', 'irondrobe'], queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'],
    languages: ['Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Hindi', 'Bengali', 'English'],
    states: TECSTELLAR_STATES.map((s) => s.name),
    dailyTarget: 0, clickToDial: true, lastActiveLabel: 'now',
    telecmiUserId: '5000_33338836',
    todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—',
    workingQueueLabel: '—',
  },
  {
    id: 'owner-1', name: 'Owner', username: 'owner', role: 'admin', status: 'active', createdTs: NOW - 400 * DAY_MS,
    apps: ['realbroks', 'irondrobe', 'influnet', 'vehigo'], queues: [],
    languages: [], states: [],
    dailyTarget: 0, clickToDial: false, lastActiveLabel: 'now',
    todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—',
    workingQueueLabel: '—',
  },
];

export const AGENTS: AgentAccount[] = VM ? VANMOH_AGENTS : TECSTELLAR_AGENTS;

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

/**
 * Demo-only call analysis (source: 'sample') for the generated customers and for calls on the mock line.
 * Real calls are analysed from their recording on the server (server/analyze.ts) — never from these templates.
 */
function makeSampleAnalysis(
  r: Rng,
  at: number,
  customerName: string,
  app: AppId,
  outcome: Outcome | undefined,
): CallAnalysis {
  if (VM) return vanmohSampleAnalysis(r, at, customerName, outcome);
  const isRealbroks = app === 'realbroks';
  const isPositive = outcome && ['Interested', 'Very interested', 'Ready to subscribe', 'Created first listing'].includes(outcome);
  const isNegative = outcome && ['Not interested', 'Using competitor'].includes(outcome);
  const isIssue = outcome && ['Payment issue', 'Technical issue'].includes(outcome);

  let sentimentScore = 0.15;
  let summary = '';
  let objections: string[] = [];
  let keyTopics: string[] = [];
  let actionItems: string[] = [];
  let transcript: { speaker: 'agent' | 'customer'; text: string; offsetSec: number }[] = [];

  if (isPositive) {
    sentimentScore = Number((0.70 + r.float() * 0.25).toFixed(2));
    if (isRealbroks) {
      summary = `Customer verified listings sync for ${customerName} and requested pricing details on the Pro annual broker plan.`;
      keyTopics = ['broker_listings', 'annual_plan', 'pricing', 'whatsapp_sync'];
      actionItems = ['Send WhatsApp payment link for Annual Pro plan', 'Schedule onboarding follow-up'];
      transcript = [
        { speaker: 'agent', text: `Hello ${customerName}, calling from RealBroks team. How has your experience been with adding client requirements?`, offsetSec: 4 },
        { speaker: 'customer', text: 'Hi! The app is great, especially the automated WhatsApp matching. It saved me a lot of time this week.', offsetSec: 16 },
        { speaker: 'agent', text: 'Glad to hear that! Would you like to upgrade to the Pro plan to unlock unlimited property listings and direct buyer alerts?', offsetSec: 32 },
        { speaker: 'customer', text: 'Yes, if you have an annual plan discount, please send the payment details on WhatsApp. I will complete it today.', offsetSec: 54 },
        { speaker: 'agent', text: 'Sending the QR code and invoice right away. Thank you for choosing RealBroks!', offsetSec: 72 },
      ];
    } else {
      summary = `Customer active on IronDrobe. Requested batch order tracking demo and agreed to upgrade upon invoice delivery.`;
      keyTopics = ['drycleaning_orders', 'batch_tracking', 'sms_notifications'];
      actionItems = ['Send UPI payment invoice', 'Enable multi-branch toggle'];
      transcript = [
        { speaker: 'agent', text: `Good afternoon ${customerName}, following up from IronDrobe support regarding your shop operations.`, offsetSec: 3 },
        { speaker: 'customer', text: 'Hello, yes! The daily garment intake tracking works very smoothly on our counter.', offsetSec: 15 },
        { speaker: 'agent', text: 'Awesome. Our paid tier gives you automatic SMS notifications to customers when their ironing or laundry is ready.', offsetSec: 30 },
        { speaker: 'customer', text: 'That is exactly what our customers have been asking for. Send me the plan link.', offsetSec: 48 },
        { speaker: 'agent', text: 'Shared via WhatsApp just now. I will confirm activation as soon as it clears.', offsetSec: 62 },
      ];
    }
  } else if (isNegative) {
    sentimentScore = Number((-0.50 - r.float() * 0.35).toFixed(2));
    if (outcome === 'Using competitor') {
      summary = `Customer currently using a local competitor due to existing team accounts. Hesitant to switch without data migration.`;
      keyTopics = ['competitor_product', 'data_migration', 'pricing_objection'];
      objections = ['Already on another app through their association', 'Will not switch without importing old records'];
      actionItems = ['Note competitor usage in CRM', 'Contact again when Excel import is released'];
      transcript = [
        { speaker: 'agent', text: `Hi ${customerName}, checking in from Tecstellar support. How are things going with your setup?`, offsetSec: 4 },
        { speaker: 'customer', text: 'We actually moved our records to another software because our regional association offered us a free bulk license.', offsetSec: 18 },
        { speaker: 'agent', text: 'Understood. We are releasing an automated 1-click import from Excel and competitor exports next month.', offsetSec: 38 },
        { speaker: 'customer', text: 'Okay, let me know when that is live and we might reconsider. Currently satisfied where we are.', offsetSec: 58 },
      ];
    } else {
      summary = `Customer stated business is slow this quarter and declining current subscription offers.`;
      keyTopics = ['budget_constraints', 'declined_offer'];
      objections = ['Business is slow this quarter — cutting software costs'];
      actionItems = ['Pause active outreach for 30 days', 'Send seasonal discount bulletin'];
      transcript = [
        { speaker: 'agent', text: `Hello ${customerName}, calling to check if you need any help with your account.`, offsetSec: 3 },
        { speaker: 'customer', text: 'Not interested at this time. Business has been slow, so we are cutting unnecessary software costs.', offsetSec: 16 },
        { speaker: 'agent', text: 'Understood. Your free account will remain active. Feel free to reach out anytime.', offsetSec: 32 },
      ];
    }
  } else if (isIssue) {
    sentimentScore = Number((r.float() * 0.2 - 0.1).toFixed(2));
    summary = `Customer reported payment deduction failure on checkout. Awaiting transaction reference screenshot.`;
    keyTopics = ['payment_gateway', 'bank_reconciliation', 'checkout_issue'];
    actionItems = ['Reconcile transaction reference with Razorpay/Gateway desk', 'Confirm plan upgrade once verified'];
    transcript = [
      { speaker: 'agent', text: `Hello ${customerName}, noticed an incomplete transaction on your account and wanted to verify if you were charged.`, offsetSec: 5 },
      { speaker: 'customer', text: 'Yes, the money got deducted from my Google Pay but the app is still showing the free trial screen!', offsetSec: 18 },
      { speaker: 'agent', text: 'Do not worry, we will fix this immediately. Please send your 12-digit UPI reference number to our official WhatsApp.', offsetSec: 35 },
      { speaker: 'customer', text: 'Sharing it right away. Please activate the account as soon as possible.', offsetSec: 50 },
      { speaker: 'agent', text: 'On it! I will manually activate your Pro license within 15 minutes of receiving the reference.', offsetSec: 64 },
    ];
  } else {
    sentimentScore = 0.25 + r.float() * 0.2;
    summary = `General check-in call with ${customerName}. Customer active and reviewing features.`;
    keyTopics = ['general_inquiry', 'feature_walkthrough'];
    actionItems = ['Send product guide link', 'Follow up next cycle'];
    transcript = [
      { speaker: 'agent', text: `Hello ${customerName}, checking in to see if you have any questions navigating the dashboard.`, offsetSec: 4 },
      { speaker: 'customer', text: 'Everything seems straightforward so far. Just getting familiar with the daily reports.', offsetSec: 18 },
      { speaker: 'agent', text: 'Wonderful! We have a quick 2-minute tutorial on our YouTube channel if you ever need reference.', offsetSec: 34 },
      { speaker: 'customer', text: 'Sounds good, thanks for reaching out.', offsetSec: 46 },
    ];
  }

  return {
    source: 'sample',
    at,
    outcome: outcome ?? 'Call back later',
    summary,
    keyPoints: keyTopics.map((t) => t.replace(/_/g, ' ')),
    objections,
    actionItems,
    recommendation: actionItems[0],
    sentiment: Math.round((Math.max(-1, Math.min(1, sentimentScore)) + 1) * 50),
    languages: ['English'],
    transcript: transcript.map((l) => ({ speaker: l.speaker, atSec: l.offsetSec, text: l.text })),
  };
}

/** Sample analysis for a call just made on the demo line. */
export function sampleAnalysis(at: number, customerName: string, app: AppId = 'realbroks', outcome?: Outcome): CallAnalysis {
  return makeSampleAnalysis(new Rng(at), at, customerName, app, outcome);
}

function makeCallHistory(
  r: Rng,
  agentNames: string[],
  attempts: number,
  finalStatus: CallStatus | null,
  finalOutcome: Outcome | undefined,
  finalComment: string,
  app: AppId = 'realbroks',
  customerName: string = 'Customer',
): CallLogEntry[] {
  const entries: CallLogEntry[] = [];
  let ts = NOW - attempts * r.int(1, 3) * DAY_MS;
  const warm = finalOutcome !== undefined && POSITIVE_STEPS.includes(finalOutcome);
  for (let i = 0; i < attempts - (finalStatus ? 1 : 0); i++) {
    ts += r.int(1, 3) * DAY_MS;
    // Warm leads (the follow-up chain) had real conversations along the way, not just missed calls.
    if (warm && r.bool(0.6)) {
      const agent = r.pick(agentNames);
      const outcome = r.pick<Outcome>(['Interested', 'Interested', 'Technical issue']);
      const durationSec = r.int(50, 200);
      const recFile = `rec_${r.int(100000, 999999)}.wav`;
      entries.push({
        id: `cl-${r.int(1, 1e9)}`,
        atTs: ts,
        atLabel: fmtDayTime(ts),
        agentName: agent,
        status: 'Answered — Followup',
        outcome,
        comment: r.pick(COMMENTS_POOL),
        telephony: { provider: 'telecmi', callId: `cmi-${r.int(100000, 999999)}`, durationSec, ringSec: r.int(8, 22), disposition: 'answered', recordingFile: recFile, recordingUrl: recordingUrlFor(recFile) },
        analysis: makeSampleAnalysis(r, ts, customerName, app, outcome),
      });
      continue;
    }
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
    const agent = r.pick(agentNames);
    const isAnswered = finalStatus.startsWith('Answered');
    const durationSec = isAnswered ? r.int(65, 230) : 0;
    const recFile = isAnswered ? `rec_${r.int(100000, 999999)}.wav` : undefined;

    entries.push({
      id: `cl-${r.int(1, 1e9)}`,
      atTs: ts,
      atLabel: fmtDayTime(ts),
      agentName: agent,
      status: finalStatus,
      outcome: finalOutcome,
      comment: finalComment,
      telephony: isAnswered
        ? {
            provider: 'telecmi',
            callId: `cmi-${r.int(100000, 999999)}`,
            durationSec,
            ringSec: r.int(12, 22),
            disposition: 'answered',
            recordingFile: recFile,
            recordingUrl: recFile ? recordingUrlFor(recFile) : undefined,
          }
        : undefined,
      analysis: isAnswered ? makeSampleAnalysis(r, ts, customerName, app, finalOutcome) : undefined,
    });
  }
  // Attempts are spaced forward from a start date, so a long history can run past "now". Shift the whole history
  // back so the latest call happened at least an hour ago — sample calls must never be dated in the future.
  const latest = Math.max(...entries.map((e) => e.atTs), 0);
  const limit = NOW - 3600000;
  if (latest > limit) {
    const shift = latest - limit + r.int(0, 72) * 3600000;
    for (const e of entries) {
      e.atTs -= shift;
      e.atLabel = fmtDayTime(e.atTs);
      if (e.analysis) e.analysis = { ...e.analysis, at: e.atTs };
    }
  }
  return entries.sort((a, b) => b.atTs - a.atTs);
}

const POSITIVE_STEPS: Outcome[] = ['Interested', 'Very interested', 'Ready to subscribe', 'Created first listing'];

const COMMENTS_POOL = VM ? VANMOH_COMMENTS : [
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
  const first = r.pick(VM ? VANMOH_FIRST_NAMES : FIRST_NAMES);
  const last = r.pick(VM ? VANMOH_SURNAMES : SURNAMES);
  const name = `${first} ${last}`;
  // Vanmoh: the chit scheme they hold or enquired about stands in for the business name.
  const scheme = VM ? r.weighted(SCHEMES.map((value, i) => ({ value, weight: SCHEME_WEIGHTS[i] }))) : null;
  const business = scheme ? schemeLabel(scheme) : app === 'realbroks' ? BIZ_TEMPLATES_REALBROKS(last, city, r) : BIZ_TEMPLATES_IRONDROBE(last, city, r);
  const registeredDaysAgo = queue === 'inactive' ? r.int(35, 220) : queue === 'new' ? r.int(0, 4) : r.int(1, 260);
  const registeredTs = NOW - registeredDaysAgo * DAY_MS;
  const shopCode = `TS${2026060000 + r.int(1, 999999)}`;
  const phone = `+91 ${r.int(70000, 99999)} ${r.int(10000, 99999)}`;
  const owner = reachableAgent(agents, app, queue, effState, lang, hasState);
  const ownerNames = owner ? [owner.name] : ['Ravi S', 'Abhinaya M'];

  // Vanmoh: subscribers pay instalments; enquiries, warm leads and lapsed subscribers don't.
  const paying = VM
    ? queue === 'payments' || queue === 'tickets' || queue === 'errors' || (queue === null && r.bool(0.8))
    : queue === null ? r.bool(0.18) : queue === 'payments' ? r.bool(0.85) : false;
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
      callHistory = makeCallHistory(r, ownerNames, attempt, r.bool(0.5) ? r.pick(CALL_STATUSES) : null, undefined, comment, app, name);
      planNote = `Free · ${r.int(2, 50)} orders left`;
      break;
    }
    case 'tickets': {
      attempt = 1;
      const slaBreached = r.bool(0.3);
      tickets = [{
        id: `tk-${r.int(1, 1e9)}`,
        subject: VM ? r.pick(VANMOH_TICKETS) : r.pick(['App crashes on checkout', 'Payment deducted, subscription not active', 'Cannot upload listing photos', 'OTP not received', 'Wrong plan applied', 'Refund not processed']),
        raisedAtLabel: fmtDay(NOW - r.int(0, 6) * DAY_MS),
        slaBreached,
      }];
      stageTag = slaBreached ? 'SLA breach' : 'Open ticket';
      callHistory = makeCallHistory(r, ownerNames, 1, null, undefined, comment, app, name);
      break;
    }
    case 'payments': {
      const status = r.weighted([
        { value: 'upcoming' as const, weight: 5 },
        { value: 'overdue' as const, weight: 3 },
        { value: 'expired' as const, weight: 2 },
      ]);
      paymentDue = {
        amount: scheme ? scheme.monthly : r.pick([499, 999, 1499, 2499, 4999]),
        dueLabel: fmtDay(NOW + (status === 'upcoming' ? r.int(1, 10) : -r.int(1, 20)) * DAY_MS),
        status,
      };
      stageTag = status === 'expired' ? 'Expired' : status === 'overdue' ? 'Overdue' : 'Due soon';
      callHistory = makeCallHistory(r, ownerNames, r.int(1, 3), null, undefined, comment, app, name);
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
      callHistory = makeCallHistory(r, ownerNames, week + 1, r.pick(CALL_STATUSES), finalOutcome, comment, app, name);
      break;
    }
    case 'errors': {
      stageTag = r.pick(VM ? VANMOH_FAILED : ['Payment failed', 'Tried to subscribe', 'App crash on pay']);
      callHistory = makeCallHistory(r, ownerNames, 1, null, undefined, comment, app, name);
      break;
    }
    case 'inactive': {
      stageTag = 'Inactive 30+';
      callHistory = makeCallHistory(r, ownerNames, r.int(0, 2), null, undefined, comment, app, name);
      break;
    }
    default: {
      stageTag = paying ? 'Paying' : active ? 'Active' : 'Dormant';
      break;
    }
  }

  if (scheme) {
    const group = r.int(1, 18);
    const ticket = r.int(1, scheme.months);
    const subscriber = paying || queue === 'inactive';
    return {
      id: `u-${app}-${idx}`,
      shopCode: subscriber ? `VCF-${scheme.months}${String(group).padStart(2, '0')}-${ticket}` : `ENQ-${r.int(1000, 9999)}`,
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
      planNote: subscriber ? `Group V${scheme.months}-${String(group).padStart(2, '0')} · ticket ${ticket}` : 'Not joined yet',
      listings: subscriber ? r.int(1, scheme.months - 1) : 0,
      buyers: scheme.months,
      lastOpenLabel: !subscriber ? '—' : queue === 'inactive' ? `${r.int(31, 90)}d ago` : `${r.int(1, 25)}d ago`,
      appVersion: subscriber ? r.pick(COLLECTION_MODES) : 'Not started',
      conversionScore,
      stageTag: queue === null ? (paying ? 'Subscriber' : 'Prized · paid out') : stageTag,
      queue,
      attempt,
      callHistory,
      tickets,
      paymentDue,
      followUp,
      paying,
      active,
      ownerAgentId: owner ? owner.id : null,
      mrr: paying ? scheme.monthly : undefined,
    };
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
    customerType: customerTypesFor(app)[r.int(0, 2)],
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
const VANMOH_COUNTS: QueueCounts = { new: 30, tickets: 8, payments: 40, followup: 18, errors: 6, inactive: 30, rest: 250 };
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
  const candidates = users.filter((u) => u.app === 'realbroks' || u.app === 'irondrobe' || u.app === 'vanmoh').filter((u) => u.queue === 'new' || u.queue === 'tickets');
  const chosen = r.shuffle(candidates).slice(0, 5);
  const list: EscalationRecord[] = [];
  const rerouteReasons = VM ? VANMOH_REROUTES : [
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
        raisedByAgentId: owner.id, reason: r.pick(VM ? VANMOH_ESCALATIONS : ['Refund request — paid twice', 'Wants to negotiate annual pricing', 'Wants the manager', 'Billing dispute']),
        urgency: r.bool(0.3) ? 'urgent' : 'normal',
        note: r.pick(COMMENTS_POOL), status: 'pending',
      });
    }
  });
  return list.sort((a, b) => b.raisedTs - a.raisedTs);
}

function buildClearedEscalations(r: Rng) {
  const names = VM ? VANMOH_CLEARED : ['Meena R', 'Vijay Homes', 'S. Lakshmi', 'Anand Realty', 'K. Prakash'];
  return names.slice(0, 3).map((n, i) => ({
    id: `cleared-${i}`,
    atLabel: i === 0 ? fmtDayTime(NOW - r.int(1, 4) * 3600000).split(' · ')[1] : 'Yesterday',
    name: n,
    action: r.pick(VM ? VANMOH_CLEARED_ACTIONS : ['Reroute → Kannada', 'Escalation → pricing', 'Reroute → Hindi', 'Escalation → refund']),
    result: r.pick(VM ? VANMOH_CLEARED_RESULTS : ['Approved · reassigned', 'Closed · 10% annual offer', 'Declined · handled in English', 'Approved · refund issued']),
    minutes: r.int(15, 90),
  }));
}

function buildAudit(): AuditEntry[] {
  const at = (minutesAgo: number) => NOW - minutesAgo * 60000;
  if (VM) return VANMOH_AUDIT.map(({ minutesAgo, ...row }, i) => ({ ...row, ts: at(minutesAgo), id: `audit-seed-${i}` }));
  const rows: Omit<AuditEntry, 'id'>[] = [
    { ts: at(42), actorId: 'munees-a', actorName: 'Munees A', action: 'access_changed', target: 'Priya N', detail: 'Queues: New registrations (was none)' },
    { ts: at(180), actorId: 'munees-a', actorName: 'Munees A', action: 'escalation_approved', target: 'Meena R', detail: 'Reroute → Kannada · reassigned' },
    { ts: at(60 * 26), actorId: 'owner-1', actorName: 'Owner', action: 'access_changed', target: 'Karthick G', detail: 'RealBroks: added Handle payments' },
    { ts: at(60 * 24 * 52), actorId: 'owner-1', actorName: 'Owner', action: 'user_created', target: 'Priya N', detail: 'Agent · trainee · IronDrobe' },
  ];
  return rows.map((r, i) => ({ ...r, id: `audit-seed-${i}` }));
}

export interface Seed {
  apps: AppDef[];
  states: StateSeedDef[];
  agents: AgentAccount[];
  users: CustomerUser[];
  escalations: EscalationRecord[];
  clearedEscalations: ReturnType<typeof buildClearedEscalations>;
  audit: AuditEntry[];
  generatedAt: number;
}

export function generateSeed(seedNumber = 20260816): Seed {
  const r = new Rng(seedNumber);
  const users = VM
    ? buildAppUsers('vanmoh', VANMOH_COUNTS, AGENTS, r)
    : [
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
    audit: buildAudit(),
    generatedAt: NOW,
  };
}
