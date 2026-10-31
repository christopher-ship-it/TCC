// Brakes on TCC's own API, so one stuck browser, one bad script or one guessed password cannot flood the server or run up
// the Gemini bill. Each rule allows `limit` requests per `windowMs` per person (their session) or, when there is no
// session, per network address. Counted in memory: a restart resets them, which is fine for a brake.
//
// The rules are listed here once and shown on the super admin's API page, so what is documented is what is enforced.

import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface RateRule {
  id: string;
  /** Plain words for the API page. */
  label: string;
  methods: string[];
  /** Matched against the path. */
  path: RegExp;
  limit: number;
  windowMs: number;
  /** Count per signed-in person (falls back to address), or per address only. */
  per: 'person' | 'address';
}

const MIN = 60_000;

/** First match wins, so the specific rules come before the general one. */
export const RATE_RULES: RateRule[] = [
  { id: 'login', label: 'Sign-in attempts', methods: ['POST'], path: /^\/api\/auth\/login$/, limit: 20, windowMs: 15 * MIN, per: 'address' },
  { id: 'setup', label: 'First-admin setup', methods: ['POST'], path: /^\/api\/auth\/setup$/, limit: 10, windowMs: 60 * MIN, per: 'address' },
  { id: 'analyze', label: 'Call analysis (Gemini)', methods: ['POST'], path: /^\/api\/analyze$/, limit: 30, windowMs: MIN, per: 'person' },
  { id: 'webhook', label: 'Carrier call-detail webhook', methods: ['POST'], path: /^\/api\/telephony\/webhook$/, limit: 300, windowMs: MIN, per: 'address' },
  { id: 'recordings', label: 'Recording downloads', methods: ['GET'], path: /^\/api\/recordings\//, limit: 120, windowMs: MIN, per: 'person' },
  { id: 'lookup', label: 'Incoming-caller lookups in a product', methods: ['POST'], path: /^\/api\/sources\/lookup$/, limit: 30, windowMs: MIN, per: 'person' },
  { id: 'assign', label: 'Handing customers out', methods: ['POST'], path: /^\/api\/assignments\/run$/, limit: 20, windowMs: MIN, per: 'person' },
  { id: 'signout', label: 'Signing people out', methods: ['POST'], path: /^\/api\/people\/[^/]+\/signout$/, limit: 30, windowMs: MIN, per: 'person' },
  { id: 'people', label: 'Adding people and passwords', methods: ['POST'], path: /^\/api\/(people|password-requests)/, limit: 60, windowMs: MIN, per: 'person' },
  { id: 'events', label: 'Browser error reports', methods: ['POST'], path: /^\/api\/events$/, limit: 30, windowMs: MIN, per: 'person' },
  { id: 'feedback', label: 'AI feedback from agents', methods: ['POST'], path: /^\/api\/feedback$/, limit: 60, windowMs: MIN, per: 'person' },
  { id: 'export', label: 'Log downloads', methods: ['GET'], path: /^\/api\/(logs|audit)\/export/, limit: 10, windowMs: MIN, per: 'person' },
  { id: 'system', label: 'Super admin System pages', methods: ['GET', 'POST', 'DELETE'], path: /^\/api\/system/, limit: 240, windowMs: MIN, per: 'person' },
  { id: 'save', label: 'Saving shared data', methods: ['POST'], path: /^\/api\/data$/, limit: 60, windowMs: MIN, per: 'person' },
  { id: 'poll', label: 'Reading shared data', methods: ['GET'], path: /^\/api\/data$/, limit: 90, windowMs: MIN, per: 'person' },
  { id: 'general', label: 'Everything else', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], path: /^\/api\//, limit: 600, windowMs: MIN, per: 'person' },
];

/** The rules as plain data for the API page (regexes are not JSON). */
export const describeRules = () => RATE_RULES.map((r) => ({ id: r.id, label: r.label, methods: r.methods, path: r.path.source.replace(/\\\//g, '/').replace(/^\^/, ''), limit: r.limit, windowMs: r.windowMs, per: r.per }));

export type Verdict = { ok: true } | { ok: false; rule: RateRule; retryAfterSec: number };

export function createLimiter(rules: RateRule[] = RATE_RULES, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  function sweep(t: number) {
    if (t - lastSweep < MIN) return;
    lastSweep = t;
    const longest = Math.max(...rules.map((r) => r.windowMs));
    for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > longest) hits.delete(k);
  }

  return {
    /** Counts this request against the first rule it matches. `person` and `address` are opaque keys. */
    check(method: string, path: string, who: { person?: string; address: string }): Verdict {
      const t = now();
      sweep(t);
      const rule = rules.find((r) => r.methods.includes(method) && r.path.test(path));
      if (!rule) return { ok: true };
      const key = `${rule.id}|${rule.per === 'person' && who.person ? `p:${who.person}` : `a:${who.address}`}`;
      const list = (hits.get(key) ?? []).filter((x) => t - x < rule.windowMs);
      if (list.length >= rule.limit) {
        hits.set(key, list);
        return { ok: false, rule, retryAfterSec: Math.max(1, Math.ceil((list[0] + rule.windowMs - t) / 1000)) };
      }
      list.push(t);
      hits.set(key, list);
      return { ok: true };
    },
    size: () => hits.size,
  };
}

/** Who is asking: the session cookie (hashed, so nothing secret is kept) and the network address. */
export function requesterOf(req: IncomingMessage): { person?: string; address: string } {
  const cookie = String(req.headers.cookie ?? '').match(/(?:^|;\s*)tcc_session=([^;]+)/)?.[1];
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return {
    person: cookie ? crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 16) : undefined,
    address: fwd || req.socket?.remoteAddress || 'unknown',
  };
}
