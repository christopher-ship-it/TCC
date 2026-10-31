// Every call TCC makes to another service on its own account (a product's customer API, and later others): what was
// asked, what came back and how long it took. Kept in memory (the newest 300, plus counts per endpoint since the server
// started) for the super admin's API page. Never records keys, headers, request bodies or query values.

export interface OutboundCall {
  ts: number;
  /** Which product or service: 'irondrobe', 'realbroks' … */
  service: string;
  method: string;
  /** The endpoint with ids and query values taken out: "customers", "customers/:id". */
  endpoint: string;
  status: number;
  ms: number;
  /** Why it failed, in plain words, when it did. */
  error?: string;
}

export interface OutboundStat {
  service: string;
  method: string;
  endpoint: string;
  count: number;
  errors: number;
  avgMs: number;
  maxMs: number;
  lastStatus: number;
  lastTs: number;
  lastOkTs: number | null;
  lastError: string | null;
}

const MAX = 300;
const calls: OutboundCall[] = [];
const stats = new Map<string, OutboundStat & { totalMs: number }>();

/** "customers/u_8f2c91" → "customers/:id", query stripped. */
export function endpointOf(path: string): string {
  const p = path.split('?')[0].replace(/^\/+/, '');
  return p.replace(/^(customers)\/(?!lookup$)[^/]+$/, '$1/:id');
}

export function recordOutbound(c: OutboundCall) {
  calls.unshift(c);
  if (calls.length > MAX) calls.length = MAX;
  const key = `${c.service} ${c.method} ${c.endpoint}`;
  const s = stats.get(key) ?? { service: c.service, method: c.method, endpoint: c.endpoint, count: 0, errors: 0, avgMs: 0, maxMs: 0, lastStatus: 0, lastTs: 0, lastOkTs: null, lastError: null, totalMs: 0 };
  s.count++;
  s.totalMs += c.ms;
  s.avgMs = Math.round(s.totalMs / s.count);
  s.maxMs = Math.max(s.maxMs, c.ms);
  s.lastStatus = c.status;
  s.lastTs = c.ts;
  if (c.status >= 200 && c.status < 400) s.lastOkTs = c.ts;
  else {
    s.errors++;
    s.lastError = c.error ?? `HTTP ${c.status}`;
  }
  stats.set(key, s);
}

export const outboundStats = (service?: string): OutboundStat[] =>
  [...stats.values()].filter((s) => !service || s.service === service).map(({ totalMs: _t, ...s }) => s).sort((a, b) => b.count - a.count);

export const recentOutbound = (service?: string, limit = 50): OutboundCall[] => calls.filter((c) => !service || c.service === service).slice(0, limit);

/** For tests. */
export function resetOutbound() {
  calls.length = 0;
  stats.clear();
}
