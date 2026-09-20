import type { CallLogEntry, CallTranscript, CustomerUser } from '../data/types';

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

/** Returns the history with `transcript` set on one entry (other entries keep their identity). */
export function withTranscript(history: CallLogEntry[], entryId: string, transcript: CallTranscript): CallLogEntry[] {
  return history.map((e) => (e.id === entryId ? { ...e, transcript } : e));
}

/** True for a genuine TeleCMI file name; older builds stored an invented `rec_….wav` here. */
export function hasRealRecording(file: string | undefined): file is string {
  return !!file && !file.startsWith('rec_');
}

/**
 * Removes data earlier builds invented for real (softphone) calls: `rec_…` file names, and "AI analytics" that
 * were only a template built from the outcome the agent clicked. Returns the same array when there was nothing to clean.
 */
export function cleanLegacyCallData(users: CustomerUser[]): CustomerUser[] {
  const dirty = (e: CallLogEntry) => e.telephony?.provider === 'telecmi' && (e.analytics?.source === 'server_webhook' || (e.telephony.recordingFile !== undefined && !hasRealRecording(e.telephony.recordingFile)));
  if (!users.some((u) => u.callHistory.some(dirty))) return users;
  return users.map((u) =>
    u.callHistory.some(dirty)
      ? {
          ...u,
          callHistory: u.callHistory.map((e) => {
            if (!dirty(e)) return e;
            const { analytics, ...rest } = e;
            void analytics;
            const t = e.telephony ? { ...e.telephony } : undefined;
            if (t && !hasRealRecording(t.recordingFile)) {
              delete t.recordingFile;
              delete t.recordingUrl;
            }
            return { ...rest, telephony: t, ...(e.analytics && e.analytics.source !== 'server_webhook' ? { analytics: e.analytics } : {}) };
          }),
        }
      : u,
  );
}
