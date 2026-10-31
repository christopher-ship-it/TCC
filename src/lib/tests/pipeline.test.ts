import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentProgress, installs, looksLikeTest, originOf, queueSnapshot, signUps } from '../pipeline.ts';
import type { AgentAccount, CustomerUser, Language } from '../../data/types.ts';

const NOW = new Date(2026, 9, 31, 11, 0).getTime();

const agent = (id: string, languages: Language[], over: Partial<AgentAccount> = {}): AgentAccount =>
  ({ id, name: id, role: 'agent', status: 'active', apps: ['irondrobe'], queues: ['new', 'noanswer', 'followup'], languages, states: [], ...over }) as unknown as AgentAccount;

const customer = (id: string, language: Language, over: Partial<CustomerUser> = {}): CustomerUser =>
  ({ id, name: id, app: 'irondrobe', language, queue: 'new', registeredDaysAgo: 0, registeredAtLabel: '31 Oct', callHistory: [], ownerAgentId: null, tickets: [], ...over }) as unknown as CustomerUser;

test('sign-ups are counted by day, and customers with no sign-up date are counted apart, never as today', () => {
  const s = signUps([
    customer('a', 'Tamil'),
    customer('b', 'Tamil', { registeredDaysAgo: 1 }),
    customer('c', 'Tamil', { registeredDaysAgo: 5 }),
    customer('d', 'Tamil', { registeredDaysAgo: 40 }),
    customer('e', 'Tamil', { registeredDaysAgo: 0, registeredAtLabel: 'Not recorded', sync: { stage: 'registered' } as CustomerUser['sync'] }),
  ]);
  assert.deepEqual(s, { today: 1, yesterday: 1, last7: 3, undated: 1, undatedNew: 1 });
});

test('the queue snapshot splits held from waiting, per language, and flags a language nobody online speaks', () => {
  const agents = [agent('ta', ['Tamil']), agent('ml', ['Malayalam'])];
  const users = [
    customer('t1', 'Tamil', { ownerAgentId: 'ta', assignedAt: NOW }),
    customer('t2', 'Tamil'),
    customer('m1', 'Malayalam'),
    customer('k1', 'Kannada'),
    customer('x', 'Tamil', { queue: 'tickets' }),
  ];
  const snap = queueSnapshot(users, agents, new Set(['ta']), NOW);
  assert.equal(snap.total, 4);
  assert.equal(snap.held, 1);
  assert.equal(snap.waiting, 3);
  assert.equal(snap.noAgentOnline, 2, 'Malayalam and Kannada customers have nobody signed in');
  const tamil = snap.byLanguage.find((r) => r.language === 'Tamil')!;
  assert.deepEqual([tamil.signedToday, tamil.inQueue, tamil.held, tamil.waiting, tamil.onlineAgents], [3, 2, 1, 1, 1]);
});

test("an agent's progress: what they hold and whether it has been called, today's calls, and what is lined up", () => {
  const me = agent('ta', ['Tamil']);
  const called = customer('c1', 'Tamil', { ownerAgentId: 'ta', assignedAt: NOW - 3_600_000, callHistory: [{ id: 'x', atTs: NOW - 600_000, agentName: 'ta', status: 'Answered — DG' } as never] });
  const fresh = customer('c2', 'Tamil', { ownerAgentId: 'ta', assignedAt: NOW - 60_000 });
  const lined = customer('c3', 'Tamil');
  const other = customer('c4', 'Malayalam');
  const p = agentProgress(me, [called, fresh, lined, other], NOW);
  assert.deepEqual(p.open.map((o) => [o.user.id, o.called]), [['c1', true], ['c2', false]]);
  assert.equal(p.callsToday.length, 1);
  assert.equal(p.connectedToday, 1);
  assert.equal(p.lined, 1, 'only the Tamil customer nobody holds');
});

test('installs lists who signed up today, and tells product records from ones made in TCC', () => {
  const fromProduct = customer('p', 'Tamil', { sync: { registeredTs: NOW - 3600_000 } as CustomerUser['sync'] });
  const madeHere = customer('m', 'Tamil', { manual: true, name: 'Test Shop', business: 'Demo' });
  const old = customer('o', 'Tamil', { registeredDaysAgo: 3 });
  const list = installs([old, madeHere, fromProduct], 'today', NOW);
  assert.deepEqual(list.map((u) => u.id), ['p', 'm']);
  assert.equal(originOf(fromProduct), 'product');
  assert.equal(originOf(madeHere), 'tcc');
  assert.equal(looksLikeTest(madeHere), true);
  assert.equal(looksLikeTest(fromProduct), false);
  assert.deepEqual(installs([old, fromProduct], 'list', NOW).map((u) => u.id), ['p', 'o']);
});
