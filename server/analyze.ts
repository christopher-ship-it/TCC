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
  let r = await run(env.geminiModel);
  if (!r.ok && env.geminiModel !== FALLBACK_MODEL) r = await run(FALLBACK_MODEL);
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
    const { data, contentType } = await fetchRecording(req.file, env, fetchImpl);
    if (data.byteLength > MAX_INLINE_AUDIO_BYTES) throw new Error(`Recording is ${(data.byteLength / 1048576).toFixed(1)} MB — over the ${MAX_INLINE_AUDIO_BYTES / 1048576} MB limit.`);
    const { text, model } = await callGemini(env, data, contentType, { ...req, speaking: speakingSummary(req.levels) }, fetchImpl);
    analysis = parseAnalysis(text, model);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, JSON.stringify(analysis));
  }
  return { ...analysis, transcript: attributeSpeakers(analysis.transcript, req.levels) };
}
