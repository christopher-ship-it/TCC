import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CAPACITY, openLoad, planAssignments } from '../assignment.ts';
import { startOfDay } from '../followUps.ts';
import type { AgentAccount, CustomerUser, Language } from '../../data/types.ts';

const NOW = new Date(2026, 9, 31, 11, 0).getTime();
const today = startOfDay(NOW);

const agent = (id: string, languages: Language[], over: Partial<AgentAccount> = {}): AgentAccount =>
  ({ id, name: id, role: 'agent', status: 'active', apps: ['irondrobe'], queues: ['new', 'noanswer', 'followup'], languages, states: [], ...over }) as unknown as AgentAccount;

const customer = (id: string, language: Language, over: Partial<CustomerUser> = {}): CustomerUser =>
  ({ id, name: id, app: 'irondrobe', language, queue: 'new', registeredDaysAgo: 1, callHistory: [], ownerAgentId: null, tickets: [], ...over }) as unknown as CustomerUser;

const team = [
  agent('tamil-eng', ['Tamil', 'English']),
  agent('tamil-hindi', ['Tamil', 'Hindi']),
  agent('mal', ['Malayalam', 'Tamil'], { primaryLanguage: 'Malayalam' }),
  agent('tel-kan', ['Telugu', 'Kannada']),
];
const everyone = new Set(team.map((a) => a.id));
const run = (customers: CustomerUser[], over: Partial<Parameters<typeof planAssignments>[0]> = {}) => planAssignments({ customers, agents: team, online: everyone, now: NOW, ...over });
const who = (plan: ReturnType<typeof planAssignments>, id: string) => plan.assign.find((x) => x.customerId === id)?.agentId;

test('a Malayalam customer never goes to someone who does not speak Malayalam', () => {
  const plan = run(Array.from({ length: 30 }, (_, i) => customer(`m${i}`, 'Malayalam')));
  assert.ok(plan.assign.length > 0);
  for (const a of plan.assign) assert.equal(a.agentId, 'mal');
  assert.equal(plan.assign.length, DEFAULT_CAPACITY, 'one Malayalam speaker holds five, the rest wait');
  assert.equal(plan.waiting.full, 25);
});

test('with nobody online who speaks the language, the customer waits and the reason says so', () => {
  const plan = run([customer('k1', 'Kannada')], { online: new Set(['tamil-eng', 'mal']) });
  assert.deepEqual(plan.assign, []);
  assert.equal(plan.waiting.noAgent.Kannada, 1);
});

test('50 sign-ups across 4 agents: everyone gets 5 and the rest wait', () => {
  const langs: Language[] = ['Tamil', 'Tamil', 'Malayalam', 'Telugu', 'Hindi'];
  const plan = run(Array.from({ length: 50 }, (_, i) => customer(`c${i}`, langs[i % 5])));
  const per = new Map<string, number>();
  for (const a of plan.assign) per.set(a.agentId, (per.get(a.agentId) ?? 0) + 1);
  for (const [, n] of per) assert.ok(n <= DEFAULT_CAPACITY);
  assert.equal(per.get('tamil-hindi') ?? 0, 5);
  // Every customer who was given out went to someone who speaks their language.
  for (const a of plan.assign) {
    const c = [...Array(50).keys()].map((i) => ({ id: `c${i}`, l: langs[i % 5] })).find((x) => x.id === a.customerId)!;
    assert.ok(team.find((t) => t.id === a.agentId)!.languages.includes(c.l));
  }
});

test('the first two Tamil customers go to two different agents (round robin), not both to one', () => {
  const plan = run([customer('t1', 'Tamil'), customer('t2', 'Tamil')]);
  assert.notEqual(who(plan, 't1'), who(plan, 't2'));
});

test('an agent whose primary language matches is asked first, even if another speaker has fewer', () => {
  const agents = [agent('primary', ['Tamil', 'Hindi'], { primaryLanguage: 'Tamil' }), agent('second', ['Hindi', 'Tamil'], { primaryLanguage: 'Hindi' })];
  const customers = [customer('t1', 'Tamil'), customer('t2', 'Tamil'), customer('t3', 'Tamil')];
  const plan = planAssignments({ customers, agents, online: new Set(['primary', 'second']), now: NOW });
  assert.deepEqual(plan.assign.map((x) => x.agentId), ['primary', 'primary', 'primary']);
  // Once the primary agent is full, the other speaker takes the next one.
  const more = Array.from({ length: 7 }, (_, i) => customer(`x${i}`, 'Tamil'));
  const full = planAssignments({ customers: more, agents, online: new Set(['primary', 'second']), now: NOW });
  assert.equal(full.assign.filter((x) => x.agentId === 'primary').length, 5);
  assert.equal(full.assign.filter((x) => x.agentId === 'second').length, 2);
});

test('only online agents are given customers', () => {
  const plan = run([customer('t1', 'Tamil')], { online: new Set(['tamil-hindi']) });
  assert.equal(who(plan, 't1'), 'tamil-hindi');
  assert.deepEqual(run([customer('t1', 'Tamil')], { online: new Set() }).assign, []);
});

test('a customer who already has an owner is never given to a second agent', () => {
  const owned = customer('t1', 'Tamil', { ownerAgentId: 'tamil-eng', assignedAt: NOW - 1000, callHistory: [] });
  const plan = run([owned]);
  assert.deepEqual(plan.assign, []);
  assert.deepEqual(plan.release, []);
});

test('an uncalled customer is taken back when their agent goes offline, and given to someone who is on', () => {
  const owned = customer('t1', 'Tamil', { ownerAgentId: 'tamil-eng', assignedAt: NOW - 3_600_000 });
  const plan = run([owned], { online: new Set(['tamil-hindi']) });
  assert.deepEqual(plan.release, [{ customerId: 't1', reason: 'agent-offline' }]);
  assert.equal(who(plan, 't1'), 'tamil-hindi');
});

test('a customer already called by their agent stays with them while they are offline, until the call-back day passes', () => {
  const calls = [{ id: 'c', atTs: NOW - 1000, status: 'No Answer', comment: '' }] as unknown as CustomerUser['callHistory'];
  const called = customer('t1', 'Tamil', { ownerAgentId: 'tamil-eng', assignedAt: NOW - 3_600_000, callHistory: calls, queue: 'new', callback: { dueTs: today, auto: true } });
  assert.deepEqual(run([called], { online: new Set(['tamil-hindi']) }).release, []);
  const late = { ...called, callback: { dueTs: today - 86_400_000, auto: true } } as CustomerUser;
  assert.deepEqual(run([late], { online: new Set(['tamil-hindi']) }).release, [{ customerId: 't1', reason: 'agent-offline' }]);
});

test('a customer is taken back when their agent is suspended or no longer speaks their language', () => {
  const owned = customer('t1', 'Tamil', { ownerAgentId: 'tamil-eng', assignedAt: NOW - 1000 });
  const suspended = team.map((a) => (a.id === 'tamil-eng' ? ({ ...a, status: 'suspended' } as AgentAccount) : a));
  assert.deepEqual(planAssignments({ customers: [owned], agents: suspended, online: everyone, now: NOW }).release, [{ customerId: 't1', reason: 'agent-gone' }]);
  const dropped = team.map((a) => (a.id === 'tamil-eng' ? ({ ...a, languages: ['English'] } as AgentAccount) : a));
  assert.equal(planAssignments({ customers: [owned], agents: dropped, online: everyone, now: NOW }).release.length, 1);
});

test('a customer given by hand (no assignedAt) is never taken back', () => {
  const byHand = customer('t1', 'Tamil', { ownerAgentId: 'tamil-eng' });
  assert.deepEqual(run([byHand], { online: new Set() }).release, []);
});

test('customers are served in the team’s order: yesterday’s sign-ups, then No answer, then Follow-up', () => {
  const agents = [agent('solo', ['Tamil'])];
  const customers = [
    customer('follow', 'Tamil', { queue: 'followup', callback: { dueTs: today, auto: false } }),
    customer('noans', 'Tamil', { queue: 'new', callback: { dueTs: today, auto: true } }),
    customer('old', 'Tamil', { registeredDaysAgo: 5 }),
    customer('yest', 'Tamil', { registeredDaysAgo: 1 }),
  ];
  const plan = planAssignments({ customers, agents, online: new Set(['solo']), now: NOW, capacity: 3 });
  assert.deepEqual(plan.assign.map((x) => x.customerId), ['yest', 'old', 'noans']);
});

test('customers added by hand and tickets/payments lists are not handed out', () => {
  const plan = run([customer('m', 'Tamil', { manual: true }), customer('p', 'Tamil', { queue: 'payments' }), customer('i', 'Tamil', { queue: 'inactive' })]);
  assert.deepEqual(plan.assign, []);
});

test('open load counts only customers still on a handed-out list', () => {
  const customers = [customer('a', 'Tamil', { ownerAgentId: 'x' }), customer('b', 'Tamil', { ownerAgentId: 'x', queue: 'new', callback: { dueTs: today + 86_400_000, auto: true } }), customer('c', 'Tamil', { ownerAgentId: 'y', queue: 'tickets' })];
  assert.deepEqual([...openLoad(customers, NOW)], [['x', 1]]);
});

test('a demo agent is never handed a real customer, however well the language fits', () => {
  const demo = agent('demo-tamil', ['Tamil'], { demo: true });
  const plan = planAssignments({ customers: [customer('cust-1', 'Tamil'), customer('cust-2', 'Tamil')], agents: [demo], online: new Set(['demo-tamil']), now: NOW });
  assert.deepEqual(plan.assign, []);
});

test('real customers still go to real agents when a demo agent shares the language', () => {
  const demo = agent('demo-tamil', ['Tamil'], { demo: true });
  const plan = planAssignments({ customers: [customer('cust-1', 'Tamil')], agents: [demo, ...team], online: new Set([...everyone, 'demo-tamil']), now: NOW });
  assert.notEqual(who(plan, 'cust-1'), 'demo-tamil');
  assert.ok(who(plan, 'cust-1'));
});
