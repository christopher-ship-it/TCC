import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { createApi } from '../api.ts';
import { readServerEnv } from '../env.ts';
import { hashPassword, mergeCustomer, verifyPassword } from '../store.ts';
import { retryDelayMs } from '../analyze.ts';

test('passwords are salted hashes that verify only with the right password', async () => {
  const a = await hashPassword('secret12');
  const b = await hashPassword('secret12');
  assert.notEqual(a, b);
  assert.ok(!a.includes('secret12'));
  assert.equal(await verifyPassword('secret12', a), true);
  assert.equal(await verifyPassword('secret13', a), false);
  assert.equal(await verifyPassword('secret12', 'garbage'), false);
});

test('saving a customer keeps calls another agent logged meanwhile', () => {
  const base = { id: 'cust-1', app: 'realbroks', phone: '+919845012345', ownerAgentId: null };
  const stored = { ...base, name: 'Old', callHistory: [{ id: 'c1', atTs: 1 }, { id: 'c2', atTs: 2 }] };
  const incoming = { ...base, name: 'New', callHistory: [{ id: 'c3', atTs: 3 }, { id: 'c1', atTs: 1, analysis: 'done' }] };
  const m = mergeCustomer(stored, incoming);
  assert.equal(m.name, 'New');
  assert.deepEqual(m.callHistory.map((c) => c.id), ['c3', 'c2', 'c1']);
  assert.equal(m.callHistory[2].analysis, 'done');
});

test('Gemini back-off honours the delay it asks for, within limits', () => {
  assert.equal(retryDelayMs('{"retryDelay": "17s"}', 0), 17_000);
  assert.equal(retryDelayMs('no hint', 0), 2000);
  assert.equal(retryDelayMs('no hint', 2), 8000);
  assert.equal(retryDelayMs('{"retryDelay": "900s"}', 0), 60_000);
});

// End to end against a throwaway Postgres — set TCC_TEST_DATABASE_URL (never the live database).
const url = process.env.TCC_TEST_DATABASE_URL;
test('live: first admin, agents with passwords, customers by mobile, calls shared', { skip: !url }, async () => {
  // A throwaway database: start from nothing every run.
  const wipe = new pg.Client(url);
  await wipe.connect();
  await wipe.query('drop schema public cascade; create schema public;');
  await wipe.end();
  const api = createApi(readServerEnv({ DATABASE_URL: url, TCC_SETUP_CODE: 'open-sesame' }, '/tmp'));
  const server = http.createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = () => {
    let cookie = '';
    return async (path: string, body?: unknown, method?: string) => {
      const res = await fetch(base + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    };
  };
  try {
    const admin = client();
    let r = await admin('/api/auth/me');
    assert.equal(r.body.setupNeeded, true);
    assert.equal(r.body.setupCodeRequired, true);

    r = await admin('/api/auth/setup', { name: 'Owner', username: 'owner', password: 'pass1234', code: 'wrong', apps: ['realbroks', 'irondrobe'] });
    assert.equal(r.status, 403);
    r = await admin('/api/auth/setup', { name: 'Owner', username: 'owner', password: 'pass1234', code: 'open-sesame', apps: ['realbroks', 'irondrobe'] });
    assert.equal(r.status, 200, r.body.error);
    r = await client()('/api/auth/setup', { name: 'Intruder', username: 'x-admin', password: 'pass1234', code: 'open-sesame' });
    assert.equal(r.status, 409, 'setup works only once');

    const agentDoc = { id: 'kavya-1', name: 'Kavya R', username: 'kavya.r', role: 'agent', apps: ['realbroks'], queues: ['new', 'followup'], languages: ['Tamil'], states: [], dailyTarget: 30, clickToDial: true, lastActiveLabel: 'Never', todayCalls: 0, todayConnected: 0, todayPositive: 0, todaySubscribed: 0, todayOverdue: 0, avgHandleLabel: '—', workingQueueLabel: '—' };
    r = await admin('/api/people', { agent: agentDoc, password: '123' });
    assert.equal(r.status, 400, 'short password refused');
    r = await admin('/api/people', { agent: agentDoc, password: 'kavya123' });
    assert.equal(r.status, 200, r.body.error);

    const agent = client();
    r = await agent('/api/auth/login', { username: 'kavya.r', password: 'nope1234' });
    assert.equal(r.status, 401);
    // Signing in to a product (the cards on the sign-in page) needs that product on the account; no session otherwise.
    r = await agent('/api/auth/login', { username: 'kavya.r', password: 'kavya123', app: 'irondrobe' });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /doesn’t have IronDrobe/);
    assert.equal((await agent('/api/auth/me')).body.agent, null, 'no session after a refused product');
    r = await agent('/api/auth/login', { username: 'Kavya.R', password: 'kavya123', app: 'realbroks' });
    assert.equal(r.status, 200, r.body.error);
    assert.equal((await client()('/api/auth/login', { username: 'owner', password: 'pass1234', app: 'irondrobe' })).status, 200, 'admins run every product');
    r = await agent('/api/people', { agent: { ...agentDoc, id: 'x', username: 'sneaky' }, password: 'pass1234' });
    assert.equal(r.status, 403, 'agents cannot add people');

    const customer = { id: 'cust-919845012345', app: 'realbroks', phone: '+919845012345', name: 'Ramesh K', manual: true, ownerAgentId: 'kavya-1', queue: 'new', callHistory: [] };
    r = await agent('/api/data', { customers: [customer] });
    assert.equal(r.status, 200, r.body.error);
    r = await agent('/api/data', { customers: [{ ...customer, callHistory: [{ id: 'call-1', atTs: Date.now(), agentName: 'Kavya R', status: 'Answered — DG' }] }] });
    assert.equal(r.status, 200, r.body.error);
    r = await agent('/api/data', { customers: [{ ...customer, id: 'cust-2', app: 'irondrobe' }] });
    r = await agent('/api/data');
    assert.ok(!r.body.customers.some((c: { app: string }) => c.app === 'irondrobe'), 'agents only get their products');

    // An agent may not promote themselves.
    r = await agent('/api/data', { agents: [{ ...agentDoc, role: 'admin', apps: ['realbroks', 'irondrobe'] }] });
    r = await admin('/api/data');
    const kavya = r.body.agents.find((a: { id: string }) => a.id === 'kavya-1');
    assert.equal(kavya.role, 'agent');
    assert.deepEqual(kavya.apps, ['realbroks']);

    // The admin sees the agent's customer and call.
    const seen = r.body.customers.find((c: { id: string }) => c.id === customer.id);
    assert.equal(seen.callHistory.length, 1);
    const cursor = r.body.cursor;
    r = await admin(`/api/data?since=${encodeURIComponent(cursor)}`);
    assert.equal(r.status, 200);

    // Notes: private to their author; an admin can leave one for every agent, an agent cannot.
    r = await agent('/api/notes', { title: 'Ask city', body: 'Ask which city they work in', audience: 'me' });
    assert.equal(r.status, 200, r.body.error);
    const mine = r.body.note;
    r = await agent('/api/notes', { title: 'Hi', body: 'x', audience: 'agents' });
    assert.equal(r.status, 403, 'agents cannot post team notes');
    r = await admin('/api/notes', { title: 'Always', body: 'Mention the free trial', audience: 'agents', app: 'realbroks' });
    assert.equal(r.status, 200, r.body.error);
    const team = r.body.note;
    r = await admin('/api/notes', { title: 'Other product', body: 'IronDrobe only', audience: 'agents', app: 'irondrobe' });
    r = await agent('/api/notes');
    assert.deepEqual(r.body.notes.map((n: { title: string }) => n.title).sort(), ['Always', 'Ask city']);
    r = await admin('/api/notes');
    assert.ok(!r.body.notes.some((n: { id: string }) => n.id === mine.id), 'private notes stay private');
    r = await admin(`/api/notes/${mine.id}`, undefined, 'DELETE');
    assert.equal(r.status, 403);
    r = await agent(`/api/notes/${team.id}`, undefined, 'DELETE');
    assert.equal(r.status, 403, 'agents cannot remove team notes');
    r = await agent(`/api/notes/${mine.id}`, undefined, 'DELETE');
    assert.equal(r.status, 200);

    // Suspending signs them out at once; a new password works and the old one doesn't.
    r = await admin('/api/data', { agents: [{ ...kavya, status: 'suspended' }] });
    assert.equal(r.status, 200, r.body.error);
    r = await agent('/api/data');
    assert.equal(r.status, 401);
    r = await admin('/api/data', { agents: [{ ...kavya, status: 'active' }] });
    r = await admin('/api/people/kavya-1/password', { password: 'newpass99' });
    assert.equal(r.status, 403, 'admins cannot change passwords');
    r = await agent('/api/auth/login', { username: 'kavya.r', password: 'kavya123' });
    r = await agent('/api/people/kavya-1/password', { password: 'selfchange1' });
    assert.equal(r.status, 403, 'agents cannot change their own password');

    // ── Super admin ──
    const db = new pg.Client(url);
    await db.connect();
    const superDoc = { id: 'super-1', name: 'Tecstellar', username: 'superadmin', email: 'ops@tecstellar.test', role: 'admin', superAdmin: true, status: 'active', apps: ['realbroks', 'irondrobe'], queues: [], languages: ['English'], states: [] };
    await db.query('insert into agents (id, email, role, status, doc) values ($1, $2, $3, $4, $5)', [superDoc.id, superDoc.email, 'admin', 'active', JSON.stringify(superDoc)]);
    await db.query('insert into logins (agent_id, username, password_hash) values ($1, $2, $3)', [superDoc.id, 'superadmin', await hashPassword('super1234')]);
    await db.end();

    const sup = client();
    r = await sup('/api/auth/login', { username: 'OPS@tecstellar.test', password: 'super1234' });
    assert.equal(r.status, 200, 'signs in with email too');
    r = await admin('/api/data');
    assert.ok(!r.body.agents.some((a: { id: string }) => a.id === 'super-1'), 'client admin never sees the super admin');
    r = await admin('/api/people/super-1/password', { password: 'hijack123' });
    assert.equal(r.status, 403, 'client admin cannot touch the super admin');
    r = await admin('/api/data', { agents: [{ ...superDoc, status: 'suspended' }] });
    r = await sup('/api/data');
    assert.equal(r.status, 200, 'and cannot suspend them either');
    r = await admin('/api/system');
    assert.equal(r.status, 403, 'System is super admin only');
    r = await sup('/api/system');
    assert.equal(r.status, 200, r.body.error);
    assert.ok(r.body.people.some((p: { id: string }) => p.id === 'super-1'));
    assert.ok(Array.isArray(r.body.health.endpoints) && r.body.health.events.length > 0);

    // Agent and admin ask the super admin; the super admin sees one request each and answers it.
    r = await agent('/api/password-requests', {});
    assert.equal(r.status, 200, r.body.error);
    r = await agent('/api/password-requests', {});
    assert.equal(r.body.already, true, 'no duplicate requests');
    r = await admin('/api/password-requests', { agentId: 'kavya-1' });
    assert.equal(r.status, 200, 'an admin may ask for their agent too');
    r = await sup('/api/system');
    assert.equal(r.body.passwordRequests.length, 1);
    assert.equal(r.body.passwordRequests[0].subjectName, 'Kavya R');
    r = await sup('/api/people/kavya-1/password', { password: 'newpass99' });
    assert.equal(r.status, 200, r.body.error);
    r = await sup('/api/system');
    assert.equal(r.body.passwordRequests.length, 0, 'setting it clears the request');
    r = await client()('/api/auth/login', { username: 'kavya.r', password: 'kavya123' });
    assert.equal(r.status, 401);
    r = await client()('/api/auth/login', { username: 'kavya.r', password: 'newpass99' });
    assert.equal(r.status, 200);
    r = await admin('/api/notices', { agentId: 'kavya-1', kind: 'password_change' });
    assert.equal(r.status, 403, 'only the super admin can send the change card');
    assert.ok(r.body.error);

    // The activity log shows what the admin and agent did.
    r = await sup('/api/system');
    assert.ok(r.body.activity.some((a: { detail: string }) => /password/i.test(a.detail)));
    assert.ok(r.body.health.events.some((e: { message: string; source: string }) => e.source === 'data' && /added customer/.test(e.message)));
    assert.ok(r.body.health.events.some((e: { message: string }) => /logged a call/.test(e.message)));

    // The client admin's Change log never shows the super admin or Tecstellar's setup tool.
    r = await admin('/api/data');
    const names = new Set(r.body.audit.map((a: { actorName: string }) => a.actorName));
    assert.ok(!names.has('Tecstellar'), 'no setup-tool entries');
    assert.ok(!names.has('Tecstellar'), 'no super admin entries');
    assert.ok(r.body.audit.every((a: { actorId: string; target?: string }) => a.actorId !== 'super-1' && a.target !== 'Tecstellar'), 'nothing by or about the super admin');
    assert.ok(r.body.audit.length > 0);
    r = await sup('/api/data');
    assert.ok(r.body.audit.some((a: { actorId: string }) => a.actorId === 'super-1'), 'the super admin sees everything');

    // The super admin can switch the Change log off for everyone else.
    r = await admin('/api/system/visibility', { changeLog: false });
    assert.equal(r.status, 403);
    r = await sup('/api/system/visibility', { changeLog: false });
    assert.equal(r.status, 200, r.body.error);
    r = await admin('/api/data');
    assert.equal(r.body.visibility.changeLog, false);
    assert.equal(r.body.audit.length, 0);
    r = await sup('/api/data');
    assert.ok(r.body.audit.length > 0, 'still on for the super admin');
    await sup('/api/system/visibility', { changeLog: true });

    // A password-change card from the super admin lets the admin choose their own new password, once.
    const ownerId = (await admin('/api/data')).body.me.id;
    r = await sup('/api/notices', { agentId: ownerId, kind: 'password_change' });
    assert.equal(r.status, 200, r.body.error);
    r = await admin('/api/data');
    assert.equal(r.body.notices.length, 1);
    assert.equal(r.body.notices[0].kind, 'password_change');
    r = await admin(`/api/people/${ownerId}/password`, { password: 'owner-new-1' });
    assert.equal(r.status, 200);
    r = await admin('/api/data');
    assert.equal(r.status, 200, 'changing your own password keeps you signed in');
    assert.equal(r.body.notices.length, 0);

    // Browser problems reach the event log.
    r = await admin('/api/events', { level: 'error', message: 'Browser error: test' });
    assert.equal(r.status, 200);
    r = await sup('/api/system');
    assert.ok(r.body.health.events.some((e: { message: string }) => e.message === 'Browser error: test'));
  } finally {
    server.close();
  }
});

test('a stale browser cannot bring a deleted customer back; only an explicit restore does', () => {
  const deleted = { by: 'ad-1', byName: 'Asha', reason: 'test customer', ts: 1, atLabel: 'x' };
  const base = { id: 'cust-1', app: 'realbroks', phone: '+919845012345', ownerAgentId: null, callHistory: [] };
  const stored = { ...base, name: 'Test', deleted };
  assert.deepEqual(mergeCustomer(stored as never, { ...base, name: 'Test' } as never).deleted, deleted);
  assert.equal('deleted' in mergeCustomer(stored as never, { ...base, name: 'Test', deleted: null } as never), false);
});

// --- who owns a customer ---
import { keepOwner } from '../store.ts';

test('a save from a browser with an older copy cannot take a customer back or hand them on', () => {
  const stored = { id: 'c', app: 'irondrobe', phone: '+91', ownerAgentId: 'priya', assignedAt: 1000, callHistory: [] } as never;
  const stale = { id: 'c', app: 'irondrobe', phone: '+91', ownerAgentId: null, callHistory: [], customerType: 'Shop' } as never;
  const out = keepOwner(stored, stale, { ...(stale as object) } as never) as unknown as Record<string, unknown>;
  assert.equal(out.ownerAgentId, 'priya');
  assert.equal(out.assignedAt, 1000);
  assert.equal(out.customerType, 'Shop', 'everything else still saves');
});

test('a person who gives a customer on to someone changes the owner, and the server stops treating it as its own', () => {
  const stored = { id: 'c', ownerAgentId: 'priya', assignedAt: 1000, callHistory: [] } as never;
  const given = { id: 'c', ownerAgentId: 'ravi', assignedAt: 1000, handOwnedAt: 5000, callHistory: [] } as never;
  const out = keepOwner(stored, given, { ...(given as object) } as never) as unknown as Record<string, unknown>;
  assert.equal(out.ownerAgentId, 'ravi');
  assert.equal(out.assignedAt, undefined);
  // The same save sent again does not count as a new hand-over once it is stored.
  const again = keepOwner({ id: 'c', ownerAgentId: 'ravi', handOwnedAt: 5000, callHistory: [] } as never, given, { ...(given as object) } as never) as unknown as Record<string, unknown>;
  assert.equal(again.ownerAgentId, 'ravi');
});

test('a brand-new customer keeps the owner it was added with', () => {
  const added = { id: 'n', ownerAgentId: 'ravi', callHistory: [] } as never;
  assert.equal((keepOwner(undefined, added, added) as unknown as Record<string, unknown>).ownerAgentId, 'ravi');
});
