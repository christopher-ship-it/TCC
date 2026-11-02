// Stores agents' feedback on the AI's call readings, turns recent corrections into lessons for the next analysis, and
// summarises how the AI is doing for the super admin (rules in src/lib/aiFeedback.ts). The lessons are recalculated at
// most every five minutes per product.

import type pg from 'pg';
import { buildLessons, summarize, type AiSummary, type FeedbackRow } from '../src/lib/aiFeedback.ts';

const SETTING = 'ai_learning';
const TTL_MS = 5 * 60_000;
/** The newest feedback considered for lessons and for the accuracy page. */
const WINDOW = 3000;

export function createLearning(getPool: () => Promise<pg.Pool>) {
  const cache = new Map<string, { at: number; text: string }>();

  async function rows(app?: string, limit = WINDOW): Promise<FeedbackRow[]> {
    const pool = await getPool();
    const r = await pool.query<{ doc: FeedbackRow }>(`select doc from ai_feedback ${app ? 'where app = $2' : ''} order by ts desc limit $1`, app ? [limit, app] : [limit]);
    return r.rows.map((x) => x.doc);
  }

  async function enabled(): Promise<boolean> {
    const pool = await getPool();
    const v = (await pool.query<{ value: { enabled?: boolean } }>('select value from settings where key = $1', [SETTING])).rows[0]?.value;
    return v?.enabled !== false;
  }

  return {
    enabled,

    async setEnabled(on: boolean) {
      const pool = await getPool();
      await pool.query(`insert into settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [SETTING, JSON.stringify({ enabled: on })]);
      cache.clear();
    },

    /** One piece of feedback; sending the same call's again replaces it. */
    async save(row: FeedbackRow) {
      const pool = await getPool();
      await pool.query(
        `insert into ai_feedback (id, entry_id, app, agent_id, ts, kind, verdict, doc) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8)
         on conflict (id) do update set verdict = excluded.verdict, ts = excluded.ts, doc = excluded.doc`,
        [row.id, row.entryId, row.app, row.agentId, row.ts, row.kind, row.verdict, JSON.stringify(row)],
      );
      cache.delete(row.app);
    },

    /** What to add to the instructions for this product's next analysis. Empty when learning is off or there is too little. */
    async lessonsFor(app: string | undefined): Promise<string> {
      if (!app) return '';
      const hit = cache.get(app);
      if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
      const text = (await enabled()) ? buildLessons(await rows(app, 400)) : '';
      cache.set(app, { at: Date.now(), text });
      return text;
    },

    /** For the super admin's AI accuracy page. */
    async overview(filter: { app?: string; language?: string } = {}): Promise<{ summary: AiSummary; enabled: boolean; lessons: { app: string; text: string }[]; apps: string[]; languages: string[] }> {
      const everything = await rows();
      const all = everything.filter((r) => (!filter.app || r.app === filter.app) && (!filter.language || r.language === filter.language));
      const apps = [...new Set(all.map((r) => r.app))];
      const on = await enabled();
      return {
        summary: summarize(all),
        enabled: on,
        lessons: await Promise.all(apps.map(async (app) => ({ app, text: on ? buildLessons(all.filter((r) => r.app === app).slice(0, 400)) : '' }))),
        apps: [...new Set(everything.map((r) => r.app))],
        languages: [...new Set(everything.map((r) => r.language).filter((l): l is string => !!l))],
      };
    },
  };
}

export type Learning = ReturnType<typeof createLearning>;
