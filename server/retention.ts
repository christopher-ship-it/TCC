// Keeps the live tables small. The screens show the newest 100 entries; everything older is moved, not deleted, to an
// archive table that the super admin can download from (GET /api/logs/export) and the Change log can page back into.
//
//   change log (audit_log)  → audit_archive after 90 days, deleted from the archive after 2 years
//   events                  → events_archive after 14 days, deleted from the archive after 1 year
//   expired sign-in sessions → deleted a day after they expire
//
// Runs once shortly after start-up and then every 6 hours. Safe to run any number of times.

import type pg from 'pg';
import { logEvent } from './events.ts';

export const RETENTION = { auditLiveDays: 90, auditArchiveDays: 730, eventsLiveDays: 14, eventsArchiveDays: 365 } as const;

export interface RetentionResult {
  at: number;
  auditArchived: number;
  eventsArchived: number;
  auditDeleted: number;
  eventsDeleted: number;
  sessionsDeleted: number;
}

export async function runRetention(pool: pg.Pool): Promise<RetentionResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // Another run in progress (or another server): let it finish.
    if (!(await client.query<{ ok: boolean }>('select pg_try_advisory_xact_lock(727402) as ok')).rows[0].ok) {
      await client.query('rollback');
      return { at: Date.now(), auditArchived: 0, eventsArchived: 0, auditDeleted: 0, eventsDeleted: 0, sessionsDeleted: 0 };
    }
    const auditArchived = (await client.query(
      `with moved as (delete from audit_log where ts < now() - ($1 || ' days')::interval returning id, ts, actor_id, action, doc)
       insert into audit_archive (id, ts, actor_id, action, doc) select id, ts, actor_id, action, doc from moved on conflict (id) do nothing`,
      [String(RETENTION.auditLiveDays)],
    )).rowCount ?? 0;
    const eventsArchived = (await client.query(
      `with moved as (delete from events where ts < now() - ($1 || ' days')::interval returning ts, level, source, message, agent_id, doc)
       insert into events_archive (ts, level, source, message, agent_id, doc) select ts, level, source, message, agent_id, doc from moved`,
      [String(RETENTION.eventsLiveDays)],
    )).rowCount ?? 0;
    const auditDeleted = (await client.query("delete from audit_archive where ts < now() - ($1 || ' days')::interval", [String(RETENTION.auditArchiveDays)])).rowCount ?? 0;
    const eventsDeleted = (await client.query("delete from events_archive where ts < now() - ($1 || ' days')::interval", [String(RETENTION.eventsArchiveDays)])).rowCount ?? 0;
    const sessionsDeleted = (await client.query("delete from sessions where expires_at < now() - interval '1 day'")).rowCount ?? 0;
    await client.query('commit');
    const r = { at: Date.now(), auditArchived, eventsArchived, auditDeleted, eventsDeleted, sessionsDeleted };
    if (auditArchived || eventsArchived || auditDeleted || eventsDeleted || sessionsDeleted) {
      logEvent({ level: 'info', source: 'retention', message: `Tidied the logs: ${auditArchived} change-log and ${eventsArchived} event entries archived, ${auditDeleted + eventsDeleted} old archive entries and ${sessionsDeleted} expired sign-ins removed` });
    }
    return r;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function startRetention(getPool: () => Promise<pg.Pool>) {
  const tick = () => void getPool().then(runRetention).catch((e) => logEvent({ level: 'warn', source: 'retention', message: `Tidying the logs failed: ${e instanceof Error ? e.message : String(e)}` }));
  setTimeout(tick, 60_000).unref?.();
  const t = setInterval(tick, 6 * 3600_000);
  t.unref?.();
  return () => clearInterval(t);
}
