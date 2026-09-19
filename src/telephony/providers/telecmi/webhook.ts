import type { Meta } from '../../core/types.ts';

/**
 * Pure normaliser for TeleCMI webhook bodies (CDR + live events). No I/O, so it
 * runs unchanged in a Cloud Function, a Node server or a test.
 *
 * Field names are from TeleCMI's published samples (outgoing missed/answered
 * CDR, outgoing started/hangup live events). Incoming payloads were not
 * reviewed — extend `KNOWN_STATUS` when real ones are captured.
 */

export type WebhookStatus = 'started' | 'ringing' | 'answered' | 'hangup' | 'missed' | 'waiting' | 'other';

export interface NormalizedWebhook {
  kind: 'cdr' | 'live';
  /** Shared by both legs of a call — the id to correlate on. */
  providerCallId: string;
  /** Unique per leg. */
  legId: string;
  leg: 'a' | 'b' | null;
  status: WebhookStatus;
  rawStatus: string;
  direction: 'inbound' | 'outbound' | null;
  /** "202_2222223" — extension_appid. */
  agentUserId: string | null;
  agentExtension: string | null;
  appId: number | null;
  to: string | null;
  from: string | null;
  virtualNumber: string | null;
  /** Epoch ms. */
  at: number | null;
  /** Answered duration, CDRs only. */
  talkSeconds: number | null;
  hangupReason: string | null;
  recording: { file: string } | null;
  /** Tags we attached at dial time, merged from `custom` and `extra_params`. */
  meta: Meta;
  raw: Record<string, unknown>;
}

const KNOWN_STATUS: Record<string, WebhookStatus> = {
  started: 'started',
  ringing: 'ringing',
  answered: 'answered',
  hangup: 'hangup',
  missed: 'missed',
  waiting: 'waiting',
};

const asString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);
const asNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function parseTags(v: unknown): Meta {
  let obj: unknown = v;
  if (typeof v === 'string') {
    try {
      obj = JSON.parse(v);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Meta = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined && val !== null) out[k] = String(val);
  return out;
}

/** Returns null for anything that isn't a recognisable TeleCMI call payload. Accepts an object or a JSON string. */
export function normalizeTeleCmiWebhook(payload: unknown): NormalizedWebhook | null {
  let body: unknown = payload;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;

  const type = raw.type;
  if (type !== 'cdr' && type !== 'event') return null;
  const providerCallId = asString(raw.call_id) ?? asString(raw.request_id);
  const legId = asString(raw.cmiuuid);
  if (!providerCallId || !legId) return null;

  const rawStatus = asString(raw.status) ?? 'unknown';
  const user = asString(raw.user);
  const [extension, appFromUser] = user?.includes('_') ? user.split('_') : [null, null];
  const direction = raw.direction === 'inbound' || raw.direction === 'outbound' ? raw.direction : null;
  const filename = asString(raw.filename);

  return {
    kind: type === 'cdr' ? 'cdr' : 'live',
    providerCallId,
    legId,
    leg: raw.leg === 'a' || raw.leg === 'b' ? raw.leg : null,
    status: KNOWN_STATUS[rawStatus] ?? 'other',
    rawStatus,
    direction,
    agentUserId: user,
    agentExtension: extension,
    appId: asNumber(raw.appid ?? raw.app_id) ?? asNumber(appFromUser),
    to: asString(raw.to),
    from: asString(raw.from) ?? asString(raw.callerid),
    virtualNumber: asString(raw.virtual_number),
    at: asNumber(raw.time),
    talkSeconds: asNumber(raw.answeredsec),
    hangupReason: asString(raw.hangup_reason),
    recording: raw.record === true && filename ? { file: filename } : null,
    meta: { ...parseTags(raw.custom), ...parseTags(raw.extra_params) },
    raw,
  };
}
