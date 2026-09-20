// Client for the local transcription sidecar (tools/transcribe, `npm run transcribe`).
import type { CallTranscript, Language } from '../data/types';
import { TEST_NUMBER } from './telephony';

export const TRANSCRIBE_URL = ((import.meta.env.VITE_TRANSCRIBE_URL as string | undefined)?.trim() || 'http://127.0.0.1:8787').replace(/\/$/, '');

const LANGUAGE_CODES: Record<Language, string> = { Tamil: 'ta', Telugu: 'te', Kannada: 'kn', Malayalam: 'ml', Hindi: 'hi', Bengali: 'bn', English: 'en' };

/** The customer's language as a Whisper hint. Skipped in test mode, where the person on the phone is the tester, not the customer. */
export function languageHint(language?: Language): string | undefined {
  return TEST_NUMBER || !language ? undefined : LANGUAGE_CODES[language];
}

export class TranscriberOffline extends Error {
  constructor() {
    super('Transcription service is not running. Start it with: npm run transcribe');
  }
}

export async function transcribeRecording(file: string, language?: string, signal?: AbortSignal): Promise<CallTranscript> {
  let res: Response;
  try {
    res = await fetch(`${TRANSCRIBE_URL}/transcribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file, language }), signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new TranscriberOffline();
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<CallTranscript>;
  if (!res.ok) throw new Error(body.error ?? `Transcription failed (${res.status})`);
  return { text: body.text ?? '', language: body.language, segments: body.segments ?? [], model: body.model ?? 'whisper', at: body.at ?? Date.now(), source: 'whisper-local' };
}
