// Shared data for a TCC deployment that runs on its own database (VITE_STORE=server): sign-in with a username and a
// password an admin sets, sessions in an HttpOnly cookie, and the records every screen works on (people, customers,
// escalations, change log) kept in Postgres so every agent sees the same thing.
//
//   GET  /api/auth/me                 → { setupNeeded, setupCodeRequired, agent }
//   POST /api/auth/setup              → { name, username, password, code?, apps } — the very first admin, once
//   POST /api/auth/login              → { username, password }
//   POST /api/auth/logout
//   GET  /api/data?since=<cursor>     → everything changed since the cursor (everything, without one)
//   POST /api/data                    → { agents?, customers?, escalations?, audit?, cleared? } — upserts
//   POST /api/people                  → { agent, password } — adds a person with their login
//   POST /api/people/:id/password     → { password } — sets a person's password
//   GET/POST /api/notes, DELETE /api/notes/:id → an agent's own notes, and notes admins leave for every agent

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type pg from 'pg';
import { logEvent } from './events.ts';
import type { SourceSync } from './appSync.ts';
import { keepSourceFields } from '../src/lib/appSync.ts';
import type { CustomerUser as FullCustomer } from '../src/data/types.ts';
// The records as stored. The full shapes live in src/data/types.ts (the browser's); the server only relies on these fields.
type AppId = string;
interface AgentAccount {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: 'agent' | 'supervisor' | 'admin';
  status?: 'active' | 'invited' | 'suspended';
  trainee?: boolean;
  apps: AppId[];
  capabilities?: Record<string, string[]>;
  queues: string[];
  languages: string[];
  states: string[];
  /** Tecstellar's own account: sees and repairs everything, invisible to the client's admins. */
  superAdmin?: boolean;
  [extra: string]: unknown;
}
interface CallLogEntry {
  id: string;
  atTs: number;
  [extra: string]: unknown;
}
interface CustomerUser {
  id: string;
  app: AppId;
  phone: string;
  ownerAgentId: string | null;
  callHistory: CallLogEntry[];
  [extra: string]: unknown;
}
interface EscalationRecord {
  id: string;
  status: string;
  [extra: string]: unknown;
}
interface AuditEntry {
  id: string;
  ts: number;
  actorId: string;
  actorName: string;
  action: string;
  target?: string;
  detail: string;
}

/** A note: private to its author ('me'), or one an admin or supervisor left for every agent ('agents'). */
export interface NoteDoc {
  id: string;
  ownerId: string;
  ownerName: string;
  audience: 'me' | 'agents';
  app?: string;
  title: string;
  body: string;
  createdTs: number;
  updatedTs: number;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const COOKIE = 'tcc_session';
const SESSION_MS = 30 * 86400_000;
/** A username, or an email address used as one. */
const USERNAME_RE = /^[a-z0-9._@+-]{3,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 6;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, s, h] = stored.split('$');
  if (kind !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function secure(req: IncomingMessage): boolean {
  return String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}

function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string | null) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(secure(req) ? ['Secure'] : [])];
  res.setHeader('Set-Cookie', token ? `${COOKIE}=${token}; Max-Age=${SESSION_MS / 1000}; ${attrs.join('; ')}` : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`);
}

const isActive = (a: AgentAccount) => (a.status ?? 'active') === 'active';

function auditRow(actor: AgentAccount, action: AuditEntry['action'], target: string | undefined, detail: string): AuditEntry {
  const ts = Date.now();
  return { id: `audit-${ts}-${crypto.randomBytes(3).toString('hex')}`, ts, actorId: actor.id, actorName: actor.name, action, target, detail };
}

async function writeAudit(db: pg.Pool | pg.PoolClient, e: AuditEntry) {
  // Everything that reaches the change log also reaches the super admin's event log (sign-ins log themselves).
  if (e.action !== 'signed_in') logEvent({ level: 'info', source: 'activity', message: `${e.actorName}: ${e.detail}${e.target ? ` — ${e.target}` : ''}`, agentId: e.actorId, agentName: e.actorName });
  await db.query('insert into audit_log (id, ts, actor_id, action, doc) values ($1, to_timestamp($2 / 1000.0), $3, $4, $5) on conflict (id) do nothing', [e.id, e.ts, e.actorId, e.action, JSON.stringify(e)]);
}

async function upsertAgent(db: pg.Pool | pg.PoolClient, a: AgentAccount) {
  await db.query(
    `insert into agents (id, email, role, status, doc, updated_at) values ($1, $2, $3, $4, $5, now())
     on conflict (id) do update set email = excluded.email, role = excluded.role, status = excluded.status, doc = excluded.doc, updated_at = now()`,
    [a.id, a.email ?? null, a.role, a.status ?? 'active', JSON.stringify(a)],
  );
}

/** Two people working the same customer must not lose each other's calls: keep every call either side has. */
export function mergeCustomer(stored: CustomerUser | undefined, incoming: CustomerUser): CustomerUser {
  if (!stored) return incoming;
  // A customer linked to the product's own database: the browser's copy may be older than the last sync.
  incoming = keepSourceFields(stored as unknown as FullCustomer, incoming as unknown as FullCustomer) as unknown as CustomerUser;
  // A browser that has not seen the deletion yet must not quietly bring the customer back; only an explicit `null` does.
  if (stored.deleted && incoming.deleted === undefined) incoming = { ...incoming, deleted: stored.deleted };
  if (incoming.deleted === null) delete incoming.deleted;
  const byId = new Map<string, CallLogEntry>();
  for (const c of stored.callHistory ?? []) byId.set(c.id, c);
  for (const c of incoming.callHistory ?? []) byId.set(c.id, { ...byId.get(c.id), ...c });
  const callHistory = [...byId.values()].sort((a, b) => b.atTs - a.atTs);
  return { ...incoming, callHistory };
}

/** A tiny brake on password guessing: 10 failures per username per 15 minutes. */
const failures = new Map<string, number[]>();
function tooManyFailures(key: string): boolean {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
  failures.set(key, recent);
  return recent.length >= 10;
}
const noteFailure = (key: string) => failures.set(key, [...(failures.get(key) ?? []), Date.now()]);

export interface StoreEnv {
  setupCode?: string;
  /** Health of everything this server depends on, for the super admin (built in api.ts). */
  systemHealth?: () => Promise<Record<string, unknown>>;
  /** A live test of one dependency: 'database' | 'gemini' | 'telecmi'. */
  check?: (what: string) => Promise<{ ok: boolean; message: string; ms: number }>;
  /** Customers synced from each product's own database (server/appSync.ts). */
  sources?: SourceSync;
}

export interface Notice {
  id: string;
  /** password_change: super admin lets this person choose a new password. password_request: someone asks the super admin for one. */
  kind: 'password_change' | 'password_request' | 'message';
  /** For a password_request: whose password it is about. */
  subjectId?: string;
  subjectName?: string;
  title: string;
  body: string;
  fromName: string;
  ts: number;
}

/** Who made this request, once known — for the request log. */
export const requestAgent = new WeakMap<IncomingMessage, AgentAccount>();

const browserReports = new Map<string, number[]>();

type ReadJson = (req: IncomingMessage, max?: number) => Promise<unknown>;
type Send = (res: ServerResponse, status: number, body: unknown) => void;

export function createStore(getPool: () => Promise<pg.Pool>, env: StoreEnv, readJson: ReadJson, send: Send) {
  async function newSession(req: IncomingMessage, res: ServerResponse, pool: pg.Pool, agentId: string) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query("insert into sessions (token_hash, agent_id, expires_at) values ($1, $2, now() + interval '30 days')", [tokenHash(token), agentId]);
    setSessionCookie(req, res, token);
  }

  /** Who is signed in, or null. A suspended person's session stops working at once. */
  async function whoAmI(req: IncomingMessage, pool: pg.Pool): Promise<AgentAccount | null> {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const hash = tokenHash(token);
    const r = await pool.query<{ doc: AgentAccount; stale: boolean }>("select a.doc, s.last_seen_at < now() - interval '1 minute' as stale from sessions s join agents a on a.id = s.agent_id where s.token_hash = $1 and s.expires_at > now()", [hash]);
    const me = r.rows[0]?.doc;
    if (!me || !isActive(me)) return null;
    if (r.rows[0].stale) void pool.query('update sessions set last_seen_at = now() where token_hash = $1', [hash]).catch(() => {});
    requestAgent.set(req, me);
    return me;
  }

  async function requireMe(req: IncomingMessage, pool: pg.Pool): Promise<AgentAccount> {
    const me = await whoAmI(req, pool);
    if (!me) throw new HttpError(401, 'Your session has ended. Sign in again.');
    return me;
  }

  async function usernameTaken(db: pg.Pool | pg.PoolClient, username: string, exceptId?: string): Promise<boolean> {
    const r = await db.query("select 1 from agents where (lower(doc->>'username') = $1 or lower(email) = $1) and id <> $2 union select 1 from logins where username = $1 and agent_id <> $2", [username, exceptId ?? '']);
    return r.rowCount! > 0;
  }

  /** What the super admin lets client admins and agents see. Missing = everything (except the super admin's own traces). */
  async function getVisibility(pool: pg.Pool): Promise<{ changeLog: boolean }> {
    const v = (await pool.query<{ value: { changeLog?: boolean } }>("select value from settings where key = 'visibility'")).rows[0]?.value;
    return { changeLog: v?.changeLog !== false };
  }

  async function openNotices(pool: pg.Pool, agentId: string): Promise<Notice[]> {
    const r = await pool.query<{ doc: Notice }>('select doc from notices where agent_id = $1 and done_at is null order by created_at desc', [agentId]);
    return r.rows.map((x) => x.doc);
  }

  /** Whether `me` may change `target`'s account (password, sign-in, inbox). Nobody but Tecstellar touches its own account. */
  const mayManage = (me: AgentAccount, target: AgentAccount) =>
    target.id === me.id || (target.superAdmin ? !!me.superAdmin : me.role === 'admin' || (me.role === 'supervisor' && target.role === 'agent'));

  /** Handles a store route; false when the path is not one of them. */
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    if (!p.startsWith('/api/auth/') && p !== '/api/data' && !p.startsWith('/api/people') && !p.startsWith('/api/notices') && !p.startsWith('/api/notes') && p !== '/api/password-requests' && p !== '/api/events' && !p.startsWith('/api/system') && p !== '/api/sources/lookup') return false;
    const pool = await getPool();

    if (req.method === 'GET' && p === '/api/auth/me') {
      const n = Number((await pool.query<{ n: string }>('select count(*) as n from agents')).rows[0].n);
      // Accounts are made by Tecstellar (tools/accounts.ts); the setup form only exists when a setup code is configured.
      send(res, 200, { setupNeeded: n === 0, setupAllowed: Boolean(env.setupCode), setupCodeRequired: Boolean(env.setupCode), agent: n ? await whoAmI(req, pool) : null });
      return true;
    }

    if (req.method === 'POST' && p === '/api/auth/setup') {
      const b = (await readJson(req)) as Record<string, unknown>;
      if (!env.setupCode) throw new HttpError(403, 'Accounts for this Command Center are created by Tecstellar.');
      if (b.code !== env.setupCode) throw new HttpError(403, 'That setup code is not right.');
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
      const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
      if (!name) throw new HttpError(400, 'Enter your name.');
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Use 3+ lowercase letters, numbers, dots or dashes for the username.');
      const pw = passwordProblem(b.password);
      if (pw) throw new HttpError(400, pw);
      const apps = Array.isArray(b.apps) ? b.apps.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(727002)');
        if (Number((await client.query<{ n: string }>('select count(*) as n from agents')).rows[0].n) > 0) throw new HttpError(409, 'Command Center is already set up. Sign in instead.');
        const admin: AgentAccount = {
          id: `${username.replace(/[^a-z0-9]+/g, '-')}-admin`,
          name,
          username,
          role: 'admin',
          status: 'active',
          apps,
          queues: [],
          languages: ['English'],
          states: [],
          dailyTarget: 0,
          clickToDial: true,
          createdTs: Date.now(),
          lastActiveLabel: 'now',
          todayCalls: 0,
          todayConnected: 0,
          todayPositive: 0,
          todaySubscribed: 0,
          todayOverdue: 0,
          avgHandleLabel: '—',
          workingQueueLabel: '—',
        };
        await upsertAgent(client, admin);
        await client.query('insert into logins (agent_id, username, password_hash) values ($1, $2, $3)', [admin.id, username, await hashPassword(b.password as string)]);
        await writeAudit(client, auditRow(admin, 'user_created', admin.name, 'Set up Command Center · first admin'));
        await client.query('commit');
        await newSession(req, res, pool, admin.id);
        send(res, 200, { agent: admin });
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return true;
    }

    if (req.method === 'POST' && p === '/api/auth/login') {
      const b = (await readJson(req)) as Record<string, unknown>;
      const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
      const password = typeof b.password === 'string' ? b.password : '';
      if (tooManyFailures(username)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes or ask your admin to reset it.');
      const r = await pool.query<{ password_hash: string; doc: AgentAccount }>('select l.password_hash, a.doc from logins l join agents a on a.id = l.agent_id where l.username = $1 or lower(a.email) = $1 limit 1', [username]);
      const row = r.rows[0];
      if (!row || !(await verifyPassword(password, row.password_hash))) {
        noteFailure(username);
        logEvent({ level: 'warn', source: 'auth', message: `Wrong password for “${username.slice(0, 60)}”`, agentId: row?.doc.id, agentName: row?.doc.name });
        throw new HttpError(401, 'Wrong username or password.');
      }
      if (!isActive(row.doc)) {
        logEvent({ level: 'warn', source: 'auth', message: `${row.doc.name} tried to sign in while suspended`, agentId: row.doc.id, agentName: row.doc.name });
        throw new HttpError(403, 'This account is suspended. Ask your admin to reactivate it.');
      }
      logEvent({ level: 'info', source: 'auth', message: `${row.doc.name} signed in`, agentId: row.doc.id, agentName: row.doc.name });
      failures.delete(username);
      await newSession(req, res, pool, row.doc.id);
      await writeAudit(pool, auditRow(row.doc, 'signed_in', undefined, 'Signed in'));
      send(res, 200, { agent: row.doc });
      return true;
    }

    if (req.method === 'POST' && p === '/api/auth/logout') {
      const token = readCookie(req, COOKIE);
      if (token) {
        const me = await whoAmI(req, pool);
        await pool.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
        if (me) await writeAudit(pool, auditRow(me, 'signed_out', undefined, 'Signed out'));
      }
      setSessionCookie(req, res, null);
      send(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'GET' && p === '/api/data') {
      const me = await requireMe(req, pool);
      const cursor = (await pool.query<{ t: string }>("select (now() - interval '5 seconds')::text as t")).rows[0].t;
      const since = url.searchParams.get('since');
      const after = since ? 'updated_at > $1::timestamptz' : 'true';
      const args = since ? [since] : [];
      const seeAll = me.role !== 'agent';
      const agents = (await pool.query<{ doc: AgentAccount }>(`select doc from agents where ${after}`, args)).rows.map((r) => r.doc).filter((a) => me.superAdmin || !a.superAdmin);
      const customers = (
        await pool.query<{ doc: CustomerUser }>(
          `select doc from customers where ${after}${seeAll ? '' : ` and doc->>'app' = any($${args.length + 1}::text[])`}`,
          seeAll ? args : [...args, me.apps],
        )
      ).rows.map((r) => r.doc);
      const escalations = (await pool.query<{ doc: EscalationRecord }>(`select doc from escalations where ${after}`, args)).rows.map((r) => r.doc);
      const visibility = await getVisibility(pool);
      // Client admins and agents never see what the super admin (or Tecstellar's setup tool) did, or anything about them;
      // and when the super admin has turned the Change log off for them, they get none. Customer deletions (and their
      // reasons) are the super admin's alone.
      let audit: AuditEntry[] = [];
      if (me.superAdmin) {
        audit = (await pool.query<{ doc: AuditEntry }>(`select doc from audit_log where ${since ? 'ts > $1::timestamptz' : 'true'} order by ts desc limit 1000`, args)).rows.map((r) => r.doc);
      } else if (visibility.changeLog) {
        const supers = (await pool.query<{ id: string; n: string }>("select id, doc->>'name' as n from agents where coalesce((doc->>'superAdmin')::boolean, false)")).rows;
        const n = args.length;
        audit = (
          await pool.query<{ doc: AuditEntry }>(
            `select doc from audit_log where ${since ? 'ts > $1::timestamptz' : 'true'}
               and actor_id <> all($${n + 1}::text[]) and coalesce(doc->>'target', '') <> all($${n + 2}::text[]) and action <> 'customer_deleted'
             order by ts desc limit 1000`,
            [...args, [...supers.map((s) => s.id), 'tecstellar-cli'], supers.map((s) => s.n)],
          )
        ).rows.map((r) => r.doc);
      }
      const cleared = (await pool.query<{ value: unknown }>(`select value from settings where key = 'clearedEscalations' and ${after}`, args)).rows[0]?.value;
      send(res, 200, { cursor, me, agents, customers, escalations, audit, cleared, visibility, notices: await openNotices(pool, me.id) });
      return true;
    }

    if (req.method === 'POST' && p === '/api/data') {
      const me = await requireMe(req, pool);
      const b = (await readJson(req, 16 * 1024 * 1024)) as Record<string, unknown>;
      const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') : []);
      const changes: string[] = [];
      const client = await pool.connect();
      try {
        await client.query('begin');

        for (const a of list<AgentAccount>(b.agents)) {
          const stored = (await client.query<{ doc: AgentAccount }>('select doc from agents where id = $1 for update', [a.id])).rows[0]?.doc;
          if (!stored) continue; // people are added through /api/people, with their login
          if (stored.superAdmin && !me.superAdmin) continue;
          a.superAdmin = stored.superAdmin;
          if (me.role === 'agent' && a.id !== me.id) continue;
          if (me.role === 'supervisor' && (stored.role !== 'agent' || a.role !== 'agent') && a.id !== me.id) continue;
          if (me.role === 'admin' && !me.superAdmin && stored.role === 'admin' && a.id !== me.id && a.role !== 'admin' && !(await client.query("select 1 from agents where role = 'admin' and status = 'active' and id <> $1 and not coalesce((doc->>'superAdmin')::boolean, false)", [a.id])).rowCount) throw new HttpError(409, 'Keep at least one admin.');
          let next: AgentAccount = { ...a };
          if (me.role !== 'admin' && a.id === me.id) next = { ...a, role: stored.role, status: stored.status, apps: stored.apps, capabilities: stored.capabilities, queues: me.role === 'agent' ? stored.queues : a.queues, languages: me.role === 'agent' ? stored.languages : a.languages, states: me.role === 'agent' ? stored.states : a.states, username: stored.username };
          if (a.id === me.id) next = { ...next, role: stored.role, status: stored.status };
          const username = next.username.trim().toLowerCase();
          if (username !== stored.username.toLowerCase()) {
            if (!USERNAME_RE.test(username) || (await usernameTaken(client, username, a.id))) throw new HttpError(409, `The username “${username}” is taken or not allowed.`);
            await client.query('update logins set username = $2, updated_at = now() where agent_id = $1', [a.id, username]);
          }
          await upsertAgent(client, { ...next, username });
          if (!isActive(next)) await client.query('delete from sessions where agent_id = $1', [a.id]);
          if (JSON.stringify({ ...stored, lastActiveLabel: 0 }) !== JSON.stringify({ ...next, username, lastActiveLabel: 0 })) changes.push(`updated ${stored.name}’s details or access`);
        }

        const customers = list<CustomerUser>(b.customers).filter((c) => me.role !== 'agent' || me.apps.includes(c.app));
        if (customers.length) {
          const ids = customers.map((c) => c.id);
          const stored = new Map((await client.query<{ id: string; doc: CustomerUser }>('select id, doc from customers where id = any($1::text[]) for update', [ids])).rows.map((r) => [r.id, r.doc]));
          for (const c of customers) {
            const prev = stored.get(c.id);
            if (prev && me.role === 'agent' && prev.app !== c.app && !me.apps.includes(prev.app)) throw new HttpError(409, `${prev.phone} is already a customer of another product.`);
            const merged = mergeCustomer(stored.get(c.id), c);
            if (!prev) changes.push(`added customer ${c.name ?? c.phone} (${c.phone}, ${c.app})`);
            else {
              const known = new Set(prev.callHistory.map((x) => x.id));
              for (const call of c.callHistory) if (!known.has(call.id)) changes.push(`logged a call with ${c.name ?? c.phone}: ${String(call.outcome ?? call.status)}`);
              if (c.ownerAgentId !== prev.ownerAgentId) changes.push(`changed who calls ${c.name ?? c.phone}`);
              if ((Array.isArray(c.tickets) ? c.tickets.length : 0) > (Array.isArray(prev.tickets) ? prev.tickets.length : 0)) changes.push(`raised a ticket for ${c.name ?? c.phone}`);
              if (c.customerType !== prev.customerType) changes.push(`set ${c.name ?? c.phone} as ${String(c.customerType ?? 'no type')}`);
              if ((c.lead ?? null) !== (prev.lead ?? null)) changes.push(c.lead ? `marked ${c.name ?? c.phone} ${String(c.lead)}` : `cleared positive/negative on ${c.name ?? c.phone}`);
            }
            await client.query(
              `insert into customers (id, owner_id, doc, updated_at) values ($1, $2, $3, now())
               on conflict (id) do update set owner_id = excluded.owner_id, doc = excluded.doc, updated_at = now()`,
              [c.id, merged.ownerAgentId ?? null, JSON.stringify(merged)],
            );
          }
        }

        for (const e of list<EscalationRecord>(b.escalations)) {
          const before = (await client.query<{ status: string }>('select status from escalations where id = $1', [e.id])).rows[0];
          if (!before) changes.push(`raised an escalation for ${String(e.userName ?? 'a customer')}`);
          else if (before.status !== e.status) changes.push(`${e.status} an escalation for ${String(e.userName ?? 'a customer')}`);
          await client.query(
            `insert into escalations (id, status, doc, updated_at) values ($1, $2, $3, now())
             on conflict (id) do update set status = excluded.status, doc = excluded.doc, updated_at = now()`,
            [e.id, e.status, JSON.stringify(e)],
          );
        }

        // Nobody writes a change-log line in someone else's name, and nobody signs in or out through here.
        for (const e of list<AuditEntry>(b.audit)) {
          if (e.actorId !== me.id || e.action === 'signed_in' || e.action === 'signed_out' || e.action === 'user_created') continue;
          await writeAudit(client, { ...e, actorName: me.name });
        }

        if (Array.isArray(b.cleared)) {
          await client.query(
            `insert into settings (key, value, updated_at) values ('clearedEscalations', $1, now())
             on conflict (key) do update set value = excluded.value, updated_at = now()`,
            [JSON.stringify(b.cleared.slice(0, 500))],
          );
        }

        await client.query('commit');
        for (const c of changes.slice(0, 50)) logEvent({ level: 'info', source: 'data', message: `${me.name} ${c}`, agentId: me.id, agentName: me.name });
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      send(res, 200, { ok: true });
      return true;
    }

    if (req.method === 'POST' && p === '/api/people') {
      const me = await requireMe(req, pool);
      const b = (await readJson(req)) as { agent?: AgentAccount; password?: unknown };
      const a = b.agent;
      if (!a || typeof a.id !== 'string' || typeof a.username !== 'string' || typeof a.name !== 'string') throw new HttpError(400, 'Missing the person’s details.');
      if (me.role === 'agent' || (me.role === 'supervisor' && a.role !== 'agent')) throw new HttpError(403, 'You can’t add this person.');
      const username = a.username.trim().toLowerCase();
      if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Use 3+ lowercase letters, numbers, dots or dashes for the username.');
      const pw = passwordProblem(b.password);
      if (pw) throw new HttpError(400, pw);
      const client = await pool.connect();
      try {
        await client.query('begin');
        if (await usernameTaken(client, username)) throw new HttpError(409, 'Someone already has this username.');
        if ((await client.query('select 1 from agents where id = $1', [a.id])).rowCount) throw new HttpError(409, 'That person already exists.');
        const email = typeof a.email === 'string' && a.email.trim() ? a.email.trim().toLowerCase() : undefined;
        if (email && (!EMAIL_RE.test(email) || (await usernameTaken(client, email)))) throw new HttpError(409, 'That email is taken or not valid.');
        const agent: AgentAccount = { ...a, username, email, superAdmin: me.superAdmin ? !!a.superAdmin : undefined, status: 'active', createdTs: Date.now() };
        await upsertAgent(client, agent);
        await client.query('insert into logins (agent_id, username, password_hash) values ($1, $2, $3)', [agent.id, username, await hashPassword(b.password as string)]);
        const entry = auditRow(me, 'user_created', agent.name, `Added ${agent.name} as ${agent.trainee ? 'a trainee ' : 'an '}${agent.role} for ${agent.apps.join(', ') || 'no products'}${agent.languages?.length ? ` (${agent.languages.join(', ')})` : ''}`);
        await writeAudit(client, entry);
        await client.query('commit');
        send(res, 200, { agent, audit: entry });
      } catch (e) {
        await client.query('rollback').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      return true;
    }

    const pwRoute = p.match(/^\/api\/people\/([^/]+)\/password$/);
    if (req.method === 'POST' && pwRoute) {
      const me = await requireMe(req, pool);
      const id = decodeURIComponent(pwRoute[1]);
      const b = (await readJson(req)) as { password?: unknown };
      const target = (await pool.query<{ doc: AgentAccount }>('select doc from agents where id = $1', [id])).rows[0]?.doc;
      if (!target) throw new HttpError(404, 'No such person.');
      const granted = target.id === me.id && !!(await pool.query("select 1 from notices where agent_id = $1 and kind = 'password_change' and done_at is null", [me.id])).rowCount;
      if (!me.superAdmin && !granted) throw new HttpError(403, 'Only the super admin can change passwords. Send a password-change request instead.');
      const pw = passwordProblem(b.password);
      if (pw) throw new HttpError(400, pw);
      await pool.query(
        `insert into logins (agent_id, username, password_hash, updated_at) values ($1, $2, $3, now())
         on conflict (agent_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
        [target.id, target.username.toLowerCase(), await hashPassword(b.password as string)],
      );
      // Everyone else signed in as them is signed out; the person changing their own password stays in.
      const token = readCookie(req, COOKIE);
      await pool.query('delete from sessions where agent_id = $1 and token_hash <> $2', [target.id, token ? tokenHash(token) : '']);
      if (target.id === me.id) await pool.query("update notices set done_at = now() where agent_id = $1 and kind = 'password_change' and done_at is null", [me.id]);
      await pool.query("update notices set done_at = now() where kind = 'password_request' and doc->>'subjectId' = $1 and done_at is null", [target.id]);
      const entry = auditRow(me, 'access_changed', target.name, target.id === me.id ? 'Changed their own password' : 'Password changed');
      await writeAudit(pool, entry);
      logEvent({ level: 'info', source: 'people', message: `${me.name}: ${entry.detail}${target.id === me.id ? '' : ` for ${target.name}`}`, agentId: me.id, agentName: me.name });
      send(res, 200, { ok: true, audit: entry });
      return true;
    }

    // Ask someone to do something in the app (today: choose a new password). It shows as a card in their inbox.
    if (req.method === 'POST' && p === '/api/notices') {
      const me = await requireMe(req, pool);
      const b = (await readJson(req)) as { agentId?: unknown; kind?: unknown; note?: unknown };
      const target = (await pool.query<{ doc: AgentAccount }>('select doc from agents where id = $1', [String(b.agentId ?? '')])).rows[0]?.doc;
      if (!target) throw new HttpError(404, 'No such person.');
      if (!me.superAdmin) throw new HttpError(403, 'Only the super admin can do this. Use “request a password change”.');
      if (target.id === me.id) throw new HttpError(403, 'Set your own password directly.');
      const kind = b.kind === 'message' ? 'message' : 'password_change';
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
      const notice: Notice = {
        id: `notice-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        kind,
        title: kind === 'password_change' ? 'Please choose a new password' : 'Message from Tecstellar support',
        body: note || (kind === 'password_change' ? 'Tecstellar support has let you choose a new password. It takes a few seconds.' : ''),
        fromName: 'Tecstellar support',
        ts: Date.now(),
      };
      await pool.query('insert into notices (id, agent_id, kind, doc) values ($1, $2, $3, $4)', [notice.id, target.id, kind, JSON.stringify(notice)]);
      if (kind === 'password_change') await pool.query("update notices set done_at = now() where kind = 'password_request' and doc->>'subjectId' = $1 and done_at is null", [target.id]);
      const entry = auditRow(me, 'access_changed', target.name, kind === 'password_change' ? 'Let them choose a new password' : 'Sent a message');
      await writeAudit(pool, entry);
      send(res, 200, { ok: true, audit: entry });
      return true;
    }

    // Anyone may ask the super admin for a new password — for themselves; admins also for their agents.
    if (req.method === 'POST' && p === '/api/password-requests') {
      const me = await requireMe(req, pool);
      const b = (await readJson(req)) as { agentId?: unknown; note?: unknown };
      const targetId = typeof b.agentId === 'string' && b.agentId ? b.agentId : me.id;
      const target = (await pool.query<{ doc: AgentAccount }>('select doc from agents where id = $1', [targetId])).rows[0]?.doc;
      if (!target) throw new HttpError(404, 'No such person.');
      if (target.superAdmin) throw new HttpError(403, 'That account is managed by Tecstellar.');
      if (target.id !== me.id && !mayManage(me, target)) throw new HttpError(403, 'You can’t ask for this person.');
      if (me.superAdmin) throw new HttpError(400, 'You can set passwords directly.');
      const open = await pool.query("select 1 from notices where kind = 'password_request' and doc->>'subjectId' = $1 and done_at is null limit 1", [target.id]);
      if (!open.rowCount) {
        const supers = (await pool.query<{ id: string }>("select id from agents where status = 'active' and coalesce((doc->>'superAdmin')::boolean, false)")).rows;
        if (!supers.length) throw new HttpError(503, 'No super admin account exists to handle this.');
        const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '';
        for (const s of supers) {
          const notice: Notice = {
            id: `notice-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
            kind: 'password_request',
            title: `Password change requested for ${target.name}`,
            body: note || (target.id === me.id ? `${me.name} asked for a new password.` : `${me.name} asked for a new password for ${target.name}.`),
            fromName: me.name,
            subjectId: target.id,
            subjectName: target.name,
            ts: Date.now(),
          };
          await pool.query('insert into notices (id, agent_id, kind, doc) values ($1, $2, $3, $4)', [notice.id, s.id, notice.kind, JSON.stringify(notice)]);
        }
      }
      const entry = auditRow(me, 'access_changed', target.name, 'Requested a password change');
      await writeAudit(pool, entry);
      send(res, 200, { ok: true, already: !!open.rowCount, audit: entry });
      return true;
    }

    const doneRoute = p.match(/^\/api\/notices\/([^/]+)\/done$/);
    if (req.method === 'POST' && doneRoute) {
      const me = await requireMe(req, pool);
      await pool.query('update notices set done_at = now() where id = $1 and agent_id = $2', [decodeURIComponent(doneRoute[1]), me.id]);
      send(res, 200, { ok: true });
      return true;
    }

    // Something went wrong in someone's browser (a crash, a save that failed): it reaches the super admin.
    if (req.method === 'POST' && p === '/api/events') {
      const me = await requireMe(req, pool);
      const now = Date.now();
      const recent = (browserReports.get(me.id) ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= 30) return send(res, 429, { error: 'Too many reports.' }), true;
      browserReports.set(me.id, [...recent, now]);
      const b = (await readJson(req, 64 * 1024)) as { level?: unknown; message?: unknown; detail?: unknown };
      const level = b.level === 'error' || b.level === 'warn' ? b.level : 'info';
      logEvent({ level, source: 'browser', message: String(b.message ?? 'Browser report').slice(0, 500), agentId: me.id, agentName: me.name, detail: b.detail });
      send(res, 200, { ok: true });
      return true;
    }

    // ── Super admin only ──────────────────────────────────────────────────────────────────────────────────────
    // An incoming caller this browser doesn't know: does any product the agent works for?
    if (req.method === 'POST' && p === '/api/sources/lookup') {
      const me = await requireMe(req, pool);
      const b = (await readJson(req)) as { phone?: unknown };
      const phone = typeof b.phone === 'string' ? b.phone.slice(0, 40) : '';
      const customer = env.sources?.configured ? await env.sources.lookup(phone, me.apps as FullCustomer['app'][]) : null;
      send(res, 200, { customer });
      return true;
    }

    if (p.startsWith('/api/system')) {
      const me = await requireMe(req, pool);
      if (!me.superAdmin) throw new HttpError(403, 'Only the super admin can open this.');

      if (req.method === 'GET' && p === '/api/system') {
        const people = (
          await pool.query<{ doc: AgentAccount; last_seen: string | null; sessions: string; last_sign_in: string | null; has_login: boolean; open_notices: string }>(
            `select a.doc,
                    (select max(s.last_seen_at) from sessions s where s.agent_id = a.id) as last_seen,
                    (select count(*) from sessions s where s.agent_id = a.id and s.expires_at > now()) as sessions,
                    (select max(l.ts) from audit_log l where l.actor_id = a.id and l.action = 'signed_in') as last_sign_in,
                    exists (select 1 from logins g where g.agent_id = a.id) as has_login,
                    (select count(*) from notices n where n.agent_id = a.id and n.done_at is null) as open_notices
             from agents a order by a.role, a.doc->>'name'`,
          )
        ).rows.map((r) => ({
          ...r.doc,
          lastSeen: r.last_seen ? Date.parse(r.last_seen) : null,
          sessions: Number(r.sessions),
          lastSignIn: r.last_sign_in ? Date.parse(r.last_sign_in) : null,
          hasLogin: r.has_login,
          openNotices: Number(r.open_notices),
        }));
        const counts = (await pool.query<{ customers: string; calls: string; calls_today: string }>(
          `select count(*) as customers,
                  coalesce(sum(jsonb_array_length(doc->'callHistory')), 0) as calls,
                  coalesce(sum((select count(*) from jsonb_array_elements(doc->'callHistory') c where (c->>'atTs')::bigint > $1)), 0) as calls_today
           from customers`,
          [new Date().setHours(0, 0, 0, 0)],
        )).rows[0];
        const passwordRequests = (await pool.query<{ doc: Notice }>("select doc from notices where kind = 'password_request' and done_at is null order by created_at")).rows.map((r) => r.doc);
        const activity = (await pool.query<{ doc: AuditEntry }>('select doc from audit_log order by ts desc limit 1000')).rows.map((r) => r.doc);
        send(res, 200, {
          passwordRequests,
          activity,
          visibility: await getVisibility(pool),
          health: env.systemHealth ? await env.systemHealth() : {},
          people,
          totals: { customers: Number(counts.customers), calls: Number(counts.calls), callsToday: Number(counts.calls_today) },
          sources: env.sources?.configured ? await env.sources.status() : [],
        });
        return true;
      }

      if (req.method === 'POST' && p === '/api/system/visibility') {
        const b = (await readJson(req)) as { changeLog?: unknown };
        const next = { changeLog: b.changeLog !== false };
        await pool.query(
          `insert into settings (key, value, updated_at) values ('visibility', $1, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [JSON.stringify(next)],
        );
        logEvent({ level: 'info', source: 'system', message: `${me.name} turned the Change log ${next.changeLog ? 'on' : 'off'} for client admins and agents`, agentId: me.id, agentName: me.name });
        send(res, 200, { ok: true, visibility: next });
        return true;
      }

      if (req.method === 'POST' && p === '/api/system/sources/sync') {
        const b = (await readJson(req)) as { app?: unknown; full?: unknown };
        if (!env.sources?.configured) throw new HttpError(501, 'No product is connected for customer sync.');
        logEvent({ level: 'info', source: 'sync', message: `${me.name} started a ${b.full ? 'full ' : ''}${String(b.app)} sync`, agentId: me.id, agentName: me.name });
        send(res, 200, await env.sources.run(String(b.app ?? '') as FullCustomer['app'], b.full === true));
        return true;
      }

      if (req.method === 'POST' && p === '/api/system/check') {
        const b = (await readJson(req)) as { what?: unknown };
        if (!env.check) throw new HttpError(501, 'Checks are not available.');
        const r = await env.check(String(b.what ?? ''));
        logEvent({ level: r.ok ? 'info' : 'error', source: 'system', message: `Check ${String(b.what)}: ${r.message}`, agentId: me.id, agentName: me.name });
        send(res, 200, r);
        return true;
      }

      if (req.method === 'POST' && p === '/api/system/signout') {
        const b = (await readJson(req)) as { agentId?: unknown };
        const target = (await pool.query<{ doc: AgentAccount }>('select doc from agents where id = $1', [String(b.agentId ?? '')])).rows[0]?.doc;
        if (!target) throw new HttpError(404, 'No such person.');
        const token = readCookie(req, COOKIE);
        const r = await pool.query('delete from sessions where agent_id = $1 and token_hash <> $2', [target.id, token ? tokenHash(token) : '']);
        await writeAudit(pool, auditRow(me, 'access_changed', target.name, 'Signed out on every device'));
        logEvent({ level: 'info', source: 'system', message: `${me.name} signed ${target.name} out (${r.rowCount} session${r.rowCount === 1 ? '' : 's'})`, agentId: me.id, agentName: me.name });
        send(res, 200, { ok: true, ended: r.rowCount });
        return true;
      }

      // Change how someone signs in: their username and/or login email.
      if (req.method === 'POST' && p === '/api/system/login') {
        const b = (await readJson(req)) as { agentId?: unknown; username?: unknown; email?: unknown };
        const target = (await pool.query<{ doc: AgentAccount }>('select doc from agents where id = $1', [String(b.agentId ?? '')])).rows[0]?.doc;
        if (!target) throw new HttpError(404, 'No such person.');
        const username = typeof b.username === 'string' && b.username.trim() ? b.username.trim().toLowerCase() : target.username;
        const email = typeof b.email === 'string' ? (b.email.trim().toLowerCase() || undefined) : target.email;
        if (!USERNAME_RE.test(username)) throw new HttpError(400, 'That username is not allowed.');
        if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'That email is not valid.');
        if (username !== target.username && (await usernameTaken(pool, username, target.id))) throw new HttpError(409, 'Someone already has that username.');
        if (email && email !== target.email && (await usernameTaken(pool, email, target.id))) throw new HttpError(409, 'Someone already signs in with that email.');
        const next = { ...target, username, email };
        await upsertAgent(pool, next);
        await pool.query('update logins set username = $2, updated_at = now() where agent_id = $1', [target.id, username]);
        await writeAudit(pool, auditRow(me, 'access_changed', target.name, `Sign-in changed: ${username}${email ? ` · ${email}` : ''}`));
        send(res, 200, { ok: true, agent: next });
        return true;
      }
    }

    // Notes: an agent's own reminders (audience 'me'), and notes an admin or supervisor leaves for every agent ('agents').
    if (p === '/api/notes' || p.startsWith('/api/notes/')) {
      const me = await requireMe(req, pool);
      if (req.method === 'GET' && p === '/api/notes') {
        const rows = (
          await pool.query<{ doc: NoteDoc }>(
            "select doc from notes where (audience = 'me' and owner_id = $1) or audience = 'agents' order by updated_at desc limit 500",
            [me.id],
          )
        ).rows.map((r) => r.doc);
        // Agents only see notes for the products they work.
        send(res, 200, { notes: me.role === 'agent' ? rows.filter((n) => !n.app || me.apps.includes(n.app)) : rows });
        return true;
      }
      if (req.method === 'POST' && p === '/api/notes') {
        const b = (await readJson(req)) as Record<string, unknown>;
        const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
        const body = typeof b.body === 'string' ? b.body.trim().slice(0, 5000) : '';
        if (!body && !title) throw new HttpError(400, 'Write something in the note.');
        const audience = b.audience === 'agents' ? 'agents' : 'me';
        if (audience === 'agents' && me.role === 'agent') throw new HttpError(403, 'Only admins and supervisors can leave notes for agents.');
        const app = typeof b.app === 'string' && b.app ? b.app.slice(0, 40) : undefined;
        const id = typeof b.id === 'string' && b.id ? b.id.slice(0, 80) : '';
        const prev = id ? (await pool.query<{ doc: NoteDoc }>('select doc from notes where id = $1', [id])).rows[0]?.doc : undefined;
        if (id && !prev) throw new HttpError(404, 'That note is gone.');
        if (prev && prev.ownerId !== me.id && !(prev.audience === 'agents' && me.role === 'admin')) throw new HttpError(403, 'That is not your note.');
        const now = Date.now();
        const note: NoteDoc = { id: prev?.id ?? `note-${now}-${crypto.randomBytes(3).toString('hex')}`, ownerId: prev?.ownerId ?? me.id, ownerName: prev?.ownerName ?? me.name, audience, app, title, body, createdTs: prev?.createdTs ?? now, updatedTs: now };
        await pool.query(
          `insert into notes (id, owner_id, audience, doc, updated_at) values ($1, $2, $3, $4, now())
           on conflict (id) do update set audience = excluded.audience, doc = excluded.doc, updated_at = now()`,
          [note.id, note.ownerId, audience, JSON.stringify(note)],
        );
        send(res, 200, { note });
        return true;
      }
      const noteRoute = p.match(/^\/api\/notes\/([^/]+)$/);
      if (req.method === 'DELETE' && noteRoute) {
        const id = decodeURIComponent(noteRoute[1]);
        const prev = (await pool.query<{ doc: NoteDoc }>('select doc from notes where id = $1', [id])).rows[0]?.doc;
        if (!prev) {
          send(res, 200, { ok: true });
          return true;
        }
        if (prev.ownerId !== me.id && !(prev.audience === 'agents' && me.role === 'admin')) throw new HttpError(403, 'That is not your note.');
        await pool.query('delete from notes where id = $1', [id]);
        send(res, 200, { ok: true });
        return true;
      }
    }

    send(res, 404, { error: 'Not found.' });
    return true;
  };
}
