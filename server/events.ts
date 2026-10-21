// What the super admin's System page reads: every API request (kept in memory, newest 500, plus per-endpoint
// counts since the server started) and notable events — sign-ins, failures, errors from the server and from
// people's browsers — kept in the `events` table for 30 days.

import type pg from 'pg';

export type EventLevel = 'info' | 'warn' | 'error';

export interface ServerEvent {
  ts: number;
  level: EventLevel;
  /** Where it happened: 'auth', 'api', 'analysis', 'browser', 'people', 'system' … */
  source: string;
  message: string;
  agentId?: string;
  agentName?: string;
  detail?: unknown;
}

export interface RequestRow {
  ts: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  agentName?: string;
}

export interface EndpointStat {
  endpoint: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
  lastStatus: number;
  lastTs: number;
}

const MAX_REQUESTS = 500;
const requests: RequestRow[] = [];
const endpoints = new Map<string, EndpointStat>();
const memoryEvents: ServerEvent[] = [];
export const startedAt = Date.now();

/** "/api/recordings/rec_123.wav" → "/api/recordings/:id", so the endpoint table groups them. */
export function endpointKey(method: string, path: string): string {
  const p = path
    .replace(/^\/api\/recordings\/[^/]+$/, '/api/recordings/:file')
    .replace(/^\/api\/people\/[^/]+\/password$/, '/api/people/:id/password')
    .replace(/^\/api\/notices\/[^/]+\/done$/, '/api/notices/:id/done');
  return `${method} ${p}`;
}

export function recordRequest(row: RequestRow) {
  requests.unshift(row);
  if (requests.length > MAX_REQUESTS) requests.length = MAX_REQUESTS;
  const key = endpointKey(row.method, row.path);
  const s = endpoints.get(key) ?? { endpoint: key, count: 0, errors: 0, totalMs: 0, maxMs: 0, lastStatus: 0, lastTs: 0 };
  s.count++;
  if (row.status >= 400) s.errors++;
  s.totalMs += row.ms;
  s.maxMs = Math.max(s.maxMs, row.ms);
  s.lastStatus = row.status;
  s.lastTs = row.ts;
  endpoints.set(key, s);
}

export const recentRequests = () => requests.slice();
export const endpointStats = () => [...endpoints.values()].sort((a, b) => b.count - a.count);

let pool: (() => Promise<pg.Pool>) | null = null;
let lastPrune = 0;

/** Events go to the database once one is connected; until then (or without one) they stay in memory. */
export function connectEventStore(getPool: () => Promise<pg.Pool>) {
  pool = getPool;
}

export function logEvent(e: Omit<ServerEvent, 'ts'> & { ts?: number }) {
  const ev: ServerEvent = { ...e, ts: e.ts ?? Date.now(), message: e.message.slice(0, 500) };
  memoryEvents.unshift(ev);
  if (memoryEvents.length > 300) memoryEvents.length = 300;
  if (ev.level === 'error') console.error(`[tcc ${ev.source}] ${ev.message}`);
  if (!pool) return;
  void pool()
    .then(async (p) => {
      await p.query('insert into events (ts, level, source, message, agent_id, doc) values (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6)', [ev.ts, ev.level, ev.source, ev.message, ev.agentId ?? null, JSON.stringify(ev)]);
      if (Date.now() - lastPrune > 6 * 3600_000) {
        lastPrune = Date.now();
        await p.query("delete from events where ts < now() - interval '30 days'");
      }
    })
    .catch(() => {});
}

export async function recentEvents(p: pg.Pool | null, limit = 300): Promise<ServerEvent[]> {
  if (!p) return memoryEvents.slice(0, limit);
  const r = await p.query<{ doc: ServerEvent }>('select doc from events order by ts desc limit $1', [limit]);
  return r.rows.map((x) => x.doc);
}
