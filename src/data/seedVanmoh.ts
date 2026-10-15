// Sample data for the Vanmoh Chit Funds build (VITE_BRAND=vanmoh). Generated, like Tecstellar's — no real
// subscriber is in here. Schemes are the ones on vanmohchitfunds.in; areas are Coimbatore and the Nilgiris.
// src/data/seed.ts uses this in place of its RealBroks/IronDrobe data when the brand is Vanmoh.

import type { Rng } from '../lib/rng';
import type { AgentAccount, AppDef, CallAnalysis, Language, Outcome, StateDef } from './types';

const DAY_MS = 86_400_000;
const NOW = Date.now();

export interface ChitScheme {
  value: number;
  months: number;
  monthly: number;
}

/** vanmohchitfunds.in › Products. */
export const SCHEMES: ChitScheme[] = [
  { value: 10_000, months: 10, monthly: 1_000 },
  { value: 20_000, months: 10, monthly: 2_000 },
  { value: 50_000, months: 10, monthly: 5_000 },
  { value: 50_000, months: 20, monthly: 2_500 },
  { value: 1_00_000, months: 20, monthly: 5_000 },
  { value: 2_00_000, months: 20, monthly: 10_000 },
  { value: 3_00_000, months: 20, monthly: 15_000 },
  { value: 5_00_000, months: 20, monthly: 25_000 },
  { value: 10_00_000, months: 20, monthly: 50_000 },
  { value: 3_00_000, months: 30, monthly: 10_000 },
  { value: 5_00_000, months: 40, monthly: 12_500 },
  { value: 10_00_000, months: 40, monthly: 25_000 },
];

/** Smaller schemes are far more common than the ₹10 lakh ones. */
export const SCHEME_WEIGHTS = [8, 7, 9, 6, 10, 6, 3, 2, 1, 3, 2, 1];

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const schemeLabel = (s: ChitScheme) => `${rupees(s.value)} chit · ${s.months} months`;

export const VANMOH_APPS: AppDef[] = [
  { id: 'vanmoh', name: 'Vanmoh Chit Funds', tagline: 'Chit schemes · Coimbatore & Nilgiris', logo: 'vanmoh-wordmark.png', live: true },
];

export interface StateSeed extends StateDef {
  weight: number;
  cities: string[];
}

export const VANMOH_STATES: StateSeed[] = [
  {
    name: 'Tamil Nadu', lon: 78.4, lat: 11.0, language: 'Tamil', weight: 96,
    cities: ['Gandhipuram', 'RS Puram', 'Peelamedu', 'Saibaba Colony', 'Singanallur', 'Ukkadam', 'Ganapathy', 'Vadavalli', 'Pollachi', 'Mettupalayam', 'Tiruppur', 'Ooty', 'Coonoor', 'Kotagiri', 'Gudalur'],
  },
  { name: 'Kerala', lon: 76.4, lat: 10.2, language: 'Malayalam', weight: 4, cities: ['Palakkad'] },
];

export const VANMOH_NO_STATE_WEIGHT = 0;

const agent = (a: Partial<AgentAccount> & Pick<AgentAccount, 'id' | 'name' | 'username' | 'role'>): AgentAccount => ({
  status: 'active', createdTs: NOW - 120 * DAY_MS, apps: ['vanmoh'], queues: [], languages: ['Tamil'], states: ['Tamil Nadu'],
  dailyTarget: 50, clickToDial: true, lastActiveLabel: 'Never',
  todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—', workingQueueLabel: '—',
  ...a,
});

// Softphone users are the same TeleCMI extensions as Tecstellar's sample roster, so the calling test runs on the
// TeleCMI account this deployment is configured with. Change them in People & access once Vanmoh has its own.
export const VANMOH_AGENTS: AgentAccount[] = [
  agent({
    id: 'kavitha-r', name: 'Kavitha R', username: 'kavitha.r', role: 'agent', telecmiUserId: '5001_33338836',
    queues: ['new', 'followup'], languages: ['Tamil', 'English'], lastActiveLabel: '3 min ago',
    todayCalls: 48, todayConnected: 33, todayPositive: 14, todaySubscribed: 3, todayOverdue: 2, avgHandleLabel: '3m 25s', workingQueueLabel: 'New enquiries',
  }),
  agent({
    id: 'saravanan-k', name: 'Saravanan K', username: 'saravanan.k', role: 'agent', telecmiUserId: '5002_33338836',
    queues: ['payments', 'errors', 'inactive'], languages: ['Tamil'], lastActiveLabel: 'now · on call',
    capabilities: { vanmoh: ['call', 'tickets', 'recordings', 'payments'] },
    todayCalls: 61, todayConnected: 42, todayPositive: 19, todaySubscribed: 0, todayOverdue: 9, avgHandleLabel: '2m 40s', workingQueueLabel: 'Instalment dues',
  }),
  agent({
    id: 'deepika-s', name: 'Deepika S', username: 'deepika.s', role: 'agent', telecmiUserId: '5003_33338836',
    queues: ['tickets', 'payments', 'new'], languages: ['Tamil', 'Malayalam', 'English'], states: ['Tamil Nadu', 'Kerala'], lastActiveLabel: '20 min ago',
    todayCalls: 39, todayConnected: 28, todayPositive: 11, todaySubscribed: 1, todayOverdue: 4, avgHandleLabel: '4m 05s', workingQueueLabel: 'Complaints & requests',
  }),
  agent({
    id: 'manikandan-p', name: 'Manikandan P', username: 'manikandan.p', role: 'agent', trainee: true, telecmiUserId: '5004_33338836',
    queues: ['new'], dailyTarget: 30, createdTs: NOW - 30 * DAY_MS, lastActiveLabel: 'Yesterday',
    capabilities: { vanmoh: ['call', 'recordings'] },
    todayCalls: 17, todayConnected: 10, todayPositive: 4, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '5m 50s', workingQueueLabel: 'New enquiries',
  }),
  agent({
    id: 'lakshmi-v', name: 'Lakshmi V', username: 'lakshmi.v', role: 'supervisor', telecmiUserId: '5000_33338836',
    queues: ['new', 'tickets', 'payments', 'followup', 'errors', 'inactive'], languages: ['Tamil', 'Malayalam', 'English'], states: ['Tamil Nadu', 'Kerala'],
    dailyTarget: 0, createdTs: NOW - 300 * DAY_MS, lastActiveLabel: 'now',
  }),
  agent({
    id: 'owner-1', name: 'Owner', username: 'owner', role: 'admin', apps: ['vanmoh'], languages: [], states: [],
    dailyTarget: 0, clickToDial: false, createdTs: NOW - 400 * DAY_MS, lastActiveLabel: 'now',
  }),
];

export const VANMOH_FIRST_NAMES = [
  'Murugan', 'Selvi', 'Karthikeyan', 'Revathi', 'Senthil', 'Kalaivani', 'Prabhu', 'Sangeetha', 'Ramesh', 'Jayanthi',
  'Dhanalakshmi', 'Arumugam', 'Saravanan', 'Malathi', 'Velmurugan', 'Kowsalya', 'Balasubramanian', 'Gomathi', 'Palanisamy', 'Sumathi',
  'Rajendran', 'Vasanthi', 'Sivakumar', 'Bhuvaneshwari', 'Natarajan', 'Chitra', 'Kumaresan', 'Anandhi', 'Mohanraj', 'Thenmozhi',
  'Ganesan', 'Parvathi', 'Elango', 'Kalpana', 'Subramani', 'Amudha', 'Rajkumar', 'Uma', 'Dinesh', 'Nirmala',
];
export const VANMOH_SURNAMES = ['S', 'K', 'R', 'M', 'P', 'V', 'N', 'A', 'G', 'T', 'C', 'B'];

export const COLLECTION_MODES = ['Doorstep · daily', 'Doorstep · weekly', 'Doorstep · monthly', 'UPI · monthly', 'Branch counter · monthly'];

export const VANMOH_TICKETS = [
  'Collection agent did not come this week',
  'Receipt not received for last instalment',
  'Wants the auction date for their group',
  'Prize money not credited yet',
  'Change collection from daily to weekly',
  'Wants a statement of instalments paid',
];

export const VANMOH_FAILED = ['UPI payment failed', 'Cheque bounced', 'Auto-debit failed'];

export const VANMOH_COMMENTS = [
  'Wants to join the ₹1 lakh 20-month group, asked for the next start date.',
  'Prefers weekly doorstep collection — Saturday mornings.',
  'Will pay this month’s instalment after salary on the 5th.',
  'Asked how the auction discount and dividend work, explained.',
  'Comparing with a bank RD, wants the returns in writing.',
  'Husband decides — call back in the evening.',
  'Wants to bid in the coming auction for a family function.',
  'Happy with the collection agent, may take a second ticket.',
  'Asked for the branch address in Gandhipuram.',
  'Busy at the shop now, call after 7 pm.',
];

export const VANMOH_REROUTES: { lang: Language; reason: string }[] = [
  { lang: 'Malayalam', reason: 'Speaks Malayalam (Palakkad), agent has Tamil only' },
  { lang: 'English', reason: 'Prefers English, current agent is Tamil-only' },
];

export const VANMOH_ESCALATIONS = [
  'Wants to bid in this month’s auction — needs approval',
  'Disputes the dividend amount for last month',
  'Wants to close the chit early',
  'Wants to speak to the branch manager',
];

export const VANMOH_CLEARED = ['Selvi K', 'Murugan R', 'Chitra P', 'Elango S', 'Gomathi V'];
export const VANMOH_CLEARED_ACTIONS = ['Reroute → Malayalam', 'Escalation → auction', 'Reroute → English', 'Escalation → dividend'];
export const VANMOH_CLEARED_RESULTS = ['Approved · reassigned', 'Closed · bid allowed', 'Declined · handled in Tamil', 'Approved · statement sent'];

export const VANMOH_AUDIT = [
  { minutesAgo: 35, actorId: 'lakshmi-v', actorName: 'Lakshmi V', action: 'access_changed' as const, target: 'Manikandan P', detail: 'Queues: New enquiries (was none)' },
  { minutesAgo: 190, actorId: 'lakshmi-v', actorName: 'Lakshmi V', action: 'escalation_approved' as const, target: 'Selvi K', detail: 'Reroute → Malayalam · reassigned' },
  { minutesAgo: 60 * 26, actorId: 'owner-1', actorName: 'Owner', action: 'access_changed' as const, target: 'Saravanan K', detail: 'Vanmoh Chit Funds: added Handle payments' },
  { minutesAgo: 60 * 24 * 30, actorId: 'owner-1', actorName: 'Owner', action: 'user_created' as const, target: 'Manikandan P', detail: 'Agent · trainee · Vanmoh Chit Funds' },
];

type Line = { speaker: 'agent' | 'customer'; offsetSec: number; text: string };

/** Demo-only analysis (source: 'sample') for the generated subscribers. Real calls are analysed from their recording. */
export function vanmohSampleAnalysis(r: Rng, at: number, customerName: string, outcome: Outcome | undefined): CallAnalysis {
  const first = customerName.split(' ')[0];
  const positive = outcome && ['Interested', 'Very interested', 'Ready to subscribe', 'Created first listing'].includes(outcome);
  const negative = outcome && ['Not interested', 'Using competitor'].includes(outcome);
  const issue = outcome && ['Payment issue', 'Technical issue'].includes(outcome);
  let sentiment: number;
  let summary: string;
  let topics: string[];
  let objections: string[] = [];
  let actions: string[];
  let lines: Line[];
  if (positive) {
    sentiment = 0.7 + r.float() * 0.25;
    summary = `${first} wants to join the ₹1 lakh 20-month group and asked about the next auction date and weekly doorstep collection.`;
    topics = ['new_group', 'auction_date', 'doorstep_collection'];
    actions = ['Send group details and KYC list on WhatsApp', 'Book the collection agent for Saturday'];
    lines = [
      { speaker: 'agent', offsetSec: 3, text: `Vanakkam ${first}, Vanmoh Chit Funds-la irundhu pesuren. You enquired about our chit schemes?` },
      { speaker: 'customer', offsetSec: 14, text: 'Aamaa, the ₹1 lakh scheme for 20 months. How much is the monthly amount?' },
      { speaker: 'agent', offsetSec: 27, text: '₹5,000 a month, or ₹1,250 weekly — our agent collects at your door. The new group starts on the 1st.' },
      { speaker: 'customer', offsetSec: 45, text: 'Weekly is better for me. When is the auction, and what documents do you need?' },
      { speaker: 'agent', offsetSec: 60, text: 'Auction is on the 10th of every month. Aadhaar, PAN and one photo. I will send the list on WhatsApp now.' },
    ];
  } else if (negative) {
    sentiment = -0.5 - r.float() * 0.35;
    if (outcome === 'Using competitor') {
      summary = `${first} already saves in a bank RD and another local chit; not ready to take a new ticket now.`;
      topics = ['bank_rd', 'other_chit_company'];
      objections = ['Already in another chit group', 'Trusts the bank RD more'];
      actions = ['Note the other chit’s end month', 'Call again when it completes'];
      lines = [
        { speaker: 'agent', offsetSec: 4, text: `Hello ${first}, calling from Vanmoh about the new 20-month group.` },
        { speaker: 'customer', offsetSec: 15, text: 'I am already paying another chit and a bank RD. I cannot take one more now.' },
        { speaker: 'agent', offsetSec: 30, text: 'Understood. When does your current chit finish? We can talk then.' },
        { speaker: 'customer', offsetSec: 44, text: 'March, maybe. Call me after that.' },
      ];
    } else {
      summary = `${first} is not interested in joining a chit at this time.`;
      topics = ['declined'];
      objections = ['No spare money each month right now'];
      actions = ['Pause calls for 60 days'];
      lines = [
        { speaker: 'agent', offsetSec: 3, text: `Vanakkam ${first}, this is Vanmoh Chit Funds.` },
        { speaker: 'customer', offsetSec: 12, text: 'Not interested now, there is no extra money every month.' },
        { speaker: 'agent', offsetSec: 25, text: 'No problem. We have a ₹10,000 scheme at ₹50 a day if that ever suits you.' },
      ];
    }
  } else if (issue) {
    sentiment = r.float() * 0.2 - 0.1;
    summary = `${first} paid this month’s instalment by UPI but has no receipt, and the collection agent missed last week.`;
    topics = ['instalment_receipt', 'missed_collection'];
    actions = ['Match the UPI reference with accounts and send the receipt', 'Tell the collection agent about the missed visit'];
    lines = [
      { speaker: 'agent', offsetSec: 4, text: `Hello ${first}, calling about your instalment for this month.` },
      { speaker: 'customer', offsetSec: 13, text: 'I paid ₹2,500 on GPay on the 3rd, but no receipt came. And nobody came to collect last week.' },
      { speaker: 'agent', offsetSec: 30, text: 'Sorry about that. Please send the UPI reference on WhatsApp — I will get the receipt to you today.' },
      { speaker: 'customer', offsetSec: 46, text: 'Okay, sending it now.' },
    ];
  } else {
    sentiment = 0.25 + r.float() * 0.2;
    summary = `Instalment reminder call with ${first}. Will pay on time this month.`;
    topics = ['instalment_reminder'];
    actions = ['Confirm collection on the due date'];
    lines = [
      { speaker: 'agent', offsetSec: 3, text: `Vanakkam ${first}, a reminder that your instalment is due this week.` },
      { speaker: 'customer', offsetSec: 12, text: 'Yes, I know. Ask the agent to come on Friday.' },
      { speaker: 'agent', offsetSec: 22, text: 'Done, Friday morning. Thank you!' },
    ];
  }
  return {
    source: 'sample',
    at,
    outcome: outcome ?? 'Call back later',
    summary,
    keyPoints: topics.map((t) => t.replace(/_/g, ' ')),
    objections,
    actionItems: actions,
    recommendation: actions[0],
    sentiment: Math.round((Math.max(-1, Math.min(1, sentiment)) + 1) * 50),
    languages: ['Tamil', 'English'],
    transcript: lines.map((l) => ({ speaker: l.speaker, atSec: l.offsetSec, text: l.text })),
  };
}
