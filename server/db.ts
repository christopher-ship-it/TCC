// TCC's Postgres (Neon) connection. Server only: DATABASE_URL carries the password, so it is read from the
// process environment and never from a VITE_ variable, which would be compiled into the browser bundle.
//
// The schema is applied by versioned migrations the first time the database is used. Each table keeps the
// record the app already works with as JSONB (`doc`) next to the few columns worth indexing, so the types
// in src/data/types.ts stay the single definition of a record.

import pg from 'pg';

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'core tables',
    sql: `
      create table agents (
        id text primary key,
        email text unique,
        role text not null,
        status text not null default 'active',
        doc jsonb not null,
        updated_at timestamptz not null default now()
      );
      create table customers (
        id text primary key,
        owner_id text,
        doc jsonb not null,
        updated_at timestamptz not null default now()
      );
      create index customers_owner_idx on customers (owner_id);
      create table escalations (
        id text primary key,
        status text not null,
        doc jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table audit_log (
        id text primary key,
        ts timestamptz not null,
        actor_id text not null,
        action text not null,
        doc jsonb not null
      );
      create index audit_log_ts_idx on audit_log (ts desc);
      create table call_analyses (
        recording_file text primary key,
        doc jsonb not null,
        created_at timestamptz not null default now()
      );
      create table settings (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );
    `,
  },
  {
    version: 2,
    name: 'sign-in and sessions',
    sql: `
      create table logins (
        agent_id text primary key,
        username text unique not null,
        password_hash text not null,
        updated_at timestamptz not null default now()
      );
      create table sessions (
        token_hash text primary key,
        agent_id text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
      create index sessions_agent_idx on sessions (agent_id);
      create index customers_updated_idx on customers (updated_at);
      create index agents_updated_idx on agents (updated_at);
      create index escalations_updated_idx on escalations (updated_at);
    `,
  },
  {
    version: 3,
    name: 'super admin: events, inbox, last seen',
    sql: `
      create table events (
        id bigserial primary key,
        ts timestamptz not null,
        level text not null,
        source text not null,
        message text not null,
        agent_id text,
        doc jsonb not null
      );
      create index events_ts_idx on events (ts desc);
      create table notices (
        id text primary key,
        agent_id text not null,
        kind text not null,
        doc jsonb not null,
        created_at timestamptz not null default now(),
        done_at timestamptz
      );
      create index notices_agent_idx on notices (agent_id) where done_at is null;
      alter table sessions add column last_seen_at timestamptz not null default now();
    `,
  },
];

export interface DbHealth {
  ok: boolean;
  configured: boolean;
  error?: string;
  latencyMs?: number;
  server?: string;
  schemaVersion?: number;
  tables?: Record<string, number>;
}

const TABLES = ['agents', 'customers', 'escalations', 'audit_log', 'call_analyses', 'settings', 'logins', 'sessions', 'events', 'notices'] as const;

export function createDb(url: string | undefined) {
  let pool: pg.Pool | undefined;
  let migrated: Promise<number> | undefined;

  const getPool = () => {
    if (!url) throw new Error('DATABASE_URL is not set.');
    pool ??= new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    return pool;
  };

  /** Applies any migration the database has not seen. Serialised with an advisory lock so two instances cannot race. */
  async function migrate(): Promise<number> {
    const client = await getPool().connect();
    try {
      await client.query('select pg_advisory_lock(727001)');
      await client.query('create table if not exists schema_migrations (version int primary key, name text not null, applied_at timestamptz not null default now())');
      const done = new Set((await client.query<{ version: number }>('select version from schema_migrations')).rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        await client.query('begin');
        try {
          await client.query(m.sql);
          await client.query('insert into schema_migrations (version, name) values ($1, $2)', [m.version, m.name]);
          await client.query('commit');
        } catch (e) {
          await client.query('rollback');
          throw e;
        }
      }
      return MIGRATIONS[MIGRATIONS.length - 1].version;
    } finally {
      await client.query('select pg_advisory_unlock(727001)').catch(() => {});
      client.release();
    }
  }

  return {
    configured: Boolean(url),
    /** The pool, once the schema is current. */
    async ready(): Promise<pg.Pool> {
      migrated ??= migrate().catch((e) => {
        migrated = undefined;
        throw e;
      });
      await migrated;
      return getPool();
    },
    async health(): Promise<DbHealth> {
      if (!url) return { ok: false, configured: false, error: 'DATABASE_URL is not set.' };
      const t = Date.now();
      try {
        const p = await this.ready();
        const v = await p.query<{ v: string }>('select version() as v');
        const tables: Record<string, number> = {};
        for (const name of TABLES) tables[name] = Number((await p.query<{ n: string }>(`select count(*) as n from ${name}`)).rows[0].n);
        const schemaVersion = (await p.query<{ v: number }>('select max(version) as v from schema_migrations')).rows[0].v;
        return { ok: true, configured: true, latencyMs: Date.now() - t, server: v.rows[0].v.split(' on ')[0], schemaVersion, tables };
      } catch (e) {
        // The driver's message can echo host details; keep it to a short, credential-free line.
        const msg = e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/gi, '[url]') : 'Database error.';
        return { ok: false, configured: true, error: msg, latencyMs: Date.now() - t };
      }
    },
    async close() {
      await pool?.end();
      pool = undefined;
      migrated = undefined;
    },
  };
}
