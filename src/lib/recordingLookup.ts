// The recording TeleCMI announced for a call, from TCC's server (filled by TeleCMI's call-detail webhook). Unlike the
// softphone's own call records it needs no open softphone session, so it works after the agent has signed out.

import type { RecordingQuery } from '../telephony/core/types';

/** The file name, or undefined when the server has none yet (or no server / not signed in). Never throws. */
export async function serverRecording(q: RecordingQuery): Promise<string | undefined> {
  try {
    const qs = new URLSearchParams({ remote: q.remote, startedAt: String(q.startedAt), ...(q.direction ? { direction: q.direction } : {}) });
    const res = await fetch(`/api/recording-lookup?${qs}`, { credentials: 'same-origin' });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { file?: string | null };
    return typeof body.file === 'string' && body.file ? body.file : undefined;
  } catch {
    return undefined;
  }
}
