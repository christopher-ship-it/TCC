// Agents tell TCC whether the AI's reading of a call was right, and TCC learns from it. Gemini itself is not retrained:
// the team's recent corrections become "lessons" added to the instructions that go with each new analysis, and the
// accuracy page shows whether the AI is getting closer to how the team reads calls. Pure functions, so they can be tested.
import { sentimentBand, type SentimentBand } from './analysis/model.ts';

export type Verdict = 'good' | 'partly' | 'wrong';
export const VERDICTS: Verdict[] = ['good', 'partly', 'wrong'];

/** One call's feedback. `manual` = an agent rated the analysis; `implicit` = the agent picked a result when completing the call, which is compared with the AI's. */
export interface FeedbackRow {
  id: string;
  /** The call this is about (the log entry, or the carrier's call id for an implicit one). */
  entryId: string;
  app: string;
  agentId: string;
  ts: number;
  kind: 'manual' | 'implicit';
  verdict: Verdict;
  aiOutcome?: string;
  /** What the agent says it should have been. Left out when they agree. */
  outcome?: string;
  aiSentiment?: number | null;
  sentiment?: SentimentBand;
  language?: string;
  note?: string;
}

const BANDS: SentimentBand[] = ['positive', 'neutral', 'negative'];
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** Checks what a browser sent. Returns the row to store, or the reason it was refused. */
export function parseFeedback(body: unknown, agent: { id: string }, now = Date.now()): FeedbackRow | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const entryId = str(b.entryId, 120);
  const app = str(b.app, 40);
  const verdict = VERDICTS.find((v) => v === b.verdict);
  const kind = b.kind === 'implicit' ? 'implicit' : 'manual';
  if (!entryId || !app || !verdict) return 'entryId, app and a verdict (good, partly or wrong) are required.';
  const sentiment = BANDS.find((s) => s === b.sentiment);
  return {
    id: `${kind}:${entryId}`,
    entryId,
    app,
    agentId: agent.id,
    ts: now,
    kind,
    verdict,
    aiOutcome: str(b.aiOutcome, 60),
    outcome: str(b.outcome, 60),
    aiSentiment: typeof b.aiSentiment === 'number' && Number.isFinite(b.aiSentiment) ? Math.round(b.aiSentiment) : null,
    sentiment,
    language: str(b.language, 30),
    note: str(b.note, 500),
  };
}

/** What the agent thinks the outcome was: their correction, else the AI's own when they said it was right. */
const agentOutcome = (r: FeedbackRow): string | undefined => r.outcome ?? (r.verdict === 'good' ? r.aiOutcome : undefined);
const agentBand = (r: FeedbackRow): SentimentBand | undefined => r.sentiment ?? (r.verdict === 'good' ? sentimentBand(r.aiSentiment) ?? undefined : undefined);

/** The id a call's feedback is filed under: the carrier's call id when there is one (known before the entry exists), else the entry's. */
export const feedbackKey = (entry: { id: string; telephony?: { callId?: string | null } | null }): string => entry.telephony?.callId || entry.id;

export const outcomeDisagrees = (r: FeedbackRow): boolean => !!r.aiOutcome && !!agentOutcome(r) && agentOutcome(r) !== r.aiOutcome;

interface Group { key: string; total: number; good: number; accuracy: number | null }
const group = (rows: FeedbackRow[], by: (r: FeedbackRow) => string | undefined): Group[] => {
  const m = new Map<string, { total: number; good: number }>();
  for (const r of rows) {
    const k = by(r);
    if (!k) continue;
    const g = m.get(k) ?? { total: 0, good: 0 };
    g.total++;
    if (r.verdict === 'good') g.good++;
    m.set(k, g);
  }
  return [...m.entries()].map(([key, g]) => ({ key, ...g, accuracy: g.total ? Math.round((g.good / g.total) * 100) : null })).sort((a, b) => b.total - a.total);
};

const DAY = 86_400_000;
const weekStart = (ts: number) => {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
};

export interface AiSummary {
  total: number;
  manual: number;
  implicit: number;
  verdicts: Record<Verdict, number>;
  /** Share of analyses the team marked good, 0-100. */
  accuracy: number | null;
  outcomeAgreement: { known: number; agreed: number; rate: number | null };
  sentimentAgreement: { known: number; agreed: number; rate: number | null };
  /** Over the last 12 weeks, oldest first. */
  weekly: { weekStart: number; total: number; good: number; accuracy: number | null }[];
  /** Last 4 weeks against the 4 before: positive = getting better. Null until both have enough to compare. */
  trend: number | null;
  byApp: Group[];
  byLanguage: Group[];
  byOutcome: { outcome: string; total: number; agreed: number; topCorrection: string | null; correctedTo: Record<string, number> }[];
  /** Is the AI too hopeful or too harsh about customers? */
  bias: { tooHigh: number; tooLow: number; known: number };
  recent: FeedbackRow[];
}

export function summarize(rows: FeedbackRow[], now = Date.now()): AiSummary {
  const verdicts: Record<Verdict, number> = { good: 0, partly: 0, wrong: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  const rate = (agreed: number, known: number) => (known ? Math.round((agreed / known) * 100) : null);

  const oKnown = rows.filter((r) => r.aiOutcome && agentOutcome(r));
  const oAgreed = oKnown.filter((r) => !outcomeDisagrees(r)).length;
  const sKnown = rows.filter((r) => sentimentBand(r.aiSentiment) && agentBand(r));
  const sAgreed = sKnown.filter((r) => sentimentBand(r.aiSentiment) === agentBand(r)).length;

  const thisWeek = weekStart(now);
  const weekly = Array.from({ length: 12 }, (_, i) => {
    const start = thisWeek - (11 - i) * 7 * DAY;
    const inWeek = rows.filter((r) => r.ts >= start && r.ts < start + 7 * DAY);
    const good = inWeek.filter((r) => r.verdict === 'good').length;
    return { weekStart: start, total: inWeek.length, good, accuracy: inWeek.length ? Math.round((good / inWeek.length) * 100) : null };
  });
  const sum = (ws: typeof weekly) => ({ t: ws.reduce((n, w) => n + w.total, 0), g: ws.reduce((n, w) => n + w.good, 0) });
  const recent4 = sum(weekly.slice(8));
  const before4 = sum(weekly.slice(4, 8));
  const trend = recent4.t >= 5 && before4.t >= 5 ? Math.round((recent4.g / recent4.t - before4.g / before4.t) * 100) : null;

  const byOutcomeMap = new Map<string, { total: number; agreed: number; to: Record<string, number> }>();
  for (const r of oKnown) {
    const g = byOutcomeMap.get(r.aiOutcome!) ?? { total: 0, agreed: 0, to: {} };
    g.total++;
    if (outcomeDisagrees(r)) g.to[agentOutcome(r)!] = (g.to[agentOutcome(r)!] ?? 0) + 1;
    else g.agreed++;
    byOutcomeMap.set(r.aiOutcome!, g);
  }
  const byOutcome = [...byOutcomeMap.entries()]
    .map(([outcome, g]) => ({ outcome, total: g.total, agreed: g.agreed, correctedTo: g.to, topCorrection: Object.entries(g.to).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }))
    .sort((a, b) => b.total - a.total);

  const order: Record<SentimentBand, number> = { negative: 0, neutral: 1, positive: 2 };
  let tooHigh = 0;
  let tooLow = 0;
  for (const r of sKnown) {
    const ai = sentimentBand(r.aiSentiment)!;
    const me = agentBand(r)!;
    if (order[ai] > order[me]) tooHigh++;
    else if (order[ai] < order[me]) tooLow++;
  }

  return {
    total: rows.length,
    manual: rows.filter((r) => r.kind === 'manual').length,
    implicit: rows.filter((r) => r.kind === 'implicit').length,
    verdicts,
    accuracy: rate(verdicts.good, rows.length),
    outcomeAgreement: { known: oKnown.length, agreed: oAgreed, rate: rate(oAgreed, oKnown.length) },
    sentimentAgreement: { known: sKnown.length, agreed: sAgreed, rate: rate(sAgreed, sKnown.length) },
    weekly,
    trend,
    byApp: group(rows, (r) => r.app),
    byLanguage: group(rows, (r) => r.language),
    byOutcome,
    bias: { tooHigh, tooLow, known: sKnown.length },
    recent: rows.filter((r) => r.verdict !== 'good' || outcomeDisagrees(r)).sort((a, b) => b.ts - a.ts).slice(0, 20),
  };
}

/**
 * The lessons for the next analysis, as text for the instructions: where the AI keeps being corrected and in which
 * direction, plus a few recent corrections in the agents' own words. Names and numbers of customers are never included.
 * Empty when there is not enough feedback yet to say anything.
 */
export function buildLessons(rows: FeedbackRow[], o: { minSamples?: number; maxChars?: number } = {}): string {
  const min = o.minSamples ?? 3;
  const max = o.maxChars ?? 1400;
  const s = summarize(rows);
  const lines: string[] = [];

  for (const g of s.byOutcome) {
    const wrong = g.total - g.agreed;
    if (g.total >= min && wrong / g.total >= 0.3 && g.topCorrection) {
      lines.push(`- When you chose "${g.outcome}", the team disagreed ${wrong} of ${g.total} times, most often choosing "${g.topCorrection}" instead. Be more careful before choosing "${g.outcome}".`);
    }
  }
  if (s.bias.known >= min * 2) {
    if (s.bias.tooHigh / s.bias.known >= 0.3 && s.bias.tooHigh > s.bias.tooLow) lines.push('- You tend to score customers as more receptive than the team does. Score more conservatively: polite is not the same as interested.');
    else if (s.bias.tooLow / s.bias.known >= 0.3 && s.bias.tooLow > s.bias.tooHigh) lines.push('- You tend to score customers as less receptive than the team does. Do not read a short or flat answer as disinterest.');
  }
  const examples = rows.filter((r) => r.note && (r.verdict !== 'good' || outcomeDisagrees(r))).sort((a, b) => b.ts - a.ts).slice(0, 4);
  const seen = new Set<string>();
  for (const r of examples) {
    const line = `- ${r.aiOutcome ? `You said "${r.aiOutcome}"` : 'The analysis was off'}${r.outcome ? `, the team said "${r.outcome}"` : ''}: ${r.note!.replace(/\s+/g, ' ').slice(0, 140)}`;
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  if (!lines.length) return '';
  let out = lines.join('\n');
  if (out.length > max) out = out.slice(0, max).replace(/\n[^\n]*$/, '');
  return out;
}

/** What an agent has filled in about one analysis (before it is sent). */
export interface FeedbackDraft {
  verdict: Verdict | '';
  /** The outcome they say it should have been; empty = no correction. */
  outcome: string;
  sentiment: SentimentBand | '';
  note: string;
}
export const emptyDraft = (): FeedbackDraft => ({ verdict: '', outcome: '', sentiment: '', note: '' });

/** The body sent to POST /api/feedback. A correction that equals what the AI said is left out. */
export function feedbackBody(p: { key: string; app: string; language?: string; analysis: { outcome?: string; sentiment: number | null }; draft: FeedbackDraft; kind?: 'manual' | 'implicit' }) {
  const d = p.draft;
  return {
    kind: p.kind ?? 'manual',
    entryId: p.key,
    app: p.app,
    verdict: d.verdict,
    aiOutcome: p.analysis.outcome,
    outcome: d.outcome && d.outcome !== p.analysis.outcome ? d.outcome : undefined,
    aiSentiment: p.analysis.sentiment,
    sentiment: d.sentiment || undefined,
    language: p.language,
    note: d.note.trim() || undefined,
  };
}

/** When the agent never rated the analysis, the result they picked on the call card still says something: it either matches the AI's or not. */
export function implicitDraft(aiOutcome: string | undefined, agentOutcome: string | undefined): FeedbackDraft | null {
  if (!aiOutcome || !agentOutcome) return null;
  return aiOutcome === agentOutcome ? { verdict: 'good', outcome: '', sentiment: '', note: '' } : { verdict: 'wrong', outcome: agentOutcome, sentiment: '', note: '' };
}
