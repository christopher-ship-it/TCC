// Numbers derived from call logs — shared by the customer page, team pages and the owner dashboard.

import type { AgentAccount, AppId, CallLogEntry, CustomerUser } from '../data/types';
import { NEGATIVE_OUTCOMES, POSITIVE_OUTCOMES } from '../data/types';
import { sentimentBand } from './analysis/model';
import { talkShare } from './analysis/speakers';
import { fmtDay } from './dates';

export interface CallRow {
  user: CustomerUser;
  call: CallLogEntry;
}

export const DAY = 86400000;

export function isConnected(c: CallLogEntry): boolean {
  return c.status.startsWith('Answered') || (c.telephony?.durationSec ?? 0) > 0;
}

/** Every logged call, newest first, optionally limited to some apps / agents / a time window. */
export function allCalls(users: CustomerUser[], opts: { apps?: AppId[]; agentName?: string; since?: number } = {}): CallRow[] {
  const out: CallRow[] = [];
  for (const user of users) {
    if (opts.apps && !opts.apps.includes(user.app)) continue;
    if (user.deleted) continue;
    for (const call of user.callHistory) {
      if (opts.agentName && call.agentName !== opts.agentName) continue;
      if (opts.since && call.atTs < opts.since) continue;
      out.push({ user, call });
    }
  }
  return out.sort((a, b) => b.call.atTs - a.call.atTs);
}

export interface DayBucket {
  ts: number;
  label: string;
  connected: number;
  missed: number;
  positive: number;
  talkSec: number;
}

/** Calls per day for the last `days` days (oldest first). */
export function callsByDay(rows: CallRow[], days: number, now = Date.now()): DayBucket[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const first = start.getTime() - (days - 1) * DAY;
  const buckets: DayBucket[] = Array.from({ length: days }, (_, i) => ({ ts: first + i * DAY, label: fmtDay(first + i * DAY), connected: 0, missed: 0, positive: 0, talkSec: 0 }));
  for (const { call } of rows) {
    const i = Math.floor((call.atTs - first) / DAY);
    if (i < 0 || i >= days) continue;
    if (isConnected(call)) buckets[i].connected++;
    else buckets[i].missed++;
    if (call.outcome && POSITIVE_OUTCOMES.includes(call.outcome)) buckets[i].positive++;
    buckets[i].talkSec += call.telephony?.durationSec ?? 0;
  }
  return buckets;
}

export function outcomeCounts(rows: CallRow[]): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const { call } of rows) {
    const key = call.outcome ?? (isConnected(call) ? 'Answered, no outcome' : call.status);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export interface SentimentSummary {
  analysed: number;
  positive: number;
  neutral: number;
  negative: number;
  average: number | null;
  /** Analysed calls that went badly, newest first — what a supervisor should listen to. */
  flagged: CallRow[];
}

export function sentimentSummary(rows: CallRow[]): SentimentSummary {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let sum = 0;
  let n = 0;
  const flagged: CallRow[] = [];
  for (const row of rows) {
    const s = row.call.analysis?.sentiment;
    const band = sentimentBand(s);
    if (!band || s === null || s === undefined) continue;
    n++;
    sum += s;
    if (band === 'positive') positive++;
    else if (band === 'neutral') neutral++;
    else {
      negative++;
      flagged.push(row);
    }
  }
  return { analysed: n, positive, neutral, negative, average: n ? Math.round(sum / n) : null, flagged };
}

export interface AgentScore {
  agent: AgentAccount;
  calls: number;
  connected: number;
  positive: number;
  converted: number;
  talkSec: number;
  avgSentiment: number | null;
}

export function agentScores(rows: CallRow[], agents: AgentAccount[]): AgentScore[] {
  return agents
    .filter((a) => a.role === 'agent')
    .map((agent) => {
      const mine = rows.filter((r) => r.call.agentName === agent.name);
      const s = sentimentSummary(mine);
      return {
        agent,
        calls: mine.length,
        connected: mine.filter((r) => isConnected(r.call)).length,
        positive: mine.filter((r) => r.call.outcome && POSITIVE_OUTCOMES.includes(r.call.outcome)).length,
        converted: mine.filter((r) => r.call.outcome === 'Ready to subscribe').length,
        talkSec: mine.reduce((n, r) => n + (r.call.telephony?.durationSec ?? 0), 0),
        avgSentiment: s.average,
      };
    })
    .sort((a, b) => b.connected - a.connected);
}

export interface CustomerCallPoint {
  call: CallLogEntry;
  sentiment: number | null;
  talkSec: number;
  agentShare: number | null;
}

/** One point per call for a customer's journey, oldest first. */
export function customerJourney(user: CustomerUser): CustomerCallPoint[] {
  return [...user.callHistory]
    .sort((a, b) => a.atTs - b.atTs)
    .map((call) => {
      const share = call.analysis ? talkShare(call.telephony?.levels, call.analysis.transcript) : null;
      const total = share ? share.agent + share.customer : 0;
      return {
        call,
        sentiment: call.analysis?.sentiment ?? null,
        talkSec: call.telephony?.durationSec ?? 0,
        agentShare: share && total > 0 ? share.agent / total : null,
      };
    });
}

/** Where a customer stands, in one phrase. */
export function journeyVerdict(user: CustomerUser): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  const last = user.callHistory.find((c) => c.outcome);
  if (user.paying) return { label: 'Paying customer', tone: 'ok' };
  if (last?.outcome && NEGATIVE_OUTCOMES.includes(last.outcome)) return { label: 'Exited — said no', tone: 'danger' };
  if (user.paymentDue?.status === 'overdue' || user.paymentDue?.status === 'expired') return { label: 'Payment overdue', tone: 'warn' };
  if (last?.outcome && POSITIVE_OUTCOMES.includes(last.outcome)) return { label: 'Warm lead', tone: 'ok' };
  if (!user.callHistory.some(isConnected)) return { label: 'Not reached yet', tone: 'neutral' };
  return { label: 'In conversation', tone: 'neutral' };
}

export function durationLabel(totalSec: number): string {
  if (totalSec <= 0) return '0m';
  if (totalSec < 60) return `${Math.round(totalSec)}s`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** CSV text for a list of calls — the "Export" action. */
export function callsCsv(rows: CallRow[], appName: (id: AppId) => string): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['When', 'App', 'Customer', 'Business', 'Phone', 'Agent', 'Status', 'Outcome', 'Talk seconds', 'Sentiment', 'Summary', 'Comment'];
  const lines = rows.map(({ user, call }) =>
    [new Date(call.atTs).toISOString(), appName(user.app), user.name, user.business, user.phone, call.agentName, call.status, call.outcome ?? '', call.telephony?.durationSec ?? 0, call.analysis?.sentiment ?? '', call.analysis?.summary ?? '', call.comment].map(esc).join(','),
  );
  return [head.map(esc).join(','), ...lines].join('\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
