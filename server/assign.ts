// Hands the day's customers to agents (the rules are in src/lib/assignment.ts). Runs every few seconds on the server and
// whenever an agent asks, one run at a time: a Postgres lock keeps two runs from ever giving the same customer to two
// people, and every write only takes a customer that still has the owner we planned around.

import type pg from 'pg';
import { logEvent } from './events.ts';
import { DEFAULT_CAPACITY, planAssignments, type AssignmentPlan } from '../src/lib/assignment.ts';
import type { AgentAccount, CustomerUser } from '../src/data/types.ts';

import { ONLINE_MINUTES } from '../src/lib/signedIn.ts';
export { ONLINE_MINUTES };
const LOCK_KEY = 727401;

export interface AssignSummary {
  at: number;
  assigned: number;
  released: number;
  waiting: AssignmentPlan['waiting'];
}

export interface AssignOptions {
  capacity?: number;
  everySeconds?: number;
}

export function createAssigner(getPool: () => Promise<pg.Pool>, opts: AssignOptions = {}) {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  let last: AssignSummary | null = null;
  let running: Promise<AssignSummary | null> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function once(): Promise<AssignSummary | null> {
    const pool = await getPool();
    const client = await pool.connect();
    try {
      await client.query('begin');
      // Another run (or another server) is already at it: let it finish.
      if (!(await client.query<{ ok: boolean }>('select pg_try_advisory_xact_lock($1) as ok', [LOCK_KEY])).rows[0].ok) {
        await client.query('rollback');
        return last;
      }
      const agents = (await client.query<{ doc: AgentAccount }>("select doc from agents where doc->>'role' = 'agent'")).rows.map((r) => r.doc);
      const online = new Set((await client.query<{ agent_id: string }>(`select distinct agent_id from sessions where expires_at > now() and last_seen_at > now() - ($1 || ' minutes')::interval`, [String(ONLINE_MINUTES)])).rows.map((r) => r.agent_id));
      // Only customers that can be on a handed-out list: waiting on a call-back, or in New installs / Follow-up.
      const customers = (
        await client.query<{ doc: CustomerUser }>(
          `select doc from customers where doc->>'deleted' is null and (doc ? 'callback' or doc->>'queue' in ('new', 'followup'))`,
        )
      ).rows.map((r) => r.doc);
      const now = Date.now();
      const plan = planAssignments({ customers, agents, online, now, capacity });

      const owner = new Map(customers.map((c) => [c.id, c.ownerAgentId ?? null]));
      let released = 0;
      let assigned = 0;
      const ids = [...plan.release.map((r) => r.customerId)].sort();
      for (const id of ids) {
        const res = await client.query(
          `update customers set owner_id = null, doc = (doc - 'assignedAt') || '{"ownerAgentId": null}'::jsonb, updated_at = now()
           where id = $1 and owner_id is not distinct from $2`,
          [id, owner.get(id)],
        );
        released += res.rowCount ?? 0;
      }
      for (const a of [...plan.assign].sort((x, y) => x.customerId.localeCompare(y.customerId))) {
        const res = await client.query(
          `update customers set owner_id = $2, doc = doc || jsonb_build_object('ownerAgentId', $2::text, 'assignedAt', $3::bigint), updated_at = now()
           where id = $1 and owner_id is null`,
          [a.customerId, a.agentId, now],
        );
        assigned += res.rowCount ?? 0;
      }
      await client.query('commit');
      last = { at: now, assigned, released, waiting: plan.waiting };
      if (assigned || released) logEvent({ level: 'info', source: 'assign', message: `Gave ${assigned} customer${assigned === 1 ? '' : 's'} to agents${released ? `, took ${released} back` : ''}` });
      return last;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Runs now, or joins the run already going. */
  function run(): Promise<AssignSummary | null> {
    running ??= once().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    run,
    status: () => last,
    start() {
      if (timer) return;
      const tick = () => void run().catch((e) => logEvent({ level: 'warn', source: 'assign', message: `Handing out customers failed: ${e instanceof Error ? e.message : String(e)}` }));
      setTimeout(tick, 15_000).unref?.();
      timer = setInterval(tick, Math.max(5, opts.everySeconds ?? 20) * 1000);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type Assigner = ReturnType<typeof createAssigner>;
