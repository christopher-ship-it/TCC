import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDb, MIGRATIONS } from '../db.ts';
import { readServerEnv } from '../env.ts';

test('DATABASE_URL is read from the server environment only', () => {
  assert.equal(readServerEnv({ DATABASE_URL: ' postgresql://u:p@h/db ' }, '/tmp').databaseUrl, 'postgresql://u:p@h/db');
  assert.equal(readServerEnv({ VITE_DATABASE_URL: 'postgresql://u:p@h/db' }, '/tmp').databaseUrl, undefined);
  assert.equal(readServerEnv({}, '/tmp').databaseUrl, undefined);
});

test('migrations are numbered consecutively from 1', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), MIGRATIONS.map((_, i) => i + 1));
});

test('without a connection string the database reports itself unconfigured', async () => {
  const db = createDb(undefined);
  assert.equal(db.configured, false);
  assert.deepEqual(await db.health(), { ok: false, configured: false, error: 'DATABASE_URL is not set.' });
});

test('an unreachable database fails with a message that carries no credentials', async () => {
  const db = createDb('postgresql://user:hunter2secret@127.0.0.1:1/none');
  const h = await db.health();
  assert.equal(h.ok, false);
  assert.ok(!JSON.stringify(h).includes('hunter2secret'));
  await db.close();
});

// Live check against the real database — runs only when DATABASE_URL is set (e.g. from .env.local).
test('live: connects, migrates and round-trips a row', { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDb(process.env.DATABASE_URL);
  try {
    const h = await db.health();
    assert.equal(h.ok, true, h.error);
    assert.equal(h.schemaVersion, MIGRATIONS.length);
    const pool = await db.ready();
    const key = `test-${Date.now()}`;
    await pool.query('insert into settings (key, value) values ($1, $2)', [key, JSON.stringify({ hello: 'neon' })]);
    const r = await pool.query('select value from settings where key = $1', [key]);
    assert.deepEqual(r.rows[0].value, { hello: 'neon' });
    await pool.query('delete from settings where key = $1', [key]);
    await db.health(); // second run is a no-op migration
  } finally {
    await db.close();
  }
});
