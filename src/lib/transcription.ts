// Getting a call analysed. First choice is TCC's server (/api/analyze → Gemini: transcript, summary, sentiment,
// objections, next step). When the server has no Gemini key, the local Whisper sidecar (tools/transcribe,
// `npm run transcribe`) can still produce a bare transcript.

import type { CallAnalysis, CallLogEntry, CustomerUser, Language } from '../data/types';
import { TEST_NUMBER } from './telephony';

export const TRANSCRIBE_URL = ((import.meta.env.VITE_TRANSCRIBE_URL as string | undefined)?.trim() || 'http://127.0.0.1:8787').replace(/\/$/, '');

const LANGUAGE_CODES: Record<Language, string> = { Tamil: 'ta', Telugu: 'te', Kannada: 'kn', Malayalam: 'ml', Hindi: 'hi', Bengali: 'bn', English: 'en' };

/** The customer's language as a Whisper hint. Skipped in test mode, where the person on the phone is the tester, not the customer. */
export function languageHint(language?: Language): string | undefined {
  return TEST_NUMBER || !language ? undefined : LANGUAGE_CODES[language];
}

export class AnalysisUnavailable extends Error {}

export interface ServerHealth {
  ok: boolean;
  analysis: boolean;
  recordings: boolean;
  telecmiAppId: boolean;
}

let health: Promise<ServerHealth | null> | null = null;

/** What TCC's server can do on this machine. Null when no server is reachable (a static build). */
export function serverHealth(): Promise<ServerHealth | null> {
  health ??= fetch('/api/health')
    .then((r) => (r.ok ? (r.json() as Promise<ServerHealth>) : null))
    .catch(() => null);
  return health;
}

async function viaServer(entry: CallLogEntry, user: CustomerUser): Promise<CallAnalysis> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file: entry.telephony?.recordingFile,
      customer: TEST_NUMBER ? undefined : user.name,
      business: TEST_NUMBER ? undefined : user.business,
      app: user.app,
      levels: entry.telephony?.levels,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { analysis?: CallAnalysis; error?: string; notConfigured?: boolean };
  if (res.status === 501 && body.notConfigured) throw new AnalysisUnavailable(body.error ?? 'Analysis is not configured.');
  if (!res.ok || !body.analysis) throw new Error(body.error ?? `Analysis failed (${res.status})`);
  return body.analysis;
}

async function viaWhisper(file: string, language?: Language): Promise<CallAnalysis> {
  let res: Response;
  try {
    res = await fetch(`${TRANSCRIBE_URL}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, language: languageHint(language) }) });
  } catch {
    throw new AnalysisUnavailable('Analysis needs GEMINI_API_KEY in .env.local, or the local transcriber running (npm run transcribe).');
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; text?: string; language?: string; segments?: { start: number; text: string }[]; model?: string; at?: number };
  if (!res.ok) throw new Error(body.error ?? `Transcription failed (${res.status})`);
  return {
    source: 'whisper',
    model: body.model,
    at: body.at ?? Date.now(),
    summary: '',
    keyPoints: [],
    objections: [],
    actionItems: [],
    sentiment: null,
    languages: body.language ? [body.language] : [],
    transcript: (body.segments ?? []).map((s) => ({ speaker: 'unknown' as const, atSec: s.start, text: s.text.trim() })),
  };
}

/** Analyse one recorded call: the server's Gemini pipeline, or a Whisper transcript when that is all this machine has. */
export async function analyzeCall(entry: CallLogEntry, user: CustomerUser): Promise<CallAnalysis> {
  const file = entry.telephony?.recordingFile;
  if (!file) throw new Error('This call has no recording yet.');
  try {
    return await viaServer(entry, user);
  } catch (e) {
    if (!(e instanceof AnalysisUnavailable) && !(e instanceof TypeError)) throw e;
    return viaWhisper(file, user.language);
  }
}
