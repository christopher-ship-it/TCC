/**
 * Agent-scoped call records (TeleCMI `POST /v2/user/out_cdr`, authenticated with the agent's own login
 * token — no App Secret) and picking the recording that belongs to a call we just made.
 *
 * Documented response fields per record: cmiuid, duration, billedsec, filename, rate, record, name, from,
 * to, time, region. Parsing is defensive because the exact envelope (`cdr` vs `data`) and the unit of
 * `time` (ms vs s) are not pinned down in the docs.
 */

import type { RecordingQuery } from '../../core/types.ts';

export const TELECMI_REST = 'https://rest.telecmi.com/v2';

export type { RecordingQuery };

export interface CdrEntry {
  id?: string;
  filename: string;
  to?: string;
  timeMs?: number;
  duration?: number;
}

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const tail = (v: unknown): string => digits(v).slice(-10);
const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Records that carry a recording file name, from whichever envelope the API used. */
export function parseCdr(body: unknown): CdrEntry[] {
  const root = body as { cdr?: unknown; data?: unknown } | null;
  const list = Array.isArray(root?.cdr) ? root.cdr : Array.isArray(root?.data) ? root.data : Array.isArray(body) ? body : [];
  const out: CdrEntry[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const filename = typeof raw?.filename === 'string' ? raw.filename : typeof raw?.file_name === 'string' ? raw.file_name : '';
    if (!filename || raw.record === false) continue;
    const t = asNumber(raw.time ?? raw.timestamp);
    out.push({
      id: typeof raw.cmiuid === 'string' ? raw.cmiuid : typeof raw.cmiuuid === 'string' ? raw.cmiuuid : undefined,
      filename,
      to: raw.to !== undefined ? digits(raw.to) : undefined,
      timeMs: t === undefined ? undefined : t < 1e12 ? t * 1000 : t, // seconds → ms
      duration: asNumber(raw.duration ?? raw.answer_sec),
    });
  }
  return out;
}

const WINDOW_MS = 3 * 60_000;

/**
 * The recording for a call: same dialled number, started within 3 minutes, closest in time (call length breaks ties).
 * `claimed` holds file names already given to earlier calls so two back-to-back calls never share a recording.
 */
export function pickRecording(entries: CdrEntry[], q: RecordingQuery, claimed: ReadonlySet<string> = new Set()): string | undefined {
  const want = tail(q.remote);
  let best: { file: string; score: number } | undefined;
  for (const e of entries) {
    if (claimed.has(e.filename)) continue;
    if (e.to !== undefined && want && tail(e.to) !== want) continue;
    if (e.timeMs === undefined) continue;
    const dt = Math.abs(e.timeMs - q.startedAt);
    if (dt > WINDOW_MS) continue;
    const dd = q.talkSeconds !== undefined && e.duration !== undefined ? Math.abs(e.duration - q.talkSeconds) : 0;
    const score = dt + dd * 1000;
    if (!best || score < best.score) best = { file: e.filename, score };
  }
  return best?.file;
}

export async function fetchUserToken(id: string, password: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${TELECMI_REST}/user/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, password }) });
    const body = (await res.json()) as { token?: unknown; error?: unknown };
    // TeleCMI reports auth failures as HTTP 200 with {error:true, code:404} — only a real token counts.
    return res.ok && !body.error && typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

/** Answered outgoing calls for the token's agent between two instants. */
export async function fetchOutgoingCdr(token: string, fromMs: number, toMs: number, fetchImpl: typeof fetch = fetch): Promise<CdrEntry[]> {
  const res = await fetchImpl(`${TELECMI_REST}/user/out_cdr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 1, token, from: fromMs, to: toMs, page: 1, limit: 10 }),
  });
  if (!res.ok) throw new Error(`out_cdr ${res.status}`);
  const body = (await res.json()) as { error?: unknown; code?: unknown; message?: unknown; msg?: unknown };
  // ...and API errors likewise arrive as HTTP 200 with {error:true, code, message}.
  if (body?.error || (typeof body?.code === 'number' && body.code >= 400)) throw new Error(`out_cdr ${String(body.code)}: ${String(body.message ?? body.msg ?? 'error')}`);
  return parseCdr(body);
}
