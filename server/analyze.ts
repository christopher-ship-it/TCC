// Post-call analysis: recording → Gemini (transcript, summary, sentiment, objections, next step) → speaker labels
// from the levels the browser measured. Same pipeline as BusinessOS's contact centre (lib/ai/gemini-call-analyzer.ts).

import fs from 'node:fs';
import path from 'node:path';
import { analysisPrompt, parseAnalysis, type AnalysisContext, type CallAnalysis } from '../src/lib/analysis/model.ts';
import { attributeSpeakers, speakingSummary, type LevelSample } from '../src/lib/analysis/speakers.ts';
import type { ServerEnv } from './env.ts';
import { fetchRecording, RECORDING_FILE_RE } from './recordings.ts';

const FALLBACK_MODEL = 'gemini-2.0-flash';
/** Gemini accepts about 20 MB of inline request data; stay under with headroom for base64. */
export const MAX_INLINE_AUDIO_BYTES = 14 * 1024 * 1024;

export class NotConfigured extends Error {}

/** At most this many recordings go to Gemini at once; the rest wait their turn instead of tripping the rate limit. */
const MAX_CONCURRENT = 4;
let running = 0;
type AnalysisListener = (level: 'info' | 'warn' | 'error', message: string) => void;
let listener: AnalysisListener = () => {};
/** The server's event log listens here (retries, quota, failures). */
export function onAnalysisEvent(fn: AnalysisListener) {
  listener = fn;
}
export const analysisQueue = () => ({ running, waiting: waiting.length, max: MAX_CONCURRENT });
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** The same recording asked for twice at once (two screens open) is analysed once. */
const inFlight = new Map<string, Promise<CallAnalysis>>();

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long Gemini asked us to wait ("retryDelay": "17s"), capped; otherwise a growing back-off. */
export function retryDelayMs(body: string, attempt: number): number {
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const asked = m ? Number(m[1]) * 1000 : 0;
  return Math.min(60_000, Math.max(asked, 2000 * 2 ** attempt));
}

export interface AnalyzeRequest extends AnalysisContext {
  file: string;
  levels?: LevelSample[];
}

function cachePath(env: ServerEnv, file: string) {
  return path.join(env.dataDir, 'analysis', `${file}.json`);
}

async function callGemini(env: ServerEnv, audio: Uint8Array, mimeType: string, ctx: AnalysisContext, fetchImpl: typeof fetch): Promise<{ text: string; model: string }> {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: analysisPrompt(ctx, env.brand) }, { inline_data: { mime_type: mimeType, data: Buffer.from(audio).toString('base64') } }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  });
  const run = async (model: string) => {
    // Key goes in a header, not the URL, so it cannot leak into request logs.
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiKey! },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    return { ok: res.ok, status: res.status, text: await res.text(), model };
  };
  // Busy or rate-limited: wait as told and try again (3 tries), then fall back to the older model once.
  let r = await run(env.geminiModel);
  for (let attempt = 0; !r.ok && RETRYABLE.has(r.status) && attempt < 2; attempt++) {
    listener('warn', `Gemini ${r.status} on ${r.model}, retrying (${attempt + 1}/2)`);
    await sleep(retryDelayMs(r.text, attempt));
    r = await run(env.geminiModel);
  }
  if (!r.ok && env.geminiModel !== FALLBACK_MODEL) r = await run(FALLBACK_MODEL);
  if (!r.ok) listener('error', `Gemini failed: HTTP ${r.status} ${r.text.slice(0, 160)}`);
  if (r.status === 429) throw new Error('Call analysis is over its Gemini quota right now. It will be retried — or open the call later and choose Analyse.');
  if (!r.ok) throw new Error(`Gemini request failed (HTTP ${r.status}): ${r.text.slice(0, 200)}`);
  const text = (JSON.parse(r.text) as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!String(text).trim()) throw new Error('Gemini returned no analysis.');
  return { text: String(text), model: r.model };
}

/**
 * Analyse one recording. The model's raw result is cached per file, so a retry or a second viewer costs nothing;
 * speaker labels are re-applied from the levels sent with each request.
 */
export async function analyzeRecording(req: AnalyzeRequest, env: ServerEnv, fetchImpl: typeof fetch = fetch): Promise<CallAnalysis> {
  if (!RECORDING_FILE_RE.test(req.file)) throw new Error('Invalid recording reference.');
  const cached = cachePath(env, req.file);
  let analysis: CallAnalysis | null = null;
  try {
    analysis = JSON.parse(fs.readFileSync(cached, 'utf8')) as CallAnalysis;
  } catch {
    // not analysed yet
  }
  if (!analysis) {
    if (!env.geminiKey) throw new NotConfigured('Call analysis needs GEMINI_API_KEY in .env.local.');
    let job = inFlight.get(req.file);
    if (!job) {
      job = slot(async () => {
        const { data, contentType } = await fetchRecording(req.file, env, fetchImpl);
        if (data.byteLength > MAX_INLINE_AUDIO_BYTES) throw new Error(`Recording is ${(data.byteLength / 1048576).toFixed(1)} MB — over the ${MAX_INLINE_AUDIO_BYTES / 1048576} MB limit.`);
        const { text, model } = await callGemini(env, data, contentType, { ...req, speaking: speakingSummary(req.levels) }, fetchImpl);
        const result = parseAnalysis(text, model);
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, JSON.stringify(result));
        return result;
      }).finally(() => inFlight.delete(req.file));
      inFlight.set(req.file, job);
    }
    analysis = await job;
  }
  return { ...analysis, transcript: attributeSpeakers(analysis.transcript, req.levels) };
}
