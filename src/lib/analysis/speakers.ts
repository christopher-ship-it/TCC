// Who spoke when, from the loudness the browser measured on each side of the call.
// Pure — shared by the browser (charts) and the server (transcript labels). Ported from BusinessOS.

/** [seconds since answer, agent loudness, customer loudness] — one per stats sample. */
export type LevelSample = [number, number, number];

export type Speaker = 'agent' | 'customer';

export interface TimedLine {
  speaker: Speaker | 'unknown';
  atSec: number;
  text: string;
}

const AUDIBLE = 0.01; // RMS below this is line noise, not speech
const DOMINANCE = 1.6; // one side must be this much louder to count as the speaker

export function whoSpoke(agent: number, customer: number): Speaker | null {
  if (customer >= AUDIBLE && customer > agent * DOMINANCE) return 'customer';
  if (agent >= AUDIBLE && agent > customer * DOMINANCE) return 'agent';
  return null;
}

/** Loudness of each side summed over [from, to). A sample at t covers the interval just before t. */
function windowSum(levels: LevelSample[], from: number, to: number): [number, number] {
  let a = 0;
  let c = 0;
  for (const [t, agent, customer] of levels) {
    if (t > from && t - 1 < to) {
      a += agent;
      c += customer;
    }
  }
  return [a, c];
}

function spans(lines: TimedLine[]): Array<[number, number]> {
  return lines.map((l, i) => {
    const next = lines[i + 1] ? lines[i + 1].atSec : l.atSec + 4;
    return [l.atSec, Math.max(next, l.atSec + 1.5)];
  });
}

/**
 * Relabel each transcript line by which side was actually audible at that moment. The carrier records one
 * mixed track, so a model listening to it can only guess who is who; the browser measured both sides
 * separately. The recording and the timeline can start a second or two apart, so the offset that makes the
 * lines most clearly one-sided is found first. Lines where neither side clearly dominates keep their label.
 */
export function attributeSpeakers(lines: TimedLine[], levels: LevelSample[] | undefined): TimedLine[] {
  if (!levels?.length || !lines.length) return lines;
  const ranges = spans(lines);
  let best = { offset: 0, score: -1 };
  for (let offset = -3; offset <= 3; offset += 0.5) {
    let score = 0;
    for (const [from, to] of ranges) {
      const [a, c] = windowSum(levels, from + offset, to + offset);
      if (a + c > 0) score += Math.abs(c - a) / (a + c);
    }
    if (score > best.score) best = { offset, score };
  }
  return lines.map((line, i) => {
    const [from, to] = ranges[i];
    const [a, c] = windowSum(levels, from + best.offset, to + best.offset);
    const n = Math.max(1, Math.ceil(to - from));
    return { ...line, speaker: whoSpoke(a / n, c / n) ?? line.speaker };
  });
}

/** A compact "who was audible when" line for the model, e.g. "0-3s customer, 4-9s agent". */
export function speakingSummary(levels: LevelSample[] | undefined): string {
  if (!levels?.length) return '';
  const out: string[] = [];
  let cur = null as { who: Speaker; from: number; to: number } | null;
  for (const [t, a, c] of levels) {
    const w = whoSpoke(a, c);
    if (w && cur?.who === w && t - cur.to <= 2) cur.to = t;
    else if (w) {
      if (cur) out.push(`${Math.max(0, Math.round(cur.from - 1))}-${Math.round(cur.to)}s ${cur.who}`);
      cur = { who: w, from: t, to: t };
    }
  }
  if (cur) out.push(`${Math.max(0, Math.round(cur.from - 1))}-${Math.round(cur.to)}s ${cur.who}`);
  return out.slice(0, 200).join(', ');
}

export interface SpeakingBlock {
  speaker: Speaker;
  from: number;
  to: number;
}

/** Contiguous stretches where one side was clearly talking — what the conversation timeline chart draws. */
export function speakingBlocks(levels: LevelSample[] | undefined): SpeakingBlock[] {
  if (!levels?.length) return [];
  const out: SpeakingBlock[] = [];
  let prevT = 0;
  for (const [t, a, c] of levels) {
    const w = whoSpoke(a, c);
    const from = Math.max(prevT, t - 1);
    prevT = t;
    if (!w) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === w && from - last.to <= 1.5) last.to = t;
    else out.push({ speaker: w, from, to: t });
  }
  return out;
}

/** Seconds each side spent talking. From measured levels when there are any, else estimated from transcript line lengths. */
export function talkShare(levels: LevelSample[] | undefined, lines: TimedLine[] = []): { agent: number; customer: number; measured: boolean } {
  const blocks = speakingBlocks(levels);
  if (blocks.length) {
    const sum = (s: Speaker) => blocks.filter((b) => b.speaker === s).reduce((n, b) => n + (b.to - b.from), 0);
    return { agent: sum('agent'), customer: sum('customer'), measured: true };
  }
  const ranges = spans(lines);
  let agent = 0;
  let customer = 0;
  lines.forEach((l, i) => {
    const len = ranges[i][1] - ranges[i][0];
    if (l.speaker === 'agent') agent += len;
    if (l.speaker === 'customer') customer += len;
  });
  return { agent, customer, measured: false };
}
