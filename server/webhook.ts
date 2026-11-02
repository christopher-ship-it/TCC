// TeleCMI pushes a call-detail record (CDR) to TCC when a call ends — with the recording's file name in it. Keeping
// those on the server means a recording is found whether or not the agent's softphone session is still open, which
// is what the browser-side lookup (out_cdr / in_cdr, needs the agent's own login) cannot promise.
//
// Field names are TeleCMI's published CDR sample, the same one BusinessOS parses: type "cdr", direction, user
// ("5002_33338836"), from, to, time (ms or s), answeredsec, record: true, filename.

import crypto from 'node:crypto';
import type pg from 'pg';
import { RECORDING_FILE_RE } from './recordings.ts';

export interface RecordedCall {
  file: string;
  direction: 'inbound' | 'outbound' | null;
  /** The other party, last 10 digits. */
  remote: string;
  /** The softphone user that took or made the call, e.g. "5002_33338836". */
  user: string | null;
  startedAt: number;
  talkSeconds: number | null;
}

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const tail = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10);

/** A recorded call from a CDR webhook body (object or JSON string), or null when it isn't one. */
export function parseCdrWebhook(payload: unknown): RecordedCall | null {
  let body = payload;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (raw.type !== undefined && raw.type !== 'cdr') return null;
  const file = asString(raw.filename) ?? asString(raw.file_name);
  if (!file || raw.record === false || raw.record === 'false' || !RECORDING_FILE_RE.test(file)) return null;
  const direction = raw.direction === 'inbound' || raw.direction === 'outbound' ? raw.direction : null;
  const t = asNumber(raw.time ?? raw.timestamp);
  if (t === null) return null;
  // The other party is who the agent did not talk as: the caller of an inbound call, the callee of an outbound one.
  const remote = tail(direction === 'inbound' ? (raw.from ?? raw.callerid) : (raw.to ?? raw.from));
  if (!remote) return null;
  return {
    file,
    direction,
    remote,
    user: asString(raw.user),
    startedAt: t < 1e12 ? t * 1000 : t,
    talkSeconds: asNumber(raw.answeredsec ?? raw.duration),
  };
}

/** Constant-time check of the shared secret in the webhook URL. No secret configured = nothing is accepted. */
export function webhookAuthorised(given: string | undefined | null, secret: string | undefined): boolean {
  if (!secret || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function saveRecordedCall(pool: pg.Pool, r: RecordedCall) {
  await pool.query(
    `insert into call_recordings (file, direction, remote, agent_user, started_at, talk_seconds)
     values ($1, $2, $3, $4, $5, $6) on conflict (file) do nothing`,
    [r.file, r.direction, r.remote, r.user, r.startedAt, r.talkSeconds],
  );
}

const WINDOW_MS = 3 * 60_000;

/**
 * The recording for a call: same other party, started within 3 minutes, closest in time. `claimed` are files already
 * given to other calls, so two back-to-back calls to one number never share a recording.
 */
export function pickRecordedCall(rows: RecordedCall[], q: { remote: string; startedAt: number; direction?: string }, claimed: ReadonlySet<string> = new Set()): string | undefined {
  const want = tail(q.remote);
  let best: { file: string; score: number } | undefined;
  for (const r of rows) {
    if (claimed.has(r.file) || r.remote !== want) continue;
    if (q.direction && r.direction && r.direction !== q.direction) continue;
    const dt = Math.abs(r.startedAt - q.startedAt);
    if (dt > WINDOW_MS) continue;
    if (!best || dt < best.score) best = { file: r.file, score: dt };
  }
  return best?.file;
}

export async function findRecordedCall(pool: pg.Pool, q: { remote: string; startedAt: number; direction?: string }, claimed: ReadonlySet<string> = new Set()): Promise<string | undefined> {
  const r = await pool.query<{ file: string; direction: string | null; remote: string; agent_user: string | null; started_at: string; talk_seconds: number | null }>(
    'select file, direction, remote, agent_user, started_at, talk_seconds from call_recordings where remote = $1 and started_at between $2 and $3',
    [tail(q.remote), q.startedAt - WINDOW_MS, q.startedAt + WINDOW_MS],
  );
  return pickRecordedCall(
    r.rows.map((x) => ({ file: x.file, direction: x.direction as RecordedCall['direction'], remote: x.remote, user: x.agent_user, startedAt: Number(x.started_at), talkSeconds: x.talk_seconds })),
    q,
    claimed,
  );
}
