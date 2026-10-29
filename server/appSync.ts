// Keeps TCC's customers in step with each product's own database, through the read-only TCC Data API the product
// exposes (docs/client-api-guide). Every few minutes it asks for customers changed since the last run, and once a day
// for everyone, so anything missed heals itself. How a product's record becomes a TCC customer: src/lib/appSync.ts.
//
// Configured per product with <APP>_API_URL and <APP>_API_KEY (e.g. IRONDROBE_API_URL, IRONDROBE_API_KEY). The key
// stays on the server: it is never logged, never sent to a browser, never part of an error message.

import type pg from 'pg';
import { applySource, phoneTail, pickPerNumber, sameCustomer, sourceDigits, type SourceCustomer, type SourceMeta } from '../src/lib/appSync.ts';
import type { AppId, CustomerUser } from '../src/data/types.ts';
import { logEvent } from './events.ts';

export interface SourceConfig {
  app: AppId;
  /** Base URL ending in /api/tcc/v1/ (or wherever the product serves it). */
  url: string;
  key: string;
}

export const SOURCE_APPS: AppId[] = ['realbroks', 'irondrobe', 'influnet', 'vehigo'];

export function sourcesFromEnv(vars: Record<string, string | undefined>): SourceConfig[] {
  return SOURCE_APPS.flatMap((app) => {
    const url = vars[`${app.toUpperCase()}_API_URL`]?.trim();
    const key = vars[`${app.toUpperCase()}_API_KEY`]?.trim();
    return url && key ? [{ app, url: url.endsWith('/') ? url : `${url}/`, key }] : [];
  });
}

export interface SyncResult {
  app: AppId;
  full: boolean;
  startedAt: number;
  ms: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: { noPhone: number; otherProduct: number; closed: number };
  error?: string;
}

interface SavedState {
  /** Newest updated_at seen from the product: the next run asks for changes from just before it. */
  since: string | null;
  lastFullAt: number | null;
  last: SyncResult | null;
}

export class SourceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** One call to a product's API. Errors name the product and the status, never the key. */
async function call<T>(src: SourceConfig, path: string, init?: { body?: unknown; fetchImpl?: typeof fetch }): Promise<T> {
  const doFetch = init?.fetchImpl ?? fetch;
  const res = await doFetch(new URL(path, src.url), {
    method: init?.body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${src.key}`, Accept: 'application/json', ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) throw new SourceError(res.status, `${src.app} API answered ${res.status}${body?.error?.code ? ` (${body.error.code})` : ''}`);
  return body as T;
}

const OVERLAP_MS = 60_000;
const PAGE = 500;
const DAY_MS = 86_400_000;

export interface SourceSyncOptions {
  /** Minutes between change checks (TCC_SOURCE_SYNC_MINUTES, default 10). */
  everyMinutes?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createSourceSync(getPool: () => Promise<pg.Pool>, sources: SourceConfig[], opts: SourceSyncOptions = {}) {
  const now = opts.now ?? Date.now;
  const running = new Map<AppId, Promise<SyncResult>>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const settingKey = (app: AppId) => `source_sync:${app}`;

  async function loadState(pool: pg.Pool, app: AppId): Promise<SavedState> {
    const v = (await pool.query<{ value: SavedState }>('select value from settings where key = $1', [settingKey(app)])).rows[0]?.value;
    return { since: v?.since ?? null, lastFullAt: v?.lastFullAt ?? null, last: v?.last ?? null };
  }

  async function saveState(pool: pg.Pool, app: AppId, s: SavedState) {
    await pool.query(
      `insert into settings (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [settingKey(app), JSON.stringify(s)],
    );
  }

  /** Every customer TCC has, by the last 10 digits of their number: the record a product's customer is matched to. */
  async function phoneIndex(pool: pg.Pool): Promise<Map<string, { id: string; app: string; adHoc: boolean }[]>> {
    const rows = (await pool.query<{ id: string; phone: string | null; app: string; adhoc: boolean }>(
      "select id, doc->>'phone' as phone, doc->>'app' as app, coalesce((doc->>'adHoc')::boolean, false) as adhoc from customers",
    )).rows;
    const index = new Map<string, { id: string; app: string; adHoc: boolean }[]>();
    for (const r of rows) {
      if (!r.phone) continue;
      const key = phoneTail(r.phone);
      index.set(key, [...(index.get(key) ?? []), { id: r.id, app: r.app, adHoc: r.adhoc }]);
    }
    return index;
  }

  /** The record a number belongs to: this product's customer first, then a dialled-in/incoming record, then anyone's. */
  function matchId(index: Map<string, { id: string; app: string; adHoc: boolean }[]>, digits: string, app: AppId): string | undefined {
    const hits = index.get(phoneTail(digits)) ?? [];
    return (hits.find((h) => h.app === app && !h.adHoc) ?? hits.find((h) => h.adHoc) ?? hits[0])?.id;
  }

  /** Lays one page of the product's customers over TCC's, in one short transaction. */
  async function applyPage(pool: pg.Pool, src: SourceConfig, meta: SourceMeta | undefined, rows: SourceCustomer[], index: Awaited<ReturnType<typeof phoneIndex>>, result: SyncResult) {
    const chosen = [...pickPerNumber(rows).values()];
    result.skipped.noPhone += rows.filter((r) => !sourceDigits(r)).length;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const ids = chosen.map((r) => matchId(index, r.phone ?? '', src.app)).filter((id): id is string => Boolean(id));
      const stored = new Map((await client.query<{ id: string; doc: CustomerUser }>('select id, doc from customers where id = any($1::text[]) for update', [ids])).rows.map((r) => [r.id, r.doc]));
      const writes: CustomerUser[] = [];
      const at = now();
      for (const r of chosen) {
        const id = matchId(index, r.phone ?? '', src.app);
        const existing = id ? stored.get(id) : undefined;
        const out = applySource(existing, r, src.app, meta, at);
        if ('skip' in out) {
          if (out.skip === 'no-phone') result.skipped.noPhone++;
          else if (out.skip === 'other-product') result.skipped.otherProduct++;
          else result.skipped.closed++;
          continue;
        }
        if (sameCustomer(existing, out.customer)) {
          result.unchanged++;
          continue;
        }
        if (existing) result.updated++;
        else {
          result.created++;
          index.set(phoneTail(out.customer.phone), [...(index.get(phoneTail(out.customer.phone)) ?? []), { id: out.customer.id, app: src.app, adHoc: false }]);
        }
        writes.push(out.customer);
      }
      if (writes.length) {
        await client.query(
          `insert into customers (id, owner_id, doc, updated_at)
             select x.id, x.doc->>'ownerAgentId', x.doc, now() from jsonb_to_recordset($1::jsonb) as x(id text, doc jsonb)
           on conflict (id) do update set owner_id = excluded.owner_id, doc = excluded.doc, updated_at = now()`,
          [JSON.stringify(writes.map((doc) => ({ id: doc.id, doc })))],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function runOnce(src: SourceConfig, forceFull: boolean): Promise<SyncResult> {
    const pool = await getPool();
    const saved = await loadState(pool, src.app);
    const startedAt = now();
    const full = forceFull || !saved.since || !saved.lastFullAt || startedAt - saved.lastFullAt > DAY_MS;
    const result: SyncResult = { app: src.app, full, startedAt, ms: 0, fetched: 0, created: 0, updated: 0, unchanged: 0, skipped: { noPhone: 0, otherProduct: 0, closed: 0 } };
    try {
      const meta = await call<SourceMeta>(src, 'meta', { fetchImpl: opts.fetchImpl }).catch(() => undefined);
      const index = await phoneIndex(pool);
      const since = !full && saved.since ? new Date(Date.parse(saved.since) - OVERLAP_MS).toISOString() : null;
      let newest = saved.since;
      let cursor: string | null = null;
      for (let page = 0; page < 1000; page++) {
        const q = new URLSearchParams({ limit: String(PAGE), include_deleted: 'true' });
        if (since) q.set('updated_since', since);
        if (cursor) q.set('cursor', cursor);
        const body: { data: SourceCustomer[]; next_cursor: string | null; has_more: boolean } = await call(src, `customers?${q}`, { fetchImpl: opts.fetchImpl });
        const rows = (body.data ?? []).filter((r) => r && typeof r.id !== 'undefined');
        result.fetched += rows.length;
        for (const r of rows) if (r.updated_at && (!newest || r.updated_at > newest)) newest = r.updated_at;
        if (rows.length) await applyPage(pool, src, meta, rows, index, result);
        if (!body.has_more || !body.next_cursor) break;
        cursor = body.next_cursor;
      }
      await saveState(pool, src.app, { since: newest, lastFullAt: full ? startedAt : saved.lastFullAt, last: { ...result, ms: now() - startedAt } });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
      await saveState(pool, src.app, { ...saved, last: { ...result, ms: now() - startedAt } }).catch(() => {});
    }
    result.ms = now() - startedAt;
    const changed = result.created + result.updated;
    if (result.error) logEvent({ level: 'error', source: 'sync', message: `${src.app} sync failed: ${result.error}` });
    else if (changed || result.full) {
      logEvent({ level: 'info', source: 'sync', message: `${src.app} ${result.full ? 'full sync' : 'sync'}: ${result.fetched} fetched, ${result.created} new, ${result.updated} updated${result.skipped.otherProduct ? `, ${result.skipped.otherProduct} already another product's` : ''}${result.skipped.noPhone ? `, ${result.skipped.noPhone} without a phone` : ''}` });
    }
    return result;
  }

  /** Runs one product's sync, or joins the run already going. */
  function run(app: AppId, full = false): Promise<SyncResult> {
    const src = sources.find((s) => s.app === app);
    if (!src) return Promise.reject(new SourceError(404, `${app} is not connected (set ${app.toUpperCase()}_API_URL and ${app.toUpperCase()}_API_KEY).`));
    const going = running.get(app);
    if (going) return going;
    const p = runOnce(src, full).finally(() => running.delete(app));
    running.set(app, p);
    return p;
  }

  return {
    configured: sources.length > 0,

    /** Starts the schedule: a first run shortly after start-up, then every few minutes. */
    start() {
      if (timer || !sources.length) return;
      const every = Math.max(1, opts.everyMinutes ?? 10) * 60_000;
      const tick = () => {
        for (const s of sources) void run(s.app).catch(() => {});
      };
      setTimeout(tick, 20_000).unref?.();
      timer = setInterval(tick, every);
      timer.unref?.();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    run,

    /** For the super admin's System page. */
    async status() {
      const pool = await getPool();
      return Promise.all(
        sources.map(async (s) => {
          const st = await loadState(pool, s.app);
          return { app: s.app, host: new URL(s.url).host, running: running.has(s.app), since: st.since, lastFullAt: st.lastFullAt, last: st.last };
        }),
      );
    },

    /**
     * An incoming caller TCC doesn't know: ask the products the agent works for. A match is saved as a customer straight
     * away (so the call lands on a real record) and returned; null when no product knows the number.
     */
    async lookup(phone: string, apps: AppId[]): Promise<CustomerUser | null> {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 10) return null;
      const pool = await getPool();
      for (const src of sources.filter((s) => apps.includes(s.app))) {
        const found = await call<{ data: SourceCustomer[] }>(src, 'customers/lookup', { body: { phone }, fetchImpl: opts.fetchImpl }).catch(() => ({ data: [] }));
        const best = pickPerNumber((found.data ?? []).filter((r) => r.account_status === 'active')).get(digits.slice(-10));
        if (!best) continue;
        const result: SyncResult = { app: src.app, full: false, startedAt: now(), ms: 0, fetched: 1, created: 0, updated: 0, unchanged: 0, skipped: { noPhone: 0, otherProduct: 0, closed: 0 } };
        const meta = await call<SourceMeta>(src, 'meta', { fetchImpl: opts.fetchImpl }).catch(() => undefined);
        await applyPage(pool, src, meta, [best], await phoneIndex(pool), result);
        if (result.skipped.otherProduct) return null;
        const id = (await phoneIndex(pool)).get(digits.slice(-10))?.find((h) => h.app === src.app && !h.adHoc)?.id;
        const doc = id ? (await pool.query<{ doc: CustomerUser }>('select doc from customers where id = $1', [id])).rows[0]?.doc : undefined;
        if (doc) {
          logEvent({ level: 'info', source: 'sync', message: `Incoming caller found in ${src.app}: ${doc.name}` });
          return doc;
        }
      }
      return null;
    },
  };
}

export type SourceSync = ReturnType<typeof createSourceSync>;
