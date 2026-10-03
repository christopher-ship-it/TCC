// The shape of a call's post-call analysis, and the parser for what the model returns.
// Pure — imported by the browser and by the server (server/analyze.ts).

import type { TimedLine } from './speakers.ts';

export type AnalysisSource = 'gemini' | 'whisper' | 'sample';

export interface CallAnalysis {
  /** Where it came from: the Gemini pipeline, a bare local Whisper transcript, or generated demo data. */
  source: AnalysisSource;
  model?: string;
  at: number;
  /** The model's reading of how the call went, in TCC's outcome words (or "No conversation"). */
  outcome?: string;
  summary: string;
  keyPoints: string[];
  objections: string[];
  actionItems: string[];
  recommendation?: string;
  /** Customer receptiveness, 0–100. Null when nothing judged it (a bare transcript). */
  sentiment: number | null;
  languages: string[];
  transcript: TimedLine[];
}

export const ANALYSIS_OUTCOMES = [
  'Interested',
  'Very interested',
  'Ready to subscribe',
  'Created first listing',
  'Payment issue',
  'Technical issue',
  'Not interested',
  'Using competitor',
  'Call back later',
  'Voicemail',
  'No conversation',
] as const;

export interface AnalysisContext {
  customer?: string;
  business?: string;
  app?: string;
  /** Measured "who was audible when", from speakingSummary(). */
  speaking?: string;
}

export function analysisPrompt(ctx: AnalysisContext): string {
  return `You are the call-quality analyst for Tecstellar Command Center, the team that calls customers of Tecstellar's apps
(RealBroks — a broker assistant for real-estate agents; IronDrobe — a CRM for laundry and ironing shops; Influnet; Vehigo).
Listen to the attached recording of an outbound call and return a faithful analysis.

Rules:
- Transcribe what is ACTUALLY said. Callers speak Tamil, Telugu, Kannada, Malayalam, Hindi, English or a mix. Keep the words
  as spoken (romanised is fine) and add a short English gloss in brackets only where the meaning would be lost.
- Label each line "Agent" (the Tecstellar caller) or "Customer". When a measured speaking timeline is given, follow it —
  never assume a lone voice is the Agent. If it is a voicemail, ringing or silence, say so; never invent a conversation.
- Each transcript line carries its start time "mm:ss" in the audio.
- outcome must be exactly one of: ${ANALYSIS_OUTCOMES.join(' | ')}.
- sentiment is an integer 0-100 for how receptive the customer was (50 = neutral).
- Keep summary to 2-3 plain sentences a supervisor can read in ten seconds.

Customer: ${ctx.customer || 'unknown'}. Business: ${ctx.business || 'unknown'}. App: ${ctx.app || 'unknown'}.
${ctx.speaking ? `Measured on the line (each side recorded separately, so this is exact) — seconds where one side was audible: ${ctx.speaking}.` : ''}

Return ONLY JSON:
{"outcome":"...","summary":"...","keyPoints":["..."],"objections":["..."],"actionItems":["..."],"recommendation":"one next step",
 "sentiment":60,"languages":["Tamil"],"transcript":[{"speaker":"Agent","at":"00:02","text":"..."}]}`;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];

export const stampToSeconds = (at: string): number => {
  const parts = at.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Turn the model's JSON (possibly fenced) into a CallAnalysis. Throws on unparseable output. */
export function parseAnalysis(raw: string, model: string, now = Date.now()): CallAnalysis {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`The model returned unparseable JSON: ${cleaned.slice(0, 160)}`);
  }
  const transcript: TimedLine[] = Array.isArray(p.transcript)
    ? p.transcript
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof (l as { text?: unknown }).text === 'string')
        .map((l) => {
          const who = String(l.speaker ?? '').toLowerCase();
          const at = String(l.at ?? '');
          return {
            speaker: who.startsWith('agent') ? ('agent' as const) : who.startsWith('customer') ? ('customer' as const) : ('unknown' as const),
            atSec: /^\d{1,3}:\d{2}$/.test(at) ? stampToSeconds(at) : 0,
            text: String(l.text).trim(),
          };
        })
        .filter((l) => l.text)
    : [];
  const outcomes: readonly string[] = ANALYSIS_OUTCOMES;
  const outcome = outcomes.includes(String(p.outcome)) ? String(p.outcome) : transcript.length ? 'Call back later' : 'No conversation';
  const sentiment = typeof p.sentiment === 'number' && Number.isFinite(p.sentiment) ? Math.max(0, Math.min(100, Math.round(p.sentiment))) : 50;
  return {
    source: 'gemini',
    model,
    at: now,
    outcome,
    summary: typeof p.summary === 'string' && p.summary.trim() ? p.summary.trim() : 'No summary was produced.',
    keyPoints: strings(p.keyPoints ?? p.bullets),
    objections: strings(p.objections),
    actionItems: strings(p.actionItems),
    recommendation: typeof p.recommendation === 'string' && p.recommendation.trim() ? p.recommendation.trim() : undefined,
    sentiment,
    languages: strings(p.languages ?? p.detectedLanguages),
    transcript,
  };
}

export type SentimentBand = 'positive' | 'neutral' | 'negative';

export function sentimentBand(score: number | null | undefined): SentimentBand | null {
  if (score === null || score === undefined) return null;
  if (score >= 60) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}
