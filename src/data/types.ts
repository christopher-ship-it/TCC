import type { MediaStats } from '../telephony';
import type { CallAnalysis } from '../lib/analysis/model';
import type { LevelSample } from '../lib/analysis/speakers';
import { BRAND } from '../brand';

export type { CallAnalysis, LevelSample };

export type QueueKey = 'new' | 'tickets' | 'payments' | 'followup' | 'errors' | 'inactive';

/** One-line diagnosis of which audio direction failed, from the last WebRTC stats sample. */
export function telephonyQualitySummary(q: MediaStats | undefined | null): string | null {
  if (!q) return null;
  const sent = q.packetsSent;
  const received = q.packetsReceived;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const delay = q.roundTripSec !== undefined ? ` · delay ${Math.round(q.roundTripSec * 1000)}ms` : '';
  if (sent === 0 && received === 0) return 'No media';
  if (sent === 0) return 'No audio sent — microphone uplink is dead';
  if (q.remoteFractionLost !== undefined && q.remoteFractionLost >= 0.5) return `One-way audio — they received almost nothing (${pct(q.remoteFractionLost)} lost)`;
  if (received === 0) return 'No audio received — you would not hear them';
  const downLost = q.packetsLost !== undefined && q.packetsReceived !== undefined ? q.packetsLost / (q.packetsLost + q.packetsReceived) : undefined;
  if (downLost !== undefined && downLost >= 0.05) return `Loss ${pct(downLost)}${delay}`;
  if (q.jitterSec !== undefined && q.jitterSec >= 0.06) return `Jitter ${Math.round(q.jitterSec * 1000)}ms${delay}`;
  return 'Both directions flowing';
}

export interface QueueDef {
  key: QueueKey;
  order: number;
  label: string;
  short: string;
}

export const QUEUES: QueueDef[] = ([
  { key: 'new', order: 1, label: 'New registrations', short: 'New' },
  { key: 'tickets', order: 2, label: 'Tickets & flags', short: 'Tickets' },
  { key: 'payments', order: 3, label: 'Payments & dues', short: 'Payments' },
  { key: 'followup', order: 4, label: 'Positive follow-up', short: 'Follow-up' },
  { key: 'errors', order: 5, label: 'Errors & drop-offs', short: 'Errors' },
  { key: 'inactive', order: 6, label: 'Inactive 30+ days', short: 'Inactive' },
] as QueueDef[]).map((q) => ({ ...q, ...BRAND.queueLabels[q.key] }));

/** Tecstellar's apps, plus each white-label client's own line of business (src/brand). */
export type AppId = 'realbroks' | 'irondrobe' | 'influnet' | 'vehigo' | 'vanmoh';

export interface AppDef {
  id: AppId;
  name: string;
  tagline: string;
  logo: string;
  live: boolean;
}

export type Language = 'Tamil' | 'Telugu' | 'Kannada' | 'Malayalam' | 'Hindi' | 'Bengali' | 'English';

export interface StateDef {
  name: string;
  lon: number;
  lat: number;
  language: Language;
}

export type Role = 'agent' | 'supervisor' | 'admin';

/** What a person may do inside one app. Queues, languages and states then narrow which customers they see. */
export type Capability = 'call' | 'tickets' | 'payments' | 'recordings' | 'export';

export type AccountStatus = 'active' | 'invited' | 'suspended';

export interface AgentAccount {
  id: string;
  name: string;
  username: string;
  /** The Firebase Auth login (Firestore backend). Not used by the local demo store. */
  email?: string;
  role: Role;
  trainee?: boolean;
  apps: AppId[];
  queues: QueueKey[];
  languages: Language[];
  states: string[];
  dailyTarget: number;
  clickToDial: boolean;
  /** Softphone login (TeleCMI user id, e.g. "101_33338836"). The password is never stored — the agent types it per session. */
  telecmiUserId?: string;
  /** Tecstellar's own account on a client deployment: sees and repairs everything; client admins never see it. */
  superAdmin?: boolean;
  /** Suspended people cannot sign in. Missing on older records = active. */
  status?: AccountStatus;
  /** Per-app capabilities. Missing for an app = the role's defaults (src/lib/access.ts). */
  capabilities?: Partial<Record<AppId, Capability[]>>;
  phone?: string;
  createdTs?: number;
  lastActiveLabel: string;
  todayCalls: number;
  todayConnected: number;
  todayPositive: number;
  todaySubscribed: number;
  todayOverdue: number;
  avgHandleLabel: string;
  workingQueueLabel: string;
}

export type CallStatus = 'Answered — DG' | 'Answered — DNG' | 'Answered — Followup' | 'Not Reachable' | 'No Answer';

export type Outcome =
  | 'Interested'
  | 'Very interested'
  | 'Ready to subscribe'
  | 'Created first listing'
  | 'Payment issue'
  | 'Technical issue'
  | 'Not interested'
  | 'Using competitor';

export const NEGATIVE_OUTCOMES: Outcome[] = ['Not interested', 'Using competitor'];
export const POSITIVE_OUTCOMES: Outcome[] = ['Interested', 'Very interested', 'Ready to subscribe', 'Created first listing'];

/** How a customer says they came to know about the app (asked on answered calls). */
export const LEAD_SOURCES = ['Instagram', 'Facebook', 'Telecalling', 'Google/YouTube', 'Referral', 'Other'] as const;

export const CALL_STATUS_LIST: { status: CallStatus; key: string }[] = [
  { status: 'Answered — DG', key: '1' },
  { status: 'Answered — DNG', key: '2' },
  { status: 'Answered — Followup', key: '3' },
  { status: 'Not Reachable', key: '4' },
  { status: 'No Answer', key: '5' },
];

export const OUTCOME_LIST: { outcome: Outcome; key: string; note?: string }[] = [
  { outcome: 'Interested', key: 'q', note: 'positive' },
  { outcome: 'Very interested', key: 'w' },
  { outcome: 'Ready to subscribe', key: 'e' },
  { outcome: 'Created first listing', key: 'r' },
  { outcome: 'Payment issue', key: 't' },
  { outcome: 'Technical issue', key: 'y' },
  { outcome: 'Not interested', key: 'u', note: 'exits chain' },
  { outcome: 'Using competitor', key: 'i' },
];

// Telephony details for calls placed through the in-app softphone (absent for calls logged by hand).
export interface CallTelephony {
  provider: string;
  callId: string | null;
  durationSec: number;
  ringSec: number;
  disposition: string;
  /** 'inbound' for a call the agent took; absent (outbound) on calls the agent placed and on older entries. */
  direction?: 'inbound' | 'outbound';
  /** When the call started (epoch ms) and the number dialled — what a recording lookup is matched on. */
  startedAt?: number;
  remote?: string;
  /** Audio recording filename as reported by TeleCMI (e.g. "rec_123456.wav"). */
  recordingFile?: string;
  /** Full streamable/downloadable URL for the call recording. */
  recordingUrl?: string;
  /** Last WebRTC media-quality sample before the call ended — which audio direction failed. Absent on older entries. */
  quality?: MediaStats;
  /** Per-second loudness of each side, [seconds, agent, customer] — who spoke when. */
  levels?: LevelSample[];
}

export interface CallLogEntry {
  id: string;
  atLabel: string;
  atTs: number;
  agentName: string;
  status: CallStatus;
  outcome?: Outcome;
  comment: string;
  auto?: boolean;
  /** Answered calls: how they came to know about the app (LEAD_SOURCES). */
  source?: string;
  /** The day the agent (or the automatic chain) said to call them again, start of day. */
  followUpTs?: number;
  telephony?: CallTelephony;
  /** Post-call analysis: transcript, summary, sentiment, objections, next step (src/lib/analysis). */
  analysis?: CallAnalysis;
  /** Why the last analysis attempt failed, when it did. */
  analysisError?: string;
}

export type AuditAction =
  | 'signed_in'
  | 'signed_out'
  | 'user_created'
  | 'access_changed'
  | 'user_suspended'
  | 'user_reactivated'
  | 'escalation_approved'
  | 'escalation_declined'
  | 'owner_reassigned'
  | 'queues_distributed'
  | 'payment_marked_paid'
  | 'data_exported'
  | 'customers_imported'
  | 'customer_deleted';

/** One line of the change log: who did what to whom. Everything an admin needs to answer "who changed this?". */
export interface AuditEntry {
  id: string;
  ts: number;
  actorId: string;
  actorName: string;
  action: AuditAction;
  /** Who or what was changed (a person, a customer, a list). */
  target?: string;
  detail: string;
}

export interface TicketRecord {
  id: string;
  subject: string;
  raisedAtLabel: string;
  slaBreached: boolean;
}

export interface PaymentDue {
  amount: number;
  dueLabel: string;
  status: 'upcoming' | 'overdue' | 'expired';
}

export interface FollowUpChain {
  weekNumber: number;
  nextDueLabel: string;
  markedPositiveLabel: string;
  state: 'due-today' | 'pending' | 'overdue';
  overdueDays?: number;
}

export interface EscalationRecord {
  id: string;
  type: 'reroute' | 'escalation';
  userId: string;
  userName: string;
  userCity: string;
  app: AppId;
  raisedAtLabel: string;
  raisedTs: number;
  raisedByAgentId: string;
  reason: string;
  urgency?: 'normal' | 'urgent';
  targetLanguage?: Language;
  suggestedOwnerId?: string;
  note: string;
  status: 'pending' | 'approved' | 'declined';
  resolutionNote?: string;
  resolvedLabel?: string;
  clearMinutes?: number;
}

export interface CustomerUser {
  id: string;
  shopCode: string;
  name: string;
  business: string;
  app: AppId;
  phone: string;
  city: string;
  state: string | null;
  effectiveState: string;
  language: Language;
  registeredAtLabel: string;
  registeredDaysAgo: number;
  plan: 'Free' | 'Paid';
  planNote?: string;
  listings: number;
  buyers: number;
  lastOpenLabel: string;
  appVersion: string;
  conversionScore: number;
  stageTag: string;
  queue: QueueKey | null;
  attempt: number;
  callHistory: CallLogEntry[];
  tickets: TicketRecord[];
  paymentDue?: PaymentDue;
  followUp?: FollowUpChain;
  paying: boolean;
  active: boolean;
  hasActiveEscalation?: boolean;
  ownerAgentId: string | null;
  mrr?: number;
  /** Who they are, from the product's own list (src/data/products.ts). Unset until imported or an agent picks it. */
  customerType?: string;
  /** Made on the spot by dialling a number that isn't a customer yet (Workspace › Dial a number). */
  adHoc?: boolean;
  /** Added by hand by an agent (Add customer). Stays in the owner's queue only, whatever their languages and states. */
  manual?: boolean;
  /** Free-text note from whoever added the customer. */
  note?: string;
  /** Set when someone removed the customer (a test record, a duplicate). Kept, hidden from every list, and shown on the page with who and why. `null` = brought back. */
  /** How they came to know about the app, from the last answered call that asked. */
  source?: string;
  /** The next call to make: a day the agent chose, or the next of the automatic daily calls. Overrides the queue until then. */
  callback?: { dueTs: number; auto: boolean };
  /** First call unanswered: TCC calls again every day for 14 days (src/lib/followUps.ts). Gone once they answer or the days run out. */
  autoFollowUp?: { startedTs: number; attempts: number };
  deleted?: { byId: string; byName: string; reason: string; ts: number; atLabel: string } | null;
}

// The subset of CustomerUser that TCC itself owns and writes live to
// Firestore, keyed by customer id. Everything else on CustomerUser is master
// data — generated for now, destined to come from the existing app database.
export type CustomerOverlay = Pick<
  CustomerUser,
  'queue' | 'attempt' | 'callHistory' | 'tickets' | 'paymentDue' | 'followUp' | 'paying' | 'plan' | 'planNote' | 'mrr' | 'stageTag' | 'ownerAgentId' | 'hasActiveEscalation' | 'language' | 'customerType' | 'source' | 'callback' | 'autoFollowUp'
>;

export function overlayFromUser(u: CustomerUser): CustomerOverlay {
  return {
    queue: u.queue,
    attempt: u.attempt,
    callHistory: u.callHistory,
    tickets: u.tickets,
    paymentDue: u.paymentDue,
    followUp: u.followUp,
    paying: u.paying,
    plan: u.plan,
    planNote: u.planNote,
    mrr: u.mrr,
    stageTag: u.stageTag,
    ownerAgentId: u.ownerAgentId,
    hasActiveEscalation: u.hasActiveEscalation,
    language: u.language,
    customerType: u.customerType,
    source: u.source,
    callback: u.callback,
    autoFollowUp: u.autoFollowUp,
  };
}
