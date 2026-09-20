import type { MediaStats } from '../telephony';

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

export const QUEUES: QueueDef[] = [
  { key: 'new', order: 1, label: 'New registrations', short: 'New' },
  { key: 'tickets', order: 2, label: 'Tickets & flags', short: 'Tickets' },
  { key: 'payments', order: 3, label: 'Payments & dues', short: 'Payments' },
  { key: 'followup', order: 4, label: 'Positive follow-up', short: 'Follow-up' },
  { key: 'errors', order: 5, label: 'Errors & drop-offs', short: 'Errors' },
  { key: 'inactive', order: 6, label: 'Inactive 30+ days', short: 'Inactive' },
];

export type AppId = 'realbroks' | 'irondrobe' | 'influnet' | 'vehigo';

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

export interface AgentAccount {
  id: string;
  name: string;
  username: string;
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

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'churn_risk';

export interface TranscriptMessage {
  speaker: 'agent' | 'customer';
  text: string;
  offsetSec: number;
}

export interface CallAnalytics {
  sentiment: Sentiment;
  sentimentScore: number;
  summary: string;
  keyTopics: string[];
  actionItems: string[];
  transcript: TranscriptMessage[];
  /** True when captured directly from agent's live microphone via browser Web Speech API. */
  isLiveCaptured?: boolean;
  /** Origin of the transcript/analytics. */
  source?: 'live_stt' | 'simulation' | 'server_webhook';
}

// Telephony details for calls placed through the in-app softphone (absent for calls logged by hand).
export interface CallTelephony {
  provider: string;
  callId: string | null;
  durationSec: number;
  ringSec: number;
  disposition: string;
  /** Audio recording filename as reported by TeleCMI (e.g. "rec_123456.wav"). */
  recordingFile?: string;
  /** Full streamable/downloadable URL for the call recording. */
  recordingUrl?: string;
  /** Last WebRTC media-quality sample before the call ended — which audio direction failed. Absent on older entries. */
  quality?: MediaStats;
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
  telephony?: CallTelephony;
  /** AI speech-to-text transcription, sentiment score, and conversational analytics. */
  analytics?: CallAnalytics;
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
}

// The subset of CustomerUser that TCC itself owns and writes live to
// Firestore, keyed by customer id. Everything else on CustomerUser is master
// data — generated for now, destined to come from the existing app database.
export type CustomerOverlay = Pick<
  CustomerUser,
  'queue' | 'attempt' | 'callHistory' | 'tickets' | 'paymentDue' | 'followUp' | 'paying' | 'plan' | 'planNote' | 'mrr' | 'stageTag' | 'ownerAgentId' | 'hasActiveEscalation' | 'language'
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
  };
}
