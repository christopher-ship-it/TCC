// Make or repair sign-in accounts on a deployment with its own database (VITE_STORE=server), from a terminal:
//
//   railway run --service tcc node tools/accounts.ts create --role superadmin --name "Tecstellar" --username superadmin
//   railway run --service tcc node tools/accounts.ts create --role admin --name "Client Admin" --username admin [--email a@b.com]
//   railway run --service tcc node tools/accounts.ts password --username admin
//   railway run --service tcc node tools/accounts.ts list
//
// A new password is generated and printed once; only its hash is stored.

import crypto from 'node:crypto';
import { createDb } from '../server/db.ts';
import { hashPassword } from '../server/store.ts';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

/** Easy to read out and type: no 0/O, 1/l/I. */
function newPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n: number) => Array.from(crypto.randomBytes(n), (b) => chars[b % chars.length]).join('');
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

const APPS = (process.env.VITE_APPS ?? 'realbroks,irondrobe').split(',').map((s) => s.trim()).filter(Boolean);

async function main() {
  const db = createDb(process.env.DATABASE_URL);
  if (!db.configured) throw new Error('DATABASE_URL is not set (run through `railway run --service tcc`).');
  const pool = await db.ready();
  try {
    if (cmd === 'list') {
      const r = await pool.query<{ doc: Record<string, unknown>; login: boolean }>('select a.doc, exists (select 1 from logins l where l.agent_id = a.id) as login from agents a order by a.role');
      for (const { doc, login } of r.rows) console.log(`${String(doc.role).padEnd(10)} ${doc.superAdmin ? 'SUPER ' : '      '}${String(doc.username).padEnd(24)} ${String(doc.email ?? '').padEnd(28)} ${doc.status ?? 'active'}${login ? '' : ' (no password)'}  ${doc.name}`);
      return;
    }
    if (cmd === 'create') {
      const role = arg('role');
      const name = arg('name');
      const username = arg('username')?.toLowerCase();
      const email = arg('email')?.toLowerCase();
      if (!role || !['superadmin', 'admin'].includes(role) || !name || !username) throw new Error('create needs --role superadmin|admin --name "…" --username …');
      const taken = await pool.query("select 1 from agents where lower(doc->>'username') = $1 or ($2::text is not null and lower(email) = $2)", [username, email ?? null]);
      if (taken.rowCount) throw new Error(`Someone already has the username ${username}${email ? ` or email ${email}` : ''}.`);
      const id = `${username.replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
      const doc = {
        id, name, username, email, role: 'admin', superAdmin: role === 'superadmin' || undefined, status: 'active',
        apps: APPS, queues: [], languages: ['English'], states: [], dailyTarget: 0, clickToDial: true, createdTs: Date.now(),
        lastActiveLabel: 'Never', todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—', workingQueueLabel: '—',
      };
      const password = newPassword();
      await pool.query('insert into agents (id, email, role, status, doc) values ($1, $2, $3, $4, $5)', [id, email ?? null, 'admin', 'active', JSON.stringify(doc)]);
      await pool.query('insert into logins (agent_id, username, password_hash) values ($1, $2, $3)', [id, username, await hashPassword(password)]);
      const ts = Date.now();
      const audit = { id: `audit-${ts}-cli`, ts, actorId: 'tecstellar-cli', actorName: 'Tecstellar', action: 'user_created', target: name, detail: role === 'superadmin' ? 'Super admin account' : 'Admin account' };
      await pool.query('insert into audit_log (id, ts, actor_id, action, doc) values ($1, to_timestamp($2 / 1000.0), $3, $4, $5)', [audit.id, ts, audit.actorId, audit.action, JSON.stringify(audit)]);
      console.log(JSON.stringify({ created: role, name, username, email: email ?? null, password }));
      return;
    }
    if (cmd === 'password') {
      const username = arg('username')?.toLowerCase();
      const r = await pool.query<{ id: string }>("select id from agents where lower(doc->>'username') = $1", [username]);
      if (!r.rows[0]) throw new Error(`No account ${username}.`);
      const password = newPassword();
      await pool.query(
        `insert into logins (agent_id, username, password_hash) values ($1, $2, $3)
         on conflict (agent_id) do update set password_hash = excluded.password_hash, updated_at = now()`,
        [r.rows[0].id, username, await hashPassword(password)],
      );
      await pool.query('delete from sessions where agent_id = $1', [r.rows[0].id]);
      console.log(JSON.stringify({ username, password }));
      return;
    }
    throw new Error('Commands: list | create | password');
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
