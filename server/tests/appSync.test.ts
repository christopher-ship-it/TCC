import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { createSourceSync, sourcesFromEnv, type SourceConfig } from '../appSync.ts';
import { createDb } from '../db.ts';
import { mergeCustomer } from '../store.ts';
import type { SourceCustomer } from '../../src/lib/appSync.ts';
import type { CustomerUser } from '../../src/data/types.ts';

const KEY = 'irondrobe_live_test_key_never_logged';
const SRC: SourceConfig = { app: 'irondrobe', url: 'https://irondrobe.example/api/tcc/v1/', key: KEY };

test('products are connected by <APP>_API_URL + <APP>_API_KEY, both required', () => {
  assert.deepEqual(sourcesFromEnv({ IRONDROBE_API_URL: 'https://x.example/api/tcc/v1', IRONDROBE_API_KEY: 'k', REALBROKS_API_URL: 'https://y.example/' }), [
    { app: 'irondrobe', url: 'https://x.example/api/tcc/v1/', key: 'k' },
  ]);
});

const NOW = Date.parse('2026-10-29T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const person = (id: string, phone: string | null, over: Partial<SourceCustomer> = {}): SourceCustomer => ({
  id, app: 'irondrobe', name: `Person ${id}`, phone, business_name: `Shop ${id}`, city: 'Chennai', state: 'Tamil Nadu',
  registered_at: iso(40), last_active_at: iso(1), onboarding: { stage: 'first_order_created', completed: true, last_error: null },
  usage: { primary_count: 3, secondary_count: 1 }, plan: { name: 'Free', is_paid: false }, payment_due: null, open_tickets: [],
  account_status: 'active', updated_at: iso(1), ...over,
});

/** A stand-in for the product's API: pages of 2, answers lookups, records what TCC asked for. */
function fakeApi(customers: () => SourceCustomer[], opts: { status?: number } = {}) {
  const asked: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.pathname.replace('/api/tcc/v1/', '') + url.search);
    assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${KEY}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (opts.status) return json(opts.status, { error: { code: 'invalid_api_key', message: 'API key is missing, wrong or revoked.' } });
    const path = url.pathname.replace('/api/tcc/v1/', '');
    if (path === 'meta') return json(200, { app: 'irondrobe', onboarding_stages: [{ stage: 'first_order_created', label: 'Created first order' }, { stage: 'registered', label: 'Signed up' }] });
    if (path === 'customers/lookup') {
      const want = String((JSON.parse(String(init?.body)) as { phone: string }).phone).replace(/\D/g, '').slice(-10);
      return json(200, { data: customers().filter((c) => (c.phone ?? '').replace(/\D/g, '').slice(-10) === want) });
    }
    if (path === 'customers') {
      const since = url.searchParams.get('updated_since');
      const all = customers().filter((c) => !since || c.updated_at >= since).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return json(200, { data: page, next_cursor: more ? String(start + 2) : null, has_more: more });
    }
    return json(404, { error: { code: 'not_found' } });
  }) as typeof fetch;
  return { impl, asked };
}

// Its own schema in the throwaway test database, so it can run beside store.test.ts (which wipes `public`).
const base = process.env.TCC_TEST_DATABASE_URL;
const url = base ? `${base}${base.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c search_path=sync_test')}` : undefined;
test('live: syncs a product’s customers into TCC without touching what agents did', { skip: !url }, async () => {
  const wipe = new pg.Client(url);
  await wipe.connect();
  await wipe.query('drop schema if exists sync_test cascade; create schema sync_test;');
  await wipe.end();
  const db = createDb(url);
  const pool = await db.ready();
  const put = (doc: Partial<CustomerUser> & { id: string }) => pool.query('insert into customers (id, owner_id, doc) values ($1, $2, $3)', [doc.id, doc.ownerAgentId ?? null, JSON.stringify(doc)]);
  const doc = async (id: string) => (await pool.query<{ doc: CustomerUser }>('select doc from customers where id = $1', [id])).rows[0]?.doc;
  const blank = { callHistory: [], tickets: [], queue: null, ownerAgentId: null, adHoc: false };

  // Already in TCC: a RealBroks customer, a dialled-in number with a call, and an IronDrobe customer an agent has worked.
  await put({ ...blank, id: 'cust-919000000001', app: 'realbroks', phone: '+919000000001', name: 'RealBroks person' });
  await put({ ...blank, id: 'adhoc-919000000002', app: 'realbroks', phone: '+919000000002', name: '+919000000002', adHoc: true, callHistory: [{ id: 'dd1', atTs: 1, atLabel: '', agentName: 'A', status: 'No Answer', comment: '' }] });
  await put({ ...blank, id: 'cust-919000000003', app: 'irondrobe', phone: '+91 90000 00003', name: 'Typed by agent', ownerAgentId: 'agent-1', lead: 'positive', queue: 'followup', callHistory: [{ id: 'w1', atTs: 2, atLabel: '', agentName: 'A', status: 'Answered — Followup', comment: 'keen' }] });

  let source = [
    person('a', '+919000000001'), // another product's customer → left out
    person('b', '9000000002'), // the dialled-in number → becomes this customer
    person('c', '+919000000003', { name: 'Ravi', usage: { primary_count: 9, secondary_count: 2 } }),
    person('d', '+919000000004', { registered_at: iso(2), onboarding: { stage: 'registered', completed: false } }),
    person('e', null), // no phone → left out
    person('f', '+919000000006', { account_status: 'deleted' }), // closed and never in TCC → left out
  ];
  let clock = NOW;
  const api = fakeApi(() => source);
  const sync = createSourceSync(() => db.ready(), [SRC], { fetchImpl: api.impl, now: () => clock });
  try {
    const first = await sync.run('irondrobe');
    assert.equal(first.error, undefined);
    assert.equal(first.full, true);
    assert.deepEqual([first.fetched, first.created, first.updated], [6, 1, 2]);
    assert.deepEqual(first.skipped, { noPhone: 1, otherProduct: 1, closed: 1 });

    assert.equal((await doc('cust-919000000001')).app, 'realbroks');
    const b = await doc('adhoc-919000000002');
    assert.deepEqual([b.app, b.adHoc, b.name, b.callHistory.length], ['irondrobe', false, 'Person b', 1]);
    const c = await doc('cust-919000000003');
    assert.deepEqual([c.name, c.listings, c.ownerAgentId, c.lead, c.queue, c.callHistory.length], ['Ravi', 9, 'agent-1', 'positive', 'followup', 1]);
    const d = await doc('cust-919000000004');
    assert.deepEqual([d.queue, d.stageTag, d.sync?.sourceId], ['new', 'Signed up', 'd']);
    assert.equal(await doc('cust-919000000006'), undefined);

    // Next run: only what changed since, with a minute's overlap; unchanged records aren't rewritten.
    const before = (await pool.query<{ updated_at: Date }>("select updated_at from customers where id = 'cust-919000000004'")).rows[0].updated_at;
    clock += 600_000;
    source = source.map((s) => (s.id === 'c' ? { ...s, usage: { primary_count: 10, secondary_count: 2 }, updated_at: iso(-0.001) } : s));
    const second = await sync.run('irondrobe');
    assert.equal(second.full, false);
    assert.ok(api.asked.some((q) => q.startsWith('customers?') && q.includes('updated_since=')));
    // Everyone updated within the overlap comes again, but only the one who changed is rewritten.
    assert.deepEqual([second.updated, second.created], [1, 0]);
    assert.equal((await doc('cust-919000000003')).listings, 10);
    assert.equal((await pool.query<{ updated_at: Date }>("select updated_at from customers where id = 'cust-919000000004'")).rows[0].updated_at.getTime(), before.getTime());

    // A browser that still had the old copy saves it (the agent set an owner): the sync's numbers survive.
    const stale = { ...c, ownerAgentId: 'agent-2' };
    const merged = mergeCustomer(await doc('cust-919000000003') as never, stale as never) as unknown as CustomerUser;
    assert.deepEqual([merged.listings, merged.ownerAgentId], [10, 'agent-2']);

    // An incoming caller signed up since the last run: found by lookup, saved, returned.
    source.push(person('g', '+919000000007'));
    const found = await sync.lookup('+91 90000 00007', ['irondrobe']);
    assert.equal(found?.id, 'cust-919000000007');
    assert.equal((await doc('cust-919000000007'))?.name, 'Person g');
    assert.equal(await sync.lookup('+919999999999', ['irondrobe']), null);
    assert.equal(await sync.lookup('+919000000007', ['realbroks']), null);

    const status = await sync.status();
    assert.equal(status[0].host, 'irondrobe.example');
    assert.ok(!JSON.stringify(status).includes(KEY));
  } finally {
    await pool.end();
  }
});

test('live: a refused key is reported by status, never with the key in it', { skip: !url }, async () => {
  const db = createDb(url);
  const pool = await db.ready();
  const sync = createSourceSync(() => db.ready(), [SRC], { fetchImpl: fakeApi(() => [], { status: 401 }).impl });
  try {
    const r = await sync.run('irondrobe', true);
    assert.equal(r.error, 'irondrobe API answered 401 (invalid_api_key)');
    const saved = JSON.stringify(await sync.status());
    assert.ok(saved.includes('invalid_api_key') && !saved.includes(KEY));
  } finally {
    await pool.end();
  }
});
