import type { CallAnalysis, CallLogEntry, CustomerUser } from '../data/types';

const RECENT_MS = 15 * 60 * 1000;

/**
 * Attach a recording that TeleCMI announced after the call was already logged.
 * Match by the provider's call id when it is known; otherwise fall back to the newest real
 * (softphone) call that still has no recording and was logged in the last 15 minutes.
 * Returns the customer and their updated history, or null when nothing plausible matches.
 */
export function attachRecording(
  users: CustomerUser[],
  file: string,
  url: string,
  callId: string | undefined,
  now: number,
  entryId?: string,
): { userId: string; callHistory: CallLogEntry[] } | null {
  if (entryId) {
    for (const user of users) {
      const hit = user.callHistory.find((e) => e.id === entryId);
      if (hit?.telephony) return patch(user, hit, file, url);
    }
    return null;
  }
  let best: { user: CustomerUser; entry: CallLogEntry } | null = null;
  for (const user of users) {
    for (const entry of user.callHistory) {
      const t = entry.telephony;
      if (!t || t.provider !== 'telecmi' || hasRealRecording(t.recordingFile)) continue;
      if (callId && t.callId === callId) return patch(user, entry, file, url);
      if (now - entry.atTs <= RECENT_MS && (!best || entry.atTs > best.entry.atTs)) best = { user, entry };
    }
  }
  return best ? patch(best.user, best.entry, file, url) : null;
}

function patch(user: CustomerUser, target: CallLogEntry, file: string, url: string) {
  return {
    userId: user.id,
    callHistory: user.callHistory.map((e) => (e === target && e.telephony ? { ...e, telephony: { ...e.telephony, recordingFile: file, recordingUrl: url || undefined } } : e)),
  };
}

/** Returns the history with one entry's analysis (or the reason it failed) set; other entries keep their identity. */
export function withAnalysis(history: CallLogEntry[], entryId: string, analysis: CallAnalysis | undefined, error?: string): CallLogEntry[] {
  return history.map((e) => {
    if (e.id !== entryId) return e;
    const next: CallLogEntry = { ...e, analysis: analysis ?? e.analysis };
    if (error) next.analysisError = error;
    else delete next.analysisError;
    return next;
  });
}

/** True for a genuine TeleCMI file name; older builds stored an invented `rec_….wav` here. */
export function hasRealRecording(file: string | undefined): file is string {
  return !!file && !file.startsWith('rec_');
}

/** What earlier builds stored on a call log entry before `analysis` existed. */
interface LegacyEntry extends CallLogEntry {
  analytics?: {
    sentiment?: string;
    sentimentScore?: number;
    summary?: string;
    keyTopics?: string[];
    actionItems?: string[];
    transcript?: { speaker: 'agent' | 'customer'; text: string; offsetSec: number }[];
    source?: string;
  };
  transcript?: { text: string; language?: string; segments: { start: number; text: string }[]; model: string; at: number };
}

const humanise = (topic: string) => topic.replace(/_/g, ' ');

function migrate(e: LegacyEntry): CallLogEntry {
  const { analytics, transcript, ...rest } = e;
  const real = e.telephony?.provider === 'telecmi';
  const out: CallLogEntry = { ...rest };
  if (out.telephony && real && !hasRealRecording(out.telephony.recordingFile)) {
    const t = { ...out.telephony };
    delete t.recordingFile;
    delete t.recordingUrl;
    out.telephony = t;
  }
  if (out.analysis) return out;
  if (transcript) {
    out.analysis = {
      source: 'whisper',
      model: transcript.model,
      at: transcript.at,
      summary: '',
      keyPoints: [],
      objections: [],
      actionItems: [],
      sentiment: null,
      languages: transcript.language ? [transcript.language] : [],
      transcript: transcript.segments.map((s) => ({ speaker: 'unknown' as const, atSec: s.start, text: s.text })),
    };
  } else if (analytics && !real) {
    // Template analytics on a real call were never real, so they are dropped; on demo calls they become labelled sample data.
    out.analysis = {
      source: 'sample',
      at: e.atTs,
      summary: analytics.summary ?? '',
      keyPoints: (analytics.keyTopics ?? []).map(humanise),
      objections: [],
      actionItems: analytics.actionItems ?? [],
      sentiment: typeof analytics.sentimentScore === 'number' ? Math.round((Math.max(-1, Math.min(1, analytics.sentimentScore)) + 1) * 50) : null,
      languages: [],
      transcript: (analytics.transcript ?? []).map((l) => ({ speaker: l.speaker, atSec: l.offsetSec, text: l.text })),
    };
  }
  return out;
}

/**
 * Brings stored call logs up to the current shape: legacy `analytics` / `transcript` fields become `analysis`,
 * and data earlier builds invented for real (softphone) calls — `rec_…` file names, template "AI analytics" —
 * is removed. Returns the same array when there was nothing to change.
 */
export function cleanLegacyCallData(users: CustomerUser[]): CustomerUser[] {
  const dirty = (e: LegacyEntry) =>
    e.analytics !== undefined || e.transcript !== undefined || (e.telephony?.provider === 'telecmi' && e.telephony.recordingFile !== undefined && !hasRealRecording(e.telephony.recordingFile));
  if (!users.some((u) => u.callHistory.some(dirty))) return users;
  return users.map((u) => (u.callHistory.some(dirty) ? { ...u, callHistory: u.callHistory.map((e) => (dirty(e) ? migrate(e) : e)) } : u));
}
